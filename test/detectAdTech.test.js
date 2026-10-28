'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchVendors, classifyAdSetup } = require('../src/detectAdTech');

test('Google Ad Manager and other DoubleClick traffic are told apart', () => {
  assert.deepEqual(matchVendors('https://securepubads.g.doubleclick.net/tag/js/gpt.js'), ['Google Ad Manager (GPT)']);
  assert.deepEqual(matchVendors('https://ad.doubleclick.net/ddm/x'), ['Google DV360 / ad delivery']);
});

test('unrelated requests match no vendor', () => {
  assert.deepEqual(matchVendors('https://www.tagesspiegel.de/app.js'), []);
});

test('classification follows priority: Prebid > Amazon > GAM > AdSense > native > exchanges > tracking', () => {
  const base = { prebid: false, vendors: [], gpt: false, apstag: false };
  assert.equal(classifyAdSetup({ ...base, prebid: true, gpt: true }), 'Prebid (header bidding)');
  assert.equal(classifyAdSetup({ ...base, apstag: true, gpt: true }), 'Amazon TAM, no Prebid');
  assert.equal(classifyAdSetup({ ...base, gpt: true }), 'Google Ad Manager only');
  assert.equal(classifyAdSetup({ ...base, vendors: ['Google AdSense'] }), 'Google AdSense');
  assert.equal(classifyAdSetup({ ...base, vendors: ['Taboola', 'Meta Pixel'] }), 'Native widgets only (Taboola/Outbrain/Plista)');
  assert.equal(classifyAdSetup({ ...base, vendors: ['Criteo'] }), 'Other ad exchanges');
  assert.equal(classifyAdSetup({ ...base, vendors: ['Meta Pixel'] }), 'No ads, but ad-tracking pixels');
  assert.equal(classifyAdSetup(base), 'No third-party ad tech detected');
});
