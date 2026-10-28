'use strict';

/**
 * Aggregations behind the results report (scripts/report.js).
 * Pure functions over the records in results/*.jsonl, covered by test/report.test.js.
 */

const { dedupe } = require('./bidStore');

const host = (url) => new URL(url).hostname.replace(/^www\./, '');
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 2) => (x === null || x === undefined ? null : Number(x.toFixed(d)));

/** One row per reachable site of a prevalence crawl. */
function siteRows(records, list) {
  return records
    .filter((r) => r.ok)
    .map((r) => {
      const g = r.afterConsent || r.beforeConsent || {};
      return {
        list,
        domain: r.domain.replace(/^www\./, ''),
        setup: r.adSetup || 'unknown',
        prebid: r.prebid ? 'yes' : 'no',
        prebid_after_consent_only: r.prebidOnlyAfterConsent ? 'yes' : 'no',
        banner_clicked: r.consent?.clicked ? 'yes' : 'no',
        prebid_bidders: (g.bidders || []).length,
        ads_txt: r.adsTxt?.present ? 'yes' : 'no',
        vendors: (r.vendors || []).join('; '),
      };
    });
}

/** Headline numbers per list. */
function listSummary(rows) {
  const lists = [...new Set(rows.map((r) => r.list))];
  return lists.map((list) => {
    const s = rows.filter((r) => r.list === list);
    const prebid = s.filter((r) => r.prebid === 'yes').length;
    const count = (f) => s.filter(f).length;
    return {
      list,
      reachable: s.length,
      prebid,
      prebid_share: s.length ? prebid / s.length : 0,
      after_only_share: prebid ? count((r) => r.prebid_after_consent_only === 'yes') / prebid : 0,
      no_adtech_share: s.length ? count((r) => r.setup === 'No third-party ad tech detected') / s.length : 0,
      banner_share: s.length ? count((r) => r.banner_clicked === 'yes') / s.length : 0,
    };
  });
}

/** Sites per ad-setup label, per list. */
function setupShares(rows) {
  const out = [];
  for (const list of new Set(rows.map((r) => r.list))) {
    const s = rows.filter((r) => r.list === list);
    const counts = new Map();
    for (const r of s) counts.set(r.setup, (counts.get(r.setup) || 0) + 1);
    for (const [setup, sites] of counts) out.push({ list, setup, sites, share: sites / s.length });
  }
  return out;
}

/** Vendors on sites without Prebid (each domain once across lists). */
function nonPrebidVendors(rows, vendorRoles) {
  const role = new Map(vendorRoles.map((v) => [v.name, v.role]));
  const byDomain = new Map();
  for (const r of rows) if (r.prebid === 'no') byDomain.set(r.domain, r);
  const counts = new Map();
  for (const r of byDomain.values()) for (const v of r.vendors.split('; ').filter(Boolean)) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].map(([vendor, sites]) => ({ vendor, role: role.get(vendor) || 'other', sites })).sort((a, b) => b.sites - a.sites);
}

const afterBids = (m) => dedupe((m.bids || []).filter((b) => b.phase === 'after'));

/**
 * One row per agent run: decision from the overnight transcript (if any), cookies in the
 * profile, sites visited, and visited sites that later bid on its profile (retargeting signal).
 */
function agentRuns(measurements, overnightLog) {
  const log = new Map(overnightLog.filter((r) => r.step === 'agent').map((r) => [r.label, r]));
  const agent = measurements.filter((m) => m.condition === 'agent').sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const labels = [...new Set(agent.map((m) => m.label))];
  return labels
    .map((label) => {
      const ms = agent.filter((m) => m.label === label);
      const li = log.get(label);
      const visited = [...new Set((li?.pagesVisited || []).map(host))].sort();
      const roots = visited.map((d) => d.split('.')[0]);
      const advertisers = new Set(ms.flatMap((m) => afterBids(m).map((b) => b.advertiser).filter(Boolean)));
      const shopsThatBid = [...advertisers].filter((a) => roots.some((r) => a.includes(r))).sort();
      const [, variant, run] = label.match(/^agent_([A-Za-z]+)_run(\d+)$/) || [null, '?', '0'];
      return {
        run_label: label,
        variant,
        run: Number(run),
        cookie_decision: li?.consentDecision || 'not recorded',
        cookies: ms[0].cookiesAtStart,
        pages_visited: li?.pagesVisited ? li.pagesVisited.length : '',
        sites_visited: visited.join(', '),
        // Without a transcript we don't know the visited sites, so retargeting can't be checked.
        visited_shops_that_bid: li ? shopsThatBid.join(', ') : '(no transcript)',
        mode: li ? 'headless (overnight)' : 'interactive',
      };
    })
    .sort((a, b) => a.run - b.run || a.variant.localeCompare(b.variant));
}

/** Average bids, median CPM and advertisers per news site and condition. */
function bidsByCondition(measurements) {
  const groups = new Map();
  for (const m of measurements) {
    const cond = m.condition === 'agent' ? `Agent ${(m.label.match(/^agent_([A-Za-z]+)_/) || [])[1] || '?'}` : 'Baseline';
    const key = `${host(m.url)}|${cond}`;
    if (!groups.has(key)) groups.set(key, []);
    const bids = afterBids(m);
    groups.get(key).push({
      bids: bids.length,
      med: median(bids.map((b) => b.cpm)),
      adv: new Set(bids.map((b) => b.advertiser).filter(Boolean)).size,
    });
  }
  return [...groups]
    .map(([key, v]) => {
      const [site, condition] = key.split('|');
      return {
        site,
        condition,
        visits: v.length,
        avg_bids: round(v.reduce((a, x) => a + x.bids, 0) / v.length, 1),
        median_cpm_eur: round(median(v.map((x) => x.med))),
        avg_advertisers: round(v.reduce((a, x) => a + x.adv, 0) / v.length, 1),
      };
    })
    .sort((a, b) => a.site.localeCompare(b.site) || a.condition.localeCompare(b.condition));
}

/** Decision counts per variant (runs with a recorded decision only). */
function decisionsByVariant(runs) {
  return [...new Set(runs.map((r) => r.variant))].sort().map((variant) => {
    const s = runs.filter((r) => r.variant === variant && r.cookie_decision !== 'not recorded');
    const n = (d) => s.filter((r) => r.cookie_decision === d).length;
    return { variant, recorded: s.length, accepted: n('accepted'), rejected: n('rejected'), no_click: n('no banner clicked') };
  });
}

module.exports = { siteRows, listSummary, setupShares, nonPrebidVendors, agentRuns, bidsByCondition, decisionsByVariant, median };
