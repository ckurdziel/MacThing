import fs from 'node:fs';
import http from 'node:http';
import { log } from '../log.js';
import { searchPlaces } from '../widgets/weather.js';

const page = fs.readFileSync(new URL('./page.html', import.meta.url));

/**
 * Settings page on http://127.0.0.1:<port> — for things that need typing (weather location),
 * plus the same toggles as the device's settings screen. Loopback only; requests must carry a
 * loopback Host (DNS-rebinding guard), and writes must be same-origin JSON (CSRF guard).
 *
 * @param {{port: number, settings: import('../settings.js').settings, status: () => Promise<object>, reminders?: import('../widgets/reminders.js').Reminders, dev?: boolean}} opts
 *   dev: a dev run (`npm run dev`); the page then shows testing buttons such as Show now.
 */
export function startSettingsPage({ port, settings, status, reminders, dev = false }) {
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

  const server = http.createServer(async (req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (!origins.includes(`http://${req.headers.host}`)) return json(403, { error: 'forbidden' });
    const url = new URL(req.url, origins[0]);

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        // Never inside another site's frame: clicks there would pass the Origin check above.
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'",
        });
        return res.end(page);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(200, { settings: settings.get(), ...(await status()), dev });
      }
      if (req.method === 'GET' && url.pathname === '/api/places') {
        const q = (url.searchParams.get('q') || '').trim();
        return json(200, { places: q.length < 2 ? [] : await searchPlaces(q) });
      }
      const isPost = req.method === 'POST' && ['/api/settings', '/api/reminders/test'].includes(url.pathname);
      if (isPost && (!origins.includes(req.headers.origin) || !req.headers['content-type']?.startsWith('application/json'))) {
        return json(403, { error: 'forbidden' });
      }
      if (isPost && url.pathname === '/api/reminders/test') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1000) return json(413, { error: 'too large' });
        }
        return json(200, { ok: !!reminders?.fire(JSON.parse(body).id) });
      }
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 10000) return json(413, { error: 'too large' });
        }
        settings.update(JSON.parse(body));
        return json(200, { settings: settings.get() });
      }
      json(404, { error: 'not found' });
    } catch (err) {
      log.warn('[settings page]', err.message);
      json(500, { error: err.message });
    }
  });

  server.on('error', (err) => log.warn(`[settings page] not available on port ${port}:`, err.message));
  server.listen(port, '127.0.0.1', () => log.info(`[settings page] http://127.0.0.1:${port}`));
  return server;
}
