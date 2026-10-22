import { EventEmitter } from 'node:events';
import { config, paths } from '../config.js';
import { log } from '../log.js';
import { adb, shell } from './adb.js';
import { CDP, listTargets } from './cdp.js';
import { isBootInstalled, syncDaemon, syncUi } from './deploy.js';

const BINDING = '__carthingSend'; // page → Mac (Runtime.addBinding)
const CONSOLE_MARK = '⁣carthing '; // fallback channel if bindings are unavailable
const READY_COALESCE_MS = 2000; // hellos this soon after the last full state don't get another
// The page's messages are a few hundred bytes; anything this big isn't from our page.
const MAX_PAYLOAD = 64 * 1024;

/**
 * The page's DevTools socket, always through our own forward. The device reports the URL, so only
 * its target path is taken from it: a tampered device can't point the bridge at another server.
 */
function pageSocketUrl(target) {
  const reported = new URL(target.webSocketDebuggerUrl);
  if (reported.protocol !== 'ws:' || !/^\/devtools\/page\/[\w-]+$/.test(reported.pathname)) {
    throw new Error(`unexpected DevTools target ${reported.protocol}//…${reported.pathname}`);
  }
  return `ws://127.0.0.1:${config.cdpPort}${reported.pathname}`;
}

/** What device/sleepd.sh reads out of /var/lib/carthing/sleep.conf. */
const sleepConf = () => ({
  HB: config.deviceHeartbeat,
  IDLE: config.deviceSleepSeconds,
  WAKE: config.deviceWakeSeconds,
  POWERSAVE: config.devicePowersave ? 1 : 0,
  HEAL: config.deviceUsbHealSeconds,
});

/** What device/dimmerd.sh reads out of /var/lib/carthing/dimmer.conf. */
const dimmerConf = () => ({
  DELAY: config.deviceDimDelaySeconds,
});

/**
 * One live connection to a Car Thing: forwards its Chromium devtools port over adb,
 * makes sure the page shows our UI, and relays messages both ways.
 *   Mac → page: Runtime.evaluate(window.__carthingReceive(msg))
 *   page → Mac: window.__carthingSend(json) binding
 *
 * Events: 'ready' (page loaded and wants full state), 'message' (from page), 'close'.
 */
export class DeviceLink extends EventEmitter {
  constructor(serial) {
    super();
    this.serial = serial;
    this.cdp = null;
    this.closed = false;
    this.sleepd = false; // is the device-side sleep watchdog installed?
    this.beat = 0;
    this.live = false; // past Runtime.enable: console messages from here on are new, not replayed
    this.open = false; // connect() finished: the page can take messages
    this.lastReady = -Infinity;
  }

  async connect() {
    await adb(['forward', `tcp:${config.cdpPort}`, 'tcp:2222'], { serial: this.serial });
    const sync = await syncUi(this.serial, paths.ui, config.deviceUiDir);
    if (sync.changed) log.info(`[device] UI deployed (${sync.version})`);
    this.uiVersion = sync.version;

    const sleepd = await syncDaemon(this.serial, {
      name: 'sleepd', program: 'carthing-sleep', confFile: 'sleep.conf',
      localScript: paths.sleepd, remoteDir: config.deviceDir, conf: sleepConf(),
    }).catch((err) => {
      log.warn('[device] sleep watchdog:', err.message);
      return { installed: false, changed: false };
    });
    this.sleepd = sleepd.installed;
    if (sleepd.changed) log.info('[device] sleep watchdog updated');
    else if (!sleepd.installed) log.warn('[device] no sleep watchdog — run `npm run setup-device` so the screen sleeps when the Mac is off');

    const dimmer = await syncDaemon(this.serial, {
      name: 'dimmerd', program: 'backlight', confFile: 'dimmer.conf',
      localScript: paths.dimmerd, remoteDir: config.deviceDir, conf: dimmerConf(),
    }).catch((err) => {
      log.warn('[device] dimmer:', err.message);
      return { installed: false, changed: false };
    });
    if (dimmer.changed) log.info('[device] dimmer updated');
    else if (!dimmer.installed) log.warn("[device] stock dimmer still running — run `npm run setup-device` so a hand on the controls doesn't dim the screen");

    const installed = await isBootInstalled(this.serial, config.deviceUiDir);
    this.pageUrl = installed ? config.deviceBootUrl : `file://${config.deviceUiDir}/index.html`;
    if (!installed) log.warn('[device] boot web app not pointed at our UI yet — run `npm run setup-device` so it survives reboots');

    const target = await this.#waitForPage();
    const cdp = await CDP.connect(pageSocketUrl(target));
    this.cdp = cdp;

    cdp.on('Runtime.bindingCalled', (p) => p.name === BINDING && this.#onPayload(p.payload));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      const text = p.args.map((a) => (a.value !== undefined ? a.value : a.description)).join(' ');
      if (!text.startsWith(CONSOLE_MARK)) return log.debug('[device console]', text);
      // Runtime.enable replays everything the page has logged since it loaded, before it answers.
      // A page left without the Mac logs a hello every second, and answering each replayed one
      // with the full state buried the device in thousands of updates it could never catch up on.
      if (this.live) this.#onPayload(text.slice(CONSOLE_MARK.length));
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails;
      log.warn('[device] page error:', d.exception?.description || d.text);
    });
    cdp.on('close', () => this.close());

