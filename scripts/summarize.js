#!/usr/bin/env node
'use strict';

/**
 * Compare baseline and agent measurements.
 *
 *   npm run summarize
 *   npm run summarize -- --file data/pilot-2026-10-19/measurements.jsonl
 *   npm run summarize -- --shops sportscheck.com,intersport.de,idealo.de
 *   npm run summarize -- --save        also writes results/summary_<date>_<time>.txt
 *
 * Prints (1) one row per visit, (2) per-condition averages, and (3) the
 * advertisers that bid on agent profiles but never on a baseline profile,
 * which is the main retargeting signal.
 * Only the "after" phase is compared (bids are consent-gated).
 */

const fs = require('node:fs');
const path = require('node:path');
const { Console } = require('node:console');
const { Writable } = require('node:stream');
const { parseArgs } = require('node:util');
const { PATHS } = require('../src/config');
const { readRecords } = require('../src/measure');
const { dedupe, summarize, median } = require('../src/bidStore');

const avg = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : null);

function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: PATHS.measurements },
      shops: { type: 'string', default: '' },
      save: { type: 'boolean', default: false },
    },
  });

  // Everything printed goes to the terminal and, with --save, also into a text file.
  const printed = [];
  const out = new Writable({
    write(chunk, _enc, done) {
      process.stdout.write(chunk);
      printed.push(chunk);
      done();
    },
  });
  const report = new Console(out);

  const records = readRecords(values.file);
  if (records.length === 0) {
    report.log(`No measurements in ${path.relative(process.cwd(), values.file)} yet. Run \`npm run measure\` first.`);
    return;
  }

  // Re-summarize from raw bids so old and new records are treated identically.
  const rows = records.map((r) => {
    const after = summarize(dedupe(r.bids.filter((b) => b.phase === 'after')));
    const site = new URL(r.url).hostname.replace(/^www\./, '');
    return { ...r, site, after };
  });

  report.log('\nVisits (after consent)');
  report.table(
    rows.map((r) => ({
      timeUtc: r.timestamp.slice(0, 16).replace('T', ' '),
      site: r.site,
      condition: r.condition,
      label: r.label,
      run: r.run,
      cookiesAtStart: r.cookiesAtStart ?? '-',
      bids: r.after.bids,
      medianCpm: r.after.medianCpm,
      meanCpm: r.after.meanCpm,
      advertisers: r.after.advertisers.length,
    })),
  );

  // One row per news site and condition (bids differ a lot between sites).
  const groups = [...new Set(rows.map((r) => `${r.site}|${r.condition}`))].sort();
  report.log('Per site and condition (each visit counts once)');
  report.table(
    groups.map((key) => {
      const [site, condition] = key.split('|');
      const group = rows.filter((r) => r.site === site && r.condition === condition);
      return {
        site,
        condition,
        visits: group.length,
        avgBids: avg(group.map((r) => r.after.bids)),
        medianOfVisitMedianCpm: median(group.map((r) => r.after.medianCpm).filter((x) => x !== null)),
        avgAdvertisers: avg(group.map((r) => r.after.advertisers.length)),
      };
    }),
  );

  // Conservative: an advertiser counts as "agent only" if it never bid on ANY baseline visit, on any site.
  const baselineAdvertisers = new Set(
    rows.filter((r) => r.condition.startsWith('baseline')).flatMap((r) => r.after.advertisers),
  );
  const onlyAgent = new Map();
  for (const r of rows.filter((x) => x.condition === 'agent')) {
    for (const adv of r.after.advertisers) {
      if (baselineAdvertisers.has(adv)) continue;
      if (!onlyAgent.has(adv)) onlyAgent.set(adv, []);
      onlyAgent.get(adv).push(`${r.label} @ ${r.site}`);
    }
  }

  const shops = values.shops.split(',').map((s) => s.trim()).filter(Boolean);
  report.log('Advertisers seen ONLY on agent profiles (candidate retargeting)');
  if (onlyAgent.size === 0) report.log('  none');
  for (const [adv, labels] of [...onlyAgent].sort((a, b) => b[1].length - a[1].length)) {
    const visited = shops.some((s) => adv.includes(s)) ? '  <-- shop the agent visited' : '';
    report.log(`  ${adv}  (${labels.join(', ')})${visited}`);
  }
  if (baselineAdvertisers.size === 0) {
    report.log('\nNote: no baseline visits found, so every agent advertiser is listed.');
  }

  if (values.save) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const file = path.join(PATHS.results, `summary_${stamp}.txt`);
    fs.mkdirSync(PATHS.results, { recursive: true });
    const header = `Summary of ${path.relative(process.cwd(), values.file)} (${records.length} visits), created ${new Date().toISOString()}\n`;
    fs.writeFileSync(file, header + Buffer.concat(printed.map((c) => Buffer.from(c))).toString());
    process.stdout.write(`\nSaved to ${path.relative(process.cwd(), file)}\n`);
  }
}

main();
