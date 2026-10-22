import { EventEmitter } from 'node:events';
import { log } from '../log.js';

const REFRESH_MS = 5 * 60 * 1000;

/**
 * The Reminders screen's list: incomplete reminders from the Mac's Reminders app (via
 * CarThingHelper / EventKit), from the lists chosen on the settings page. Not to be confused with
 * widgets/reminders.js, the task-reminder cards.
 *
 * Only runs while the screen is in use (`inUse()`), so nobody is asked for Reminders access who
 * never picked it. Refreshes on a timer, when the helper reports EventKit's database changed
 * (reminders share it with the calendar), and when different lists are chosen.
 *
 * `state` is { status: 'ok', total, reminders: [{id, title, due, allDay, priority, list, listId, color}] }
 * (at most 60 reminders, the soonest due first; total counts them all)
 * or { status: 'loading' | 'denied' | 'restricted' | 'writeOnly' | 'notDetermined' | 'error' }.
 */
export class TodoFeed extends EventEmitter {
  constructor(helper, settings, { inUse }) {
    super();
    this.helper = helper;
    this.settings = settings;
    this.inUse = inUse;
    this.state = { status: 'loading' };
    this.active = false;
    this.timer = null;
    this.seq = 0;
  }

  start() {
    setInterval(() => this.active && this.refresh(), REFRESH_MS);
    this.helper.on('calendarChanged', () => {
      if (!this.active) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.refresh(), 1000);
    });
    this.settings.on('change', (_, keys) => {
      const was = this.active;
      this.active = Boolean(this.inUse());
      if (this.active && (!was || keys.includes('todoLists'))) this.refresh();
    });
    this.active = Boolean(this.inUse());
    if (this.active) this.refresh();
  }

  async refresh() {
    const seq = ++this.seq;
    try {
      const r = await this.helper.reminders(this.settings.get().todoLists);
      if (seq !== this.seq) return; // a newer refresh (other lists, say) is on its way
      this.#set(r.ok ? { status: 'ok', total: r.total ?? r.reminders.length, reminders: r.reminders } : { status: r.status || 'error' });
    } catch (err) {
      log.warn('[todo]', err.message);
      if (seq === this.seq && this.state.status !== 'ok') this.#set({ status: 'error' });
    }
  }

  #set(state) {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    this.emit('change', state);
  }
}
