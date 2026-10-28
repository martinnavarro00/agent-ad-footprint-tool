'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/report');

const crawl = [
  { ok: true, domain: 'www.a.de', adSetup: 'Prebid (header bidding)', prebid: true, prebidOnlyAfterConsent: true, consent: { clicked: true }, afterConsent: { bidders: ['criteo', 'pubmatic'] }, adsTxt: { present: true }, vendors: ['Criteo'] },
  { ok: true, domain: 'b.de', adSetup: 'Google Ad Manager only', prebid: false, consent: { clicked: false }, beforeConsent: { bidders: [] }, vendors: ['Google Ad Manager (GPT)', 'Meta Pixel'] },
  { ok: false, domain: 'c.de', error: 'timeout' },
];

test('site rows keep reachable sites and normalise fields', () => {
  const rows = r.siteRows(crawl, 'News');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { list: 'News', domain: 'a.de', setup: 'Prebid (header bidding)', prebid: 'yes', prebid_after_consent_only: 'yes', banner_clicked: 'yes', prebid_bidders: 2, ads_txt: 'yes', vendors: 'Criteo' });
});

test('list summary and setup shares', () => {
  const rows = r.siteRows(crawl, 'News');
  const [s] = r.listSummary(rows);
  assert.equal(s.prebid, 1);
  assert.equal(s.prebid_share, 0.5);
  assert.equal(s.after_only_share, 1);
  assert.equal(r.setupShares(rows).length, 2);
});

test('vendors on non-Prebid sites get their role', () => {
  const v = r.nonPrebidVendors(r.siteRows(crawl, 'News'), [{ name: 'Meta Pixel', role: 'tracking' }]);
  assert.deepEqual(v.find((x) => x.vendor === 'Meta Pixel'), { vendor: 'Meta Pixel', role: 'tracking', sites: 1 });
  assert.equal(v.find((x) => x.vendor === 'Google Ad Manager (GPT)').role, 'other');
});

test('agent runs: decision from log, retargeting from visited sites', () => {
  const meas = [
    { condition: 'agent', label: 'agent_B_run2', timestamp: '2026-10-27T00:00:00Z', url: 'https://www.chip.de/', cookiesAtStart: 400, bids: [{ phase: 'after', adId: '1', bidder: 'x', advertiser: 'idealo.de', cpm: 1 }] },
    { condition: 'agent', label: 'agent_A_run1', timestamp: '2026-10-20T00:00:00Z', url: 'https://www.chip.de/', cookiesAtStart: 20, bids: [] },
    { condition: 'baseline', label: 'baseline', timestamp: '2026-10-27T00:00:00Z', url: 'https://www.chip.de/', bids: [{ phase: 'after', adId: '2', bidder: 'x', cpm: 3 }] },
  ];
  const log = [{ step: 'agent', label: 'agent_B_run2', consentDecision: 'accepted', pagesVisited: ['https://www.idealo.de/x', 'https://runnersworld.de/'] }];
  const runs = r.agentRuns(meas, log);
  assert.equal(runs[0].run_label, 'agent_A_run1');
  assert.equal(runs[0].cookie_decision, 'not recorded');
  assert.equal(runs[0].visited_shops_that_bid, '(no transcript)');
  assert.equal(runs[1].cookie_decision, 'accepted');
  assert.equal(runs[1].visited_shops_that_bid, 'idealo.de');
  const bids = r.bidsByCondition(meas);
  assert.deepEqual(bids.map((b) => b.condition), ['Agent A', 'Agent B', 'Baseline']);
  assert.equal(r.decisionsByVariant(runs).find((d) => d.variant === 'B').accepted, 1);
});
