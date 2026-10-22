import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// settings.js reads ~/Library/... when it's imported, so each case runs in its own process with HOME
// pointed at a temporary folder.
async function withSettings(saved, source) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'macthing-screens-test-'));
  try {
    const folder = path.join(home, 'Library', 'Application Support', 'carthing-now-playing');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'settings.json'), JSON.stringify(saved));
    const module = new URL('../bridge/settings.js', import.meta.url).href;
    const script = `import assert from 'node:assert/strict';
      const {settings} = await import(${JSON.stringify(module)});
      ${source}`;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: home } });
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}

test('top buttons take four different known screens, or keep what they had', () => withSettings({}, `
  const defaults = ['nowplaying', 'calendar', 'weather', 'clock'];
  assert.deepEqual(settings.get().screens, defaults);
  for (const screens of [
    ['nowplaying', 'nowplaying', 'weather', 'clock'], // a screen on two buttons
    ['nowplaying', 'calendar', 'weather'], // a button with nothing
    ['nowplaying', 'calendar', 'weather', 'clock', 'photos'],
    ['nowplaying', 'calendar', 'weather', 'reminders'], // the task-reminder cards aren't a screen
    'photos',
  ]) assert.equal(settings.update({ screens }), false, JSON.stringify(screens));
  assert.deepEqual(settings.get().screens, defaults);
  assert.equal(settings.update({ screens: ['photos', 'todo', 'nowplaying', 'weather'] }), true);
  assert.deepEqual(settings.get().screens, ['photos', 'todo', 'nowplaying', 'weather']);
`));

test('a saved screen list that no longer validates falls back to the default', () => withSettings(
  { screens: ['nowplaying', 'clock', 'clock', 'weather'], idleScreen: 'photos', whenLocked: 'todo' }, `
  assert.deepEqual(settings.get().screens, ['nowplaying', 'calendar', 'weather', 'clock']);
  assert.equal(settings.get().idleScreen, 'photos');
  assert.equal(settings.get().whenLocked, 'todo');
  assert.equal(settings.update({ idleScreen: 'nowplaying' }), false);
`));
