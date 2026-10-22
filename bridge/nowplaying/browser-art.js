// From Nihal Shetty's fork, https://github.com/nihalshetty-boop/MacThing (MIT).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { log } from '../log.js';

// The playing page picks these URLs (its own address and its og:image), so the bridge only
// fetches public addresses: a page mustn't be able to aim it at this Mac or the LAN, outside the
// browser's own protections. Checked as each connection resolves, so redirects and a DNS answer
// that changes between check and connect are covered too.
// One list per family: a BlockList also matches IPv4 addresses against IPv6 rules (as ::ffff:a.b.c.d),
// which would make the mapped-address rule below refuse every IPv4 address.
const PRIVATE_V4 = new net.BlockList();
const PRIVATE_V6 = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) PRIVATE_V4.addSubnet(prefix, bits, 'ipv4');
for (const [prefix, bits] of [['::', 127], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  PRIVATE_V6.addSubnet(prefix, bits, 'ipv6');
}
export function isPublic(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return !PRIVATE_V4.check(mapped[1], 'ipv4');
  return net.isIPv6(ip) ? !PRIVATE_V6.check(ip, 'ipv6') : !PRIVATE_V4.check(ip, 'ipv4');
}
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const refused = addresses.find((a) => !isPublic(a.address));
    if (refused || !addresses.length) return callback(Object.assign(new Error(`not a public address: ${hostname}`), { code: 'ENOTPUBLIC' }));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}
const MAX_REDIRECTS = 3;
const HTML_BYTES = 200000; // og:image is in the head; the rest of the page is never read
const IMAGE_BYTES = 10 * 1024 * 1024;

/** bundle id → AppleScript application name, for reading the playing tab. */
const BROWSER_APPS = {
  'com.google.Chrome': 'Google Chrome',
  'com.google.Chrome.canary': 'Google Chrome Canary',
  'com.brave.Browser': 'Brave Browser',
  'com.microsoft.edgemac': 'Microsoft Edge',
  'com.apple.Safari': 'Safari',
  'com.vivaldi.Vivaldi': 'Vivaldi',
  'com.operasoftware.Opera': 'Opera',
  'company.thebrowser.Browser': 'Arc',
};

const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/;
const warned = new Set();

// Chromium's default MediaRemote artwork, observed on Arc when a video has no thumbnail.
// This is the same image key normalize() computes; it is an app placeholder, not video art.
const CHROMIUM_PLACEHOLDER_KEY = '8e5b3282f2d4863b';
export function isBrowserPlaceholder(bundleId, artworkKey) {
  return Boolean(BROWSER_APPS[bundleId] && artworkKey === CHROMIUM_PLACEHOLDER_KEY);
}

/**
 * A shared browser icon must never share upgraded artwork between different videos, so the key
 * is the app, the title and the artwork. Not the content id: Arc hands out a new one on every
 * seek, which would fetch the thumbnail again each time you skip.
 */
export function browserArtKey({ bundleId, title, artwork }) {
  return artwork ? createHash('sha1').update(JSON.stringify([bundleId, title, artwork.key])).digest('hex').slice(0, 16) : null;
}

const run = (cmd, args, opts) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, opts, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );

