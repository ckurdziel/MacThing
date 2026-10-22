import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { log } from '../log.js';

const RETRY_MS = 60 * 1000; // after a failure, or while there is nothing to show
const ALBUMS_MS = 60 * 1000; // the settings page asks every few seconds; PhotoKit at most this often
const PERMISSION = ['denied', 'restricted', 'notDetermined'];
const READABLE = ['authorized', 'limited'];

/**
 * The Photos screen's picture frame: one photo at a time from the album chosen on the settings
 * page (Favorites unless one is), via CarThingHelper / PhotoKit. The order is shuffled, and every
 * photo comes up once before any comes round again.
 *
 * Only runs while the Photos screen is in use (`inUse()`), so nobody is asked for Photos access
 * who never picked the screen. The next photo is fetched each `photosSeconds` only while the
 * device shows the screen (setVisible); `next()` skips ahead at once.
 *
 * `state` is { status: 'ok', key, dataUrl, blurUrl, width, height, date, album } (blurUrl null for
 * wide photos, which fill the screen) or { status: 'empty', album } or
 * { status: 'loading' | 'denied' | 'restricted' | 'notDetermined' | 'error' }.
 */
export class PhotosFeed extends EventEmitter {
  constructor(helper, settings, { inUse }) {
    super();
    this.helper = helper;
    this.settings = settings;
    this.inUse = inUse;
    this.state = { status: 'loading' };
    this.active = false;
    this.visible = false;
    this.bag = []; // indexes still to show this round
    this.count = null; // the album size the bag was made for
    this.last = null; // the index on screen, so a new round doesn't open with it
    this.timer = null;
    this.fetching = false;
    this.again = false; // another photo was asked for while one was on its way
    this.failing = false; // warn once per run of failures, not on every retry
    this.albums = null;
    this.albumsAt = 0;
    this.albumsLoad = null;
    this.emptyTimer = null;
  }

  start() {
    this.helper.on('photosChanged', () => {
      this.albumsAt = 0;
      // Photos added to an empty album: show one without waiting out the retry.
      if (this.active && this.state.status === 'empty') {
        clearTimeout(this.emptyTimer);
        this.emptyTimer = setTimeout(() => this.next(), 2000);
      }
    });
    this.settings.on('change', (_, keys) => {
      if (keys.includes('photosAlbum')) this.#reset();
      const was = this.active;
      this.#update();
      if (was && this.active && keys.includes('photosAlbum')) this.next();
      else if (keys.includes('photosSeconds') && !this.fetching) this.#schedule();
    });
    this.#update();
  }

  /** The device shows the Photos screen (true) or doesn't (false). */
  setVisible(visible) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!this.fetching) this.#schedule();
  }

  /** The next photo now. */
  next() {
    if (!this.active) return;
    if (this.fetching) {
      this.again = true;
      return;
    }
    this.#fetch();
  }

  /**
   * For the settings page: { status, albums }. The list is read at most once a minute, or again
   * after the library changes; the first time it's waited for, after that the page gets what's
   * cached while a fresh one loads.
   */
  async albumsStatus(status) {
    if (!READABLE.includes(status)) {
      this.albums = null;
      return { status: status || 'unknown', albums: [] };
    }
    if (Date.now() - this.albumsAt > ALBUMS_MS) this.#loadAlbums();
    if (!this.albums && this.albumsLoad) await this.albumsLoad;
    return { status, albums: this.albums || [] };
  }

  #loadAlbums() {
    this.albumsAt = Date.now();
    this.albumsLoad ??= this.helper
      .albums()
      .then((r) => {
        if (r.ok) this.albums = r.albums;
      })
      .catch((err) => log.warn('[photos] albums:', err.message))
      .finally(() => {
        this.albumsLoad = null;
      });
  }

  #update() {
    const was = this.active;
    this.active = Boolean(this.inUse());
    if (this.active && !was) this.next();
    if (!this.active) clearTimeout(this.timer);
  }

  /** A different album: its photos are numbered afresh. */
  #reset() {
    this.bag = [];
    this.count = null;
    this.last = null;
  }

  /** 0…count-1 shuffled (Fisher–Yates), taken from the end, which isn't `avoid` unless it must be. */
  #shuffled(count, avoid) {
    const bag = Array.from({ length: count }, (_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (count > 1 && bag[count - 1] === avoid) [bag[0], bag[count - 1]] = [bag[count - 1], bag[0]];
    return bag;
  }

  async #fetch() {
    clearTimeout(this.timer);
    this.fetching = true;
    const album = this.settings.get().photosAlbum;
    if (!this.bag.length && this.count) this.bag = this.#shuffled(this.count, this.last);
    // Before the album's size is known, any index: the helper wraps it to the album.
    const index = this.bag.length ? this.bag.pop() : Math.floor(Math.random() * 2 ** 31);
    try {
      const r = await this.helper.photo(album, index);
      try {
        // A different album was chosen meanwhile: that one is already asked for (see `again`).
        if (album === this.settings.get().photosAlbum) await this.#show(r);
      } finally {
        for (const f of [r.path, r.blurPath]) if (f) fs.rm(f, { force: true }).catch(() => {});
      }
    } catch (err) {
      if (!this.failing) log.warn('[photos] (trying again each minute)', err.message);
      this.failing = true;
      if (this.state.status !== 'ok') this.#set({ status: 'error' });
    } finally {
      this.fetching = false;
      if (this.again) {
        this.again = false;
        this.next();
      } else this.#schedule();
    }
  }

  async #show(r) {
    if (!r.ok) {
      const status = PERMISSION.includes(r.status) ? r.status : 'error';
      if (status === 'error' && !this.failing) log.warn('[photos] (trying again each minute)', r.error || 'no photo');
      this.failing = status === 'error';
      // A photo already up stays through a passing failure, not once access is gone.
      if (status !== 'error' || this.state.status !== 'ok') this.#set({ status });
      return;
    }
    this.failing = false;
    if (!r.count) {
      this.#reset();
      this.#set({ status: 'empty', album: r.album || null });
      return;
    }
    // The album grew or shrank (or this is its first photo): a new round, less the one shown now.
    if (r.count !== this.count) {
      this.count = r.count;
      this.bag = this.#shuffled(r.count, null).filter((i) => i !== r.index);
    }
    this.last = r.index;
    const [image, blur] = await Promise.all([fs.readFile(r.path), r.blurPath ? fs.readFile(r.blurPath) : null]);
    this.#set({
      status: 'ok',
      key: `${Date.now()}-${r.index}`,
      dataUrl: `data:image/jpeg;base64,${image.toString('base64')}`,
      blurUrl: blur ? `data:image/jpeg;base64,${blur.toString('base64')}` : null,
      width: r.width,
      height: r.height,
      date: r.date ?? null,
      album: r.album || null,
    });
  }

  /** The next photo after `photosSeconds` while the screen is up; after a minute if there's none to show. */
  #schedule() {
    clearTimeout(this.timer);
    if (!this.active) return;
    const showing = this.state.status === 'ok' && !this.failing;
    if (showing && !this.visible) return; // nobody's looking: the next one waits until somebody is
    const ms = showing ? this.settings.get().photosSeconds * 1000 : RETRY_MS;
    this.timer = setTimeout(() => this.next(), ms);
  }

  #set(state) {
    // Retries that fail the same way again aren't news to the device.
    if (state.status !== 'ok' && JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    this.emit('change', state);
  }
}