    await cdp.send('Runtime.enable');
    this.live = true;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.addBinding', { name: BINDING }).catch((e) => log.warn('[device] addBinding failed, using console channel', e.message));
    this.open = true;

    if (target.url !== this.pageUrl) {
      log.info(`[device] opening UI (was ${target.url})`);
      await cdp.send('Page.navigate', { url: this.pageUrl });
    } else if (sync.changed) {
      await this.reload();
    } else {
      this.#ready(); // our UI is already up; it just needs state
    }
  }

  async #waitForPage(timeoutMs = 90000) {
    // Chromium can take a while after a cold boot; keep polling its devtools endpoint.
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const page = (await listTargets(config.cdpPort)).find((t) => t.type === 'page');
        if (page) return page;
      } catch {}
      if (Date.now() > deadline) throw new Error('Chromium devtools not reachable on the device');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  #onPayload(payload) {
    if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) {
      return log.warn('[device] oversized payload ignored');
    }
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return log.warn('[device] bad payload', payload.slice(0, 200));
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
      return log.warn('[device] bad payload', payload.slice(0, 200));
    }
    if (msg.type === 'hello') this.#ready();
    this.emit('message', msg);
  }

  /** The page wants full state. It says hello every second until it has some, and a slow page can
   *  send several before the first answer lands, so one answer covers the hellos after it for a bit. */
  #ready() {
    if (!this.open || Date.now() - this.lastReady < READY_COALESCE_MS) return;
    this.lastReady = Date.now();
    this.emit('ready');
  }

  send(msg) {
    // Not until connect() has finished: a page that can't get through Runtime.enable in time
    // shouldn't also be handed a backlog of ticks and updates that a retry will send again anyway.
    if (!this.cdp || this.closed || !this.open) return;
    const expression = `window.__carthingReceive && window.__carthingReceive(${JSON.stringify(msg)})`;
    this.cdp.send('Runtime.evaluate', { expression }).catch((e) => log.debug('[device] send failed', e.message));
  }

  async reload() {
    await this.cdp?.send('Page.reload', { ignoreCache: true });
  }

  async redeploy() {
    const sync = await syncUi(this.serial, paths.ui, config.deviceUiDir);
    if (sync.changed) {
      log.info(`[device] UI redeployed (${sync.version})`);
      await this.reload();
    }
  }

  /**
   * Tells the device-side watchdog the Mac is still here, and what the screen should be doing.
   * It's the heartbeat going stale — not the screen state — that makes the device sleep on its own.
   */
  async heartbeat(on) {
    if (!this.sleepd || this.closed) return;
    await shell(this.serial, `echo ${++this.beat} ${on ? 'on' : 'off'} > ${config.deviceHeartbeat}`, { timeout: 5000 });
  }

  /**
   * Backlight on/off. The ambient-light daemon is paused while off so it can't relight the screen.
   *
   * Use the Amlogic driver's own switch: the standard /sys/class/backlight/aml-bl/bl_power and
   * its `brightness` are both accepted on this panel and do nothing — the LEDs stay lit while the
   * page goes black, which looks like a dark screen in a dark room and lit everywhere else.
   * device/sleepd.sh switches the same file when the Mac isn't there to do it.
   */
  async setScreen(on) {
    this.send({ type: 'screen', on });
    const power = '/sys/class/aml_bl/power'; // echo 0|1 (see `cat /sys/class/aml_bl/help`)
    await shell(
      this.serial,
      on
        ? `echo 1 > ${power}; supervisorctl start backlight >/dev/null 2>&1; true`
        : `supervisorctl stop backlight >/dev/null 2>&1; echo 0 > ${power}; true`,
      { timeout: 3000 },
    );
  }

  async screenshot() {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.cdp?.close();
    } catch {}
    this.emit('close');
  }
}