function fold(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** JPEG size from the SOF marker, or null. */
export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

async function browserTabs(bundleId) {
  const app = BROWSER_APPS[bundleId];
  if (!app) return null;
  const title = bundleId === 'com.apple.Safari' ? 'name' : 'title'; // Safari's tabs have no "title"
  // Two bulk reads, not one Apple event per tab: Arc takes ~9 s for 181 tabs one at a time,
  // 0.1 s like this.
  const source = `tell application ${JSON.stringify(app)}
set ts to ${title} of every tab of every window
set us to URL of every tab of every window
end tell
set rows to {}
repeat with i from 1 to count of ts
repeat with j from 1 to count of item i of ts
try
set end of rows to (item j of item i of ts) & (character id 9) & (item j of item i of us)
end try
end repeat
end repeat
set AppleScript's text item delimiters to linefeed
return rows as text`;
  try {
    return await run('/usr/bin/osascript', ['-e', source], { timeout: 5000, maxBuffer: 4 << 20 });
  } catch (err) {
    if (!warned.has(bundleId)) {
      warned.add(bundleId);
      log.warn(`[artwork] could not read ${app} tabs (${(err.killed ? 'timed out' : err.message).trim()})`);
    }
    return null;
  }
}

export function matchingUrl(listing, title) {
  const videoTitle = text => fold(text).replace(/(?: - youtube(?: music)?| \/ x)$/, '');
  const want = videoTitle(title);
  if (!want || !listing) return null;
  const matches = new Set();
  for (const line of listing.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const tabTitle = videoTitle(line.slice(0, tab));
    const url = line.slice(tab + 1).trim();
    if (tabTitle === want && /^https?:\/\//i.test(url)) matches.add(url);
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

/**
 * GETs a public http(s) URL, following up to MAX_REDIRECTS redirects, within 8 seconds in all.
 * Reads at most `limit` bytes: past that, `truncate` keeps the start, otherwise there's nothing.
 */
function fetchBytes(href, accept, limit, { truncate = false, signal = AbortSignal.timeout(8000), redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(href);
    const literal = url.hostname.replace(/^\[|\]$/g, ''); // connecting to an IP skips the lookup
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || (net.isIP(literal) && !isPublic(literal))) {
      return resolve(null);
    }
    const get = url.protocol === 'https:' ? https.get : http.get;
    const req = get(url, { headers: { Accept: accept, 'User-Agent': 'node' }, lookup: publicLookup, signal }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return resolve(null);
        const next = new URL(res.headers.location, url).href;
        return fetchBytes(next, accept, limit, { truncate, signal, redirects: redirects + 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200 || (!truncate && Number(res.headers['content-length']) > limit)) {
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      let size = 0;
      const finish = () => resolve(size ? Buffer.concat(chunks).subarray(0, limit) : null);
      res.on('data', (chunk) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size < limit) return;
        res.destroy();
        if (truncate) finish();
        else resolve(null);
      });
      res.on('end', finish);
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function youtubeImage(url) {
  const id = YT_ID.exec(url)?.[1];
  if (!id) return null;
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    const buf = await fetchBytes(`https://i.ytimg.com/vi/${id}/${name}.jpg`, 'image/jpeg', IMAGE_BYTES).catch(() => null);
    const size = buf && jpegSize(buf);
    if (size && Math.min(size.width, size.height) >= 360) return { buf, width: size.width, height: size.height };
  }
  return null;
}

async function pageImage(url) {
  const html = await fetchBytes(url, 'text/html', HTML_BYTES, { truncate: true }).catch(() => null);
  if (!html) return null;
  const head = html.toString('utf8');
  const tag = head.match(/<meta[^>]+property=["']og:image["'][^>]*>/i) || head.match(/<meta[^>]+name=["']twitter:image["'][^>]*>/i);
  const content = tag && tag[0].match(/content=["']([^"']+)["']/i);
  if (!content) return null;
  const imageUrl = new URL(content[1], url).href;
  const buf = await fetchBytes(imageUrl, 'image/*', IMAGE_BYTES).catch(() => null);
  const size = buf && imageSize(buf);
  if (size && Math.min(size.width, size.height) >= 360) return { buf, width: size.width, height: size.height };
  return null;
}

function imageSize(buf) {
  const jpeg = jpegSize(buf);
  if (jpeg) return jpeg;
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

/**
 * MediaRemote's browser artwork is often a tiny thumbnail. When the playing tab is visible
 * to AppleScript, prefer that page's larger image (a YouTube thumbnail, or og:image).
 * @returns {Promise<{buf: Buffer, width: number, height: number}|null>}
 */
export async function largerBrowserArt(bundleId, title) {
  const listing = await browserTabs(bundleId);
  const url = matchingUrl(listing, title);
  if (!url) return null;
  return (await youtubeImage(url)) || pageImage(url);
}
