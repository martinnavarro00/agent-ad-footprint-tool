#!/usr/bin/env node
'use strict';

/**
 * How many commonly used websites use Prebid.js, and what do the others use to show ads?
 *
 * Visits the homepage of every site in a list, checks for Prebid before and
 * after accepting the cookie banner, records which ad-tech vendors the page
 * loads (Google Ad Manager, AdSense, Amazon, Taboola, exchanges, tracking
 * pixels), checks /ads.txt, and appends one line per site to
 * results/prevalence.jsonl. Re-running continues where it stopped.
 *
 *   npm run prevalence -- --list data/lists/tranco.csv --top 1000
 *   npm run prevalence -- --list my_sites.txt --concurrency 6
 *   npm run prevalence:summary
 *
 * The list can be a CrUX CSV ("origin,rank"), a Tranco CSV ("rank,domain"),
 * one domain per line, or one URL per line.
 * Run `npm run prevalence -- --help` for all options.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { chromium } = require('playwright');

const { BROWSER, PATHS, ROOT } = require('../src/config');
const { handleConsent } = require('../src/consent');
const { PREBID_URL, readAdTechGlobals, AD_VENDORS, matchVendors, classifyAdSetup } = require('../src/detectAdTech');
const { readRecords, appendRecord } = require('../src/measure');

const DEFAULT_OUT = path.join(PATHS.results, 'prevalence.jsonl');

const HELP = `
Usage: npm run prevalence -- --list <file> [options]
       npm run prevalence:summary [-- --out <file>]

Options
  --list          CrUX CSV (origin,rank), Tranco CSV (rank,domain), domains or URLs (one per line)
  --top           only the first N domains of the list (default: all)
  --tld           only domains ending in this TLD, e.g. de (applied before --top)
  --concurrency   sites visited in parallel (default 4)
  --wait          seconds to wait after load and after consent (default 5)
  --timeout       page load timeout in seconds (default 20)
  --channel       chrome | chromium (default chrome)
  --headed        show the browser windows (default: headless)
  --out           output file (default results/prevalence.jsonl)
  --exclude-adult skip adult/malware sites (Cloudflare for Families DNS + keyword check);
                  skipped sites are neither visited nor saved
  --summary       print the summary of an existing output file and exit
`;

function parseCli() {
  const { values } = parseArgs({
    options: {
      list: { type: 'string' },
      top: { type: 'string' },
      tld: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      wait: { type: 'string', default: '5' },
      timeout: { type: 'string', default: '20' },
      channel: { type: 'string', default: 'chrome' },
      headed: { type: 'boolean', default: false },
      out: { type: 'string', default: DEFAULT_OUT },
      summary: { type: 'boolean', default: false },
      'exclude-adult': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!values.summary && (!values.list || !fs.existsSync(values.list))) {
    console.error(`Error: --list <file> is required and must exist\n${HELP}`);
    process.exit(1);
  }
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`Error: --${name} must be a positive number`);
      process.exit(1);
    }
    return n;
  };
  return {
    ...values,
    excludeAdult: values['exclude-adult'],
    top: values.top ? num(values.top, 'top') : Infinity,
    concurrency: num(values.concurrency, 'concurrency'),
    waitMs: num(values.wait, 'wait') * 1000,
    timeoutMs: num(values.timeout, 'timeout') * 1000,
  };
}

/** Read CrUX (origin,rank), Tranco (rank,domain), domain-per-line or URL-per-line files. */
function readDomainList(file, { tld, top }) {
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rank;
    let domain;
    let url;
    if (/^https?:\/\//i.test(trimmed)) {
      // Full URL (an article page, or a CrUX origin followed by ",rank").
      const [first, second] = trimmed.split(',');
      try {
        url = new URL(first).href;
        domain = new URL(first).host;
      } catch {
        continue;
      }
      rank = second && Number.isFinite(Number(second)) ? Number(second) : entries.length + 1;
    } else {
      const parts = trimmed.split(',');
      [rank, domain] = parts.length > 1 ? [Number(parts[0]), parts[1].trim()] : [entries.length + 1, parts[0]];
      if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) continue; // skip headers / junk
      domain = domain.toLowerCase();
      url = `https://${domain}/`;
    }
    if (tld && !domain.toLowerCase().split(':')[0].endsWith(`.${tld.replace(/^\./, '').toLowerCase()}`)) continue;
    entries.push({ rank, domain, url });
    if (entries.length >= top) break;
  }
  return entries;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Obvious adult keywords in the host name (backup for the DNS check). */
