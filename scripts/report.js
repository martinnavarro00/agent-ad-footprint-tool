#!/usr/bin/env node
'use strict';

/**
 * Build the results report from whatever is in results/.
 *
 *   npm run report
 *
 * Reads results/prevalence_*.jsonl (crawls), results/measurements.jsonl and
 * results/overnight_log.jsonl (agent experiment) and writes:
 *   results/report/index.html   self-contained page (open in a browser, commit, share)
 *   results/report/data/*.json  the same tables as data files (also used for the online dashboard)
 * Re-run it after every crawl or overnight run.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, ROOT } = require('../src/config');
const { readRecords } = require('../src/measure');
const { AD_VENDORS } = require('../src/detectAdTech');
const report = require('../src/report');

// Display names for known crawl files; other prevalence_*.jsonl files use their file name.
const LIST_NAMES = {
  prevalence_news_de: 'German news sites',
  prevalence_crux_de: 'Popular sites in Germany (CrUX top 1k sample)',
};

const OUT_DIR = path.join(PATHS.results, 'report');
const rel = (p) => path.relative(ROOT, p);

function main() {
  const crawlFiles = fs.existsSync(PATHS.results)
    ? fs
        .readdirSync(PATHS.results)
        .filter((f) => /^prevalence_.+\.jsonl$/.test(f))
        // known lists first, in the order of LIST_NAMES; others alphabetically after them
        .sort((a, b) => {
          const order = Object.keys(LIST_NAMES);
          const ia = order.indexOf(a.replace(/\.jsonl$/, '')), ib = order.indexOf(b.replace(/\.jsonl$/, ''));
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
        })
    : [];
  const sites = crawlFiles.flatMap((f) => {
    const key = f.replace(/\.jsonl$/, '');
    return report.siteRows(readRecords(path.join(PATHS.results, f)), LIST_NAMES[key] || key.replace(/^prevalence_/, ''));
  });

  const measurements = readRecords(PATHS.measurements);
  const overnightFile = path.join(PATHS.results, 'overnight_log.jsonl');
  const overnight = readRecords(overnightFile);
  const runs = report.agentRuns(measurements, overnight);

  const data = {
    generated: new Date().toISOString(),
    sources: [...crawlFiles.map((f) => `results/${f}`), rel(PATHS.measurements), rel(overnightFile)],
    lists: report.listSummary(sites),
    setups: report.setupShares(sites),
    vendors: report.nonPrebidVendors(sites, AD_VENDORS),
    sites,
    runs,
    decisions: report.decisionsByVariant(runs),
    bids: report.bidsByCondition(measurements),
  };

  if (!sites.length && !runs.length) {
    console.error('No results found yet: run a crawl (npm run prevalence) or agent runs first.');
    process.exit(1);
  }

  fs.mkdirSync(path.join(OUT_DIR, 'data'), { recursive: true });
  for (const [name, rows] of Object.entries({ sites, agent_runs: runs, bids: data.bids, vendor_roles: AD_VENDORS.map(({ name: vendor, role }) => ({ vendor, role })) })) {
    fs.writeFileSync(path.join(OUT_DIR, 'data', `${name}.json`), `${JSON.stringify(rows, null, 1)}\n`);
  }

  const template = fs.readFileSync(path.join(ROOT, 'src', 'report-template.html'), 'utf8');
  // Escape "</" so data can never close the <script> tag.
  const page = template.replace('/*__REPORT_DATA__*/null', JSON.stringify(data).replace(/<\//g, '<\\/'));
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), page);

  console.log(`Report written to ${rel(path.join(OUT_DIR, 'index.html'))}`);
  console.log(`  sites: ${sites.length} from ${crawlFiles.length} crawl(s) | agent runs: ${runs.length} | measurements: ${measurements.length}`);
  console.log(`  open it: open ${rel(path.join(OUT_DIR, 'index.html'))}`);
}

main();
