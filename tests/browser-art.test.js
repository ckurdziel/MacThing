import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserArtKey, isBrowserPlaceholder, isPublic, matchingUrl } from '../bridge/nowplaying/browser-art.js';
import { normalize } from '../bridge/nowplaying/mediaremote.js';

test('videos sharing artwork do not share upgraded thumbnails', () => {
  const first = { bundleId: 'company.thebrowser.Browser', title: 'First video', contentId: 'first', artwork: { key: 'shared-image' } };
  assert.notEqual(browserArtKey(first), browserArtKey({ ...first, title: 'Second video', contentId: 'second' }));
  assert.notEqual(browserArtKey(first), browserArtKey({ ...first, bundleId: 'com.google.Chrome' }));
  // Arc gives the same video a new content id on every seek; that mustn't refetch its thumbnail.
  assert.equal(browserArtKey(first), browserArtKey({ ...first, contentId: '1894DD9D-E73A-4098-8C3F-BE68D424DA48' }));
  assert.equal(browserArtKey(first), browserArtKey({ ...first, elapsed: 42, playing: false }));
  assert.equal(browserArtKey({ ...first, artwork: null }), null);
});

test('only an unambiguous complete tab title can supply a thumbnail', () => {
  const exact = 'https://www.youtube.com/watch?v=abcdefghijk';
  const longer = 'https://www.youtube.com/watch?v=lmnopqrstuv';
  assert.equal(matchingUrl(`Example - YouTube\t${exact}\nExample extended - YouTube\t${longer}`, 'Example'), exact);
  assert.equal(matchingUrl(`Example extended - YouTube\t${longer}`, 'Example'), null);
  assert.equal(matchingUrl(`Example - YouTube\t${exact}\nExample - YouTube\t${longer}`, 'Example'), null);
  assert.equal(matchingUrl(`Example - YouTube\t${exact}\nExample - YouTube\t${exact}`, 'Example'), exact);
  assert.equal(matchingUrl('Example\tfile:///private/example', 'Example'), null);
});

test('the known Chromium icon is a placeholder only for browsers', () => {
  assert.equal(isBrowserPlaceholder('company.thebrowser.Browser', '8e5b3282f2d4863b'), true);
  assert.equal(isBrowserPlaceholder('com.apple.Music', '8e5b3282f2d4863b'), false);
  assert.equal(isBrowserPlaceholder('company.thebrowser.Browser', 'real-thumbnail'), false);
});

test('missing thumbnails stay absent while media identity remains available', () => {
  const snapshot = normalize({ title: 'Video without artwork', bundleIdentifier: 'company.thebrowser.Browser', contentItemIdentifier: 'video-1' });
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.artwork, null);
  assert.equal(snapshot.contentId, 'video-1');
});

test('artwork lookups reach public hosts but never this Mac or the local network', () => {
  for (const ip of ['142.251.152.4', '8.8.8.8', '2606:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublic(ip), true, ip);
  for (const ip of [
    '127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1',
  ]) assert.equal(isPublic(ip), false, ip);
});