const ADULT_KEYWORDS = /porn|xxx|sex|hentai|rule34|xvideo|xhamster|nsfw|camgirl|onlyfans|escort|fetish|erotik|milf/i;

/**
 * Should this site be skipped by the adult filter?
 * Cloudflare for Families (1.1.1.3) answers 0.0.0.0 for domains it classifies as adult or
 * malware; we query it over DNS-over-HTTPS. If the lookup fails, only the keyword check applies.
 * @returns {Promise<string|null>} reason for exclusion, or null to visit the site
 */
async function adultFilterReason(host) {
  const hostname = host.split(':')[0];
  if (ADULT_KEYWORDS.test(hostname)) return 'adult filter: keyword';
  try {
    const res = await fetch(`https://family.cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if ((data.Answer || []).some((a) => a.data === '0.0.0.0')) return 'adult filter: Cloudflare for Families';
  } catch (_) {
    /* DNS check unavailable: fall back to keyword check only */
  }
  return null;
}

/**
 * ads.txt (IAB standard): sites that sell ads programmatically publish a list of
 * authorised sellers at /ads.txt. A file with seller lines means "this site sells ads".
 */
async function checkAdsTxt(context, pageUrl) {
  try {
    const res = await context.request.get(new URL('/ads.txt', pageUrl).href, { timeout: 10000, maxRedirects: 3 });
    if (!res.ok()) return { present: false, status: res.status() };
    const text = (await res.text()).slice(0, 500000);
    const sellerLines = text.split(/\r?\n/).filter((l) => /,\s*(DIRECT|RESELLER)\b/i.test(l)).length;
    return { present: sellerLines > 0, sellerLines };
  } catch (err) {
    return { present: false, error: err.message.split('\n')[0].slice(0, 100) };
  }
}

/** Visit one site in a fresh browser context and record what was found. */
async function checkSite(browser, { rank, domain, url }, opts) {
  const record = { rank, domain, url, timestamp: new Date().toISOString(), ok: false };
  const context = await browser.newContext({
    locale: BROWSER.locale,
    timezoneId: BROWSER.timezoneId,
    viewport: BROWSER.viewport,
  });
  const prebidScripts = new Set();
  const vendors = new Set();
  try {
    const page = await context.newPage();
    page.on('request', (req) => {
      const reqUrl = req.url();
      if (req.resourceType() === 'script' && PREBID_URL.test(reqUrl)) prebidScripts.add(reqUrl.split('?')[0]);
      for (const name of matchVendors(reqUrl)) vendors.add(name);
    });

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    record.status = response ? response.status() : null;
    record.finalUrl = page.url();

    await sleep(opts.waitMs);
    record.beforeConsent = await page.evaluate(readAdTechGlobals);
    record.vendorsBeforeConsent = [...vendors].sort();

    record.consent = await handleConsent(page, 'accept');
    if (record.consent.clicked) {
      await sleep(opts.waitMs);
      record.afterConsent = await page.evaluate(readAdTechGlobals);
    }

    const final = record.afterConsent || record.beforeConsent;
    record.prebidScripts = [...prebidScripts].slice(0, 5);
    record.prebid = final.prebid || record.beforeConsent.prebid || prebidScripts.size > 0;
    record.prebidOnlyAfterConsent = !record.beforeConsent.prebid && !!record.afterConsent?.prebid;
    record.vendors = [...vendors].sort();
    record.adSetup = classifyAdSetup({
      prebid: record.prebid,
      vendors: record.vendors,
      gpt: !!(record.beforeConsent.gpt || record.afterConsent?.gpt),
      apstag: !!(record.beforeConsent.apstag || record.afterConsent?.apstag),
    });
    record.adsTxt = await checkAdsTxt(context, record.finalUrl);
    record.ok = true;
  } catch (err) {
    record.error = err.message.split('\n')[0].slice(0, 200);
  } finally {
    await context.close().catch(() => {});
  }
  return record;
}

function pct(part, whole) {
  return whole ? `${((100 * part) / whole).toFixed(1)}%` : '-';
}

function printSummary(file) {
  const all = readRecords(file);
  const excludedCount = all.filter((r) => r.excluded).length;
  const records = all.filter((r) => !r.excluded); // excluded sites are not part of any share
  if (all.length === 0) {
    console.log(`No results in ${path.relative(process.cwd(), file)} yet.`);
    return;
  }
  const ok = records.filter((r) => r.ok);
  const prebid = ok.filter((r) => r.prebid);
  const any = (r, key) => !!(r.beforeConsent?.[key] || r.afterConsent?.[key]);

  console.log(`\nPrebid prevalence (${path.relative(process.cwd(), file)})`);
  console.table([
    ...(excludedCount ? [{ measure: 'skipped by adult filter (not counted below)', value: excludedCount, share: '' }] : []),
    { measure: 'sites visited (attempted)', value: records.length, share: '' },
    { measure: 'reachable', value: ok.length, share: pct(ok.length, records.length) },
    { measure: 'Prebid.js found', value: prebid.length, share: pct(prebid.length, ok.length) },
    {
      measure: '  ...only after accepting cookies',
      value: ok.filter((r) => r.prebidOnlyAfterConsent).length,
      share: pct(ok.filter((r) => r.prebidOnlyAfterConsent).length, prebid.length) + ' of Prebid sites',
    },
    { measure: 'Google Publisher Tag', value: ok.filter((r) => any(r, 'gpt')).length, share: pct(ok.filter((r) => any(r, 'gpt')).length, ok.length) },
    { measure: 'Amazon apstag', value: ok.filter((r) => any(r, 'apstag')).length, share: pct(ok.filter((r) => any(r, 'apstag')).length, ok.length) },
    { measure: 'cookie banner clicked', value: ok.filter((r) => r.consent?.clicked).length, share: pct(ok.filter((r) => r.consent?.clicked).length, ok.length) },
  ]);

  // What do sites use to show ads? One label per site.
  const setups = new Map();
  for (const r of ok) setups.set(r.adSetup || '(not recorded)', (setups.get(r.adSetup || '(not recorded)') || 0) + 1);
  console.log('How sites show ads (one label per site, highest-priority match)');
  console.table([...setups].sort((a, b) => b[1] - a[1]).map(([setup, sites]) => ({ setup, sites, share: pct(sites, ok.length) })));

  const withAds = ok.filter((r) => r.adSetup && !/^No /.test(r.adSetup));
  const adsTxt = ok.filter((r) => r.adsTxt?.present);
  console.log('Sites that show or sell ads');
  console.table([
    { measure: 'ad tech detected on the page', sites: withAds.length, share: pct(withAds.length, ok.length) },
    { measure: 'ads.txt with sellers', sites: adsTxt.length, share: pct(adsTxt.length, ok.length) },
    { measure: 'Prebid, among sites with ad tech', sites: withAds.filter((r) => r.prebid).length, share: pct(withAds.filter((r) => r.prebid).length, withAds.length) },
  ]);

  const vendorCount = new Map();
  for (const r of ok) for (const v of r.vendors || []) vendorCount.set(v, (vendorCount.get(v) || 0) + 1);
  if (vendorCount.size) {
    const roleOf = new Map(AD_VENDORS.map((v) => [v.name, v.role]));
    console.log('Ad-tech vendors found (a site can have several)');
    console.table(
      [...vendorCount].sort((a, b) => b[1] - a[1]).map(([vendor, sites]) => ({ vendor, role: roleOf.get(vendor), sites, share: pct(sites, ok.length) })),
    );
  }

  // Prevalence by popularity bucket (CrUX / Tranco rank)
  const buckets = [1000, 10000, 100000, Infinity];
  const rows = [];
  let lower = 0;
  for (const upper of buckets) {
    const inBucket = ok.filter((r) => r.rank > lower && r.rank <= upper);
    if (inBucket.length) {
      rows.push({
        ranks: `${lower + 1}-${upper === Infinity ? 'end' : upper}`,
        reachable: inBucket.length,
        prebid: inBucket.filter((r) => r.prebid).length,
        share: pct(inBucket.filter((r) => r.prebid).length, inBucket.length),
      });
    }
    lower = upper;
  }
  console.log('By rank');
  console.table(rows);

  const bidderCount = new Map();
  for (const r of prebid) {
    const bidders = new Set([...(r.beforeConsent?.bidders || []), ...(r.afterConsent?.bidders || [])]);
    for (const b of bidders) bidderCount.set(b, (bidderCount.get(b) || 0) + 1);
  }
  const topBidders = [...bidderCount].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (topBidders.length) {
    console.log('Most common bidders configured on Prebid sites');
    console.table(topBidders.map(([bidder, sites]) => ({ bidder, sites, share: pct(sites, prebid.length) })));
  }

  const errors = records.filter((r) => !r.ok).length;
  if (errors) console.log(`${errors} sites could not be loaded (see "error" in the file).`);
}

async function main() {
  const opts = parseCli();
  if (opts.summary) {
    printSummary(opts.out);
    return;
  }

  const all = readDomainList(opts.list, opts);
  const done = new Set(readRecords(opts.out).map((r) => r.url || `https://${r.domain}/`));
  const todo = all.filter((e) => !done.has(e.url));
  console.log(`${all.length} domains in list, ${done.size} already done, ${todo.length} to visit.`);

  const browser = await chromium.launch({
    channel: opts.channel === 'chromium' ? undefined : opts.channel,
    headless: !opts.headed,
    args: BROWSER.args,
  });

  let next = 0;
  let finished = 0;
  let found = 0;
  let skipped = 0;
  const worker = async () => {
    while (next < todo.length) {
      const entry = todo[next];
      next += 1;
      const excluded = opts.excludeAdult ? await adultFilterReason(entry.domain) : null;
      if (excluded) {
        // Not visited and not written to the results file.
        skipped += 1;
        finished += 1;
        console.log(`[${finished}/${todo.length}] #${entry.rank} ${entry.domain}: skipped (${excluded})`);
        continue;
      }
      const record = await checkSite(browser, entry, opts);
      appendRecord(opts.out, record); // written immediately: safe to stop with Ctrl+C
      finished += 1;
      if (record.prebid) found += 1;
      const tag = !record.ok ? `error: ${record.error}` : record.prebid ? 'PREBID' : '-';
      console.log(`[${finished}/${todo.length}] #${entry.rank} ${entry.domain}: ${tag}`);
    }
  };

  try {
    await Promise.all(Array.from({ length: opts.concurrency }, worker));
  } finally {
    await browser.close();
  }
  console.log(`\nDone. Prebid found on ${found} of ${finished - skipped} sites visited in this session.`);
  if (skipped) console.log(`${skipped} sites skipped by the adult filter (not visited, not saved).`);
  printSummary(opts.out);
  console.log(`Raw results: ${path.relative(ROOT, opts.out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
