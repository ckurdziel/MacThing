import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { log } from '../log.js';

/**
 * Talks to native/bin/CarThingHelper.app (location, calendar, photos). It runs as its own app so
 * macOS asks for and remembers Location Services / Calendars / Photos permission for
 * "Car Thing Helper". Emits 'calendarChanged', 'locationAuthorization' and 'photosChanged'
 * notices from the helper.
 */
export class MacHelper extends EventEmitter {
  constructor(binDir) {
    super();
    this.bin = path.join(binDir, 'CarThingHelper.app', 'Contents', 'MacOS', 'CarThingHelper');
    this.pending = new Map();
    this.nextId = 1;
    this.proc = null;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    const proc = spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.proc = proc;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return log.warn('[helper] unparseable line', line.slice(0, 200));
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        resolve(msg);
      } else if (msg.event) {
        this.emit(msg.event, msg);
      }
    });
    proc.on('exit', (code) => {
      this.proc = null;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('helper exited'));
      }
      this.pending.clear();
      if (this.stopped) return;
      log.warn(`[helper] exited (${code}); restarting in 2s`);
      setTimeout(() => this.start(), 2000);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.stdin.end();
  }

  /** Permission prompts can sit on screen for a while, hence the long default timeout. */
  request(cmd, params = {}, timeoutMs = 90000) {
    if (!this.proc) return Promise.reject(new Error('helper not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`helper ${cmd} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ id, cmd, ...params })}\n`);
    });
  }

  /** @returns {Promise<{ok, location, calendar, photos}>} permission statuses */
  status() {
    return this.request('status', {}, 5000);
  }

  /** @returns {Promise<{ok, status, lat?, lon?, name?, region?, country?}>} */
  location() {
    return this.request('location');
  }

  /** @returns {Promise<{ok, status, events?: Array<{title, location, start, end, allDay, calendar, calendarId, color}>}>} */
  events(from, to) {
    return this.request('events', { from, to });
  }

  /** Every event calendar on the Mac. @returns {Promise<{ok, status, calendars?: Array<{id, title, color, account}>}>} */
  calendars() {
    return this.request('calendars');
  }

  /** The Photos albums to choose from (never prompts). Counting every album's photos takes a moment.
   *  @returns {Promise<{ok, status, albums?: Array<{id, title, count, kind: 'smart'|'user'|'shared'}>}>} */
  albums() {
    return this.request('albums', {}, 30000);
  }

  /**
   * Photo `index` (wrapped to the album's size) of `album` (null: Favorites), written to temp
   * JPEGs the caller deletes. The default timeout covers both the permission prompt and an
   * original that has to come down from iCloud first.
   * @returns {Promise<{ok, status, count?, index?, album?, path?, blurPath?, width?, height?, date?}>}
   */
  photo(album, index) {
    return this.request('photo', { album: album ?? null, index });
  }
}
