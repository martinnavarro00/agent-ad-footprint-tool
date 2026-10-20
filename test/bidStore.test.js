'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BidStore, bidKey, summarize, median, dedupe } = require('../src/bidStore');

const bid = (overrides = {}) => ({
  adId: null,
  instance: 'pbjs',
  slot: 'iqadtile5',
  bidder: 'criteo',
  advertiser: 'hoeffner.de',
  cpm: 0.80011,
  size: '970x250',
  creativeId: '11482832',
  ...overrides,
});

test('same bid from two Prebid APIs with rounded CPM is counted once', () => {
  const store = new BidStore();
  store.add({ bids: [bid(), bid({ cpm: 0.8, version: 'v11.14.0' })] }, 'after');
  assert.equal(store.bids().length, 1);
  assert.equal(store.bids()[0].cpm, 0.80011, 'keeps the first (unrounded) CPM');
  assert.equal(store.bids()[0].version, 'v11.14.0', 'fills in missing version');
});

test('adId is the identity when present', () => {
  assert.notEqual(bidKey(bid({ adId: 'a1' })), bidKey(bid({ adId: 'a2' })));
  assert.equal(bidKey(bid({ adId: 'a1', cpm: 1 })), bidKey(bid({ adId: 'a1', cpm: 2 })));
});

test('a bid keeps the phase in which it was first seen', () => {
  const store = new BidStore();
  store.add({ bids: [bid({ adId: 'x' })] }, 'before');
  store.add({ bids: [bid({ adId: 'x' }), bid({ adId: 'y' })] }, 'after');
  assert.equal(store.bids('before').length, 1);
  assert.equal(store.bids('after').length, 1);
});

test('entries without a bidder (instance presence markers) are ignored', () => {
  const store = new BidStore();
  store.add({ bids: [{ instance: 'pbjs', bidder: null }], instances: [{ name: 'pbjs', version: 'v1' }] }, 'after');
  assert.equal(store.bids().length, 0);
  assert.deepEqual(store.instances(), [{ name: 'pbjs', version: 'v1' }]);
});

test('summarize reports counts, advertisers and robust CPM statistics', () => {
  const s = summarize([
    bid({ adId: '1', cpm: 1 }),
    bid({ adId: '2', cpm: 2, advertiser: 'lidl.de', slot: 'b' }),
    bid({ adId: '3', cpm: 9, advertiser: null }),
  ]);
  assert.equal(s.bids, 3);
  assert.equal(s.slots, 2);
  assert.deepEqual(s.advertisers, ['hoeffner.de', 'lidl.de']);
  assert.equal(s.medianCpm, 2);
  assert.equal(s.meanCpm, 4);
  assert.equal(s.maxCpm, 9);
});

test('summarize handles no bids', () => {
  const s = summarize([]);
  assert.equal(s.bids, 0);
  assert.equal(s.meanCpm, null);
  assert.equal(s.medianCpm, null);
});

test('median of even and odd lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('dedupe works on plain lists of old records', () => {
  assert.equal(dedupe([bid(), bid({ cpm: 0.8 }), bid({ slot: 'other' })]).length, 2);
});
