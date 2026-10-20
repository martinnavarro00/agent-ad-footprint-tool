#!/usr/bin/env node
'use strict';

/**
 * Measure ad-auction bids on the publisher page with a given browser profile.
 *
 *   Baseline (fresh, empty profile per run):
 *     npm run measure -- --condition baseline --label baseline --runs 5
 *
 *   Agent profile (a COPY made with `npm run profile:copy`):
 *     npm run measure -- --condition agent --label agent_A_run3 --profile profiles/agent_A_run3_copy
 *
 * Every visit appends one line to results/measurements.jsonl.
 * Run `npm run measure -- --help` for all options.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');

const { DEFAULT_URL, PATHS, ROOT } = require('../src/config');
const { measureVisit, appendRecord } = require('../src/measure');

const HELP = `
Usage: npm run measure -- --condition <baseline|agent> --label <name> [options]

Required
  --condition   baseline | agent         which study condition this is
  --label       name of the run, e.g. baseline or agent_A_run3

Options
  --profile     profile directory (required for agent; omit for baseline =
                fresh empty profile for every run)
  --runs        number of visits (baseline only, default 1)
  --consent     accept | reject | skip   cookie decision on the page (default accept)
  --url         page to measure (default ${DEFAULT_URL})
  --channel     chrome | chromium        must match what the agent used (default chrome)
  --headless    run without a visible window
  --out         output file (default results/measurements.jsonl)
  --note        free text stored with the record (e.g. network, anomalies)
`;

function parseCli() {
  const { values } = parseArgs({
    options: {
      condition: { type: 'string' },
      label: { type: 'string' },
      profile: { type: 'string' },
      runs: { type: 'string', default: '1' },
      consent: { type: 'string', default: 'accept' },
      url: { type: 'string', default: DEFAULT_URL },
      channel: { type: 'string', default: 'chrome' },
      headless: { type: 'boolean', default: false },
      out: { type: 'string', default: PATHS.measurements },
      note: { type: 'string', default: '' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const errors = [];
  if (!['baseline', 'agent'].includes(values.condition)) errors.push('--condition must be "baseline" or "agent"');
  if (!values.label) errors.push('--label is required');
  if (!['accept', 'reject', 'skip'].includes(values.consent)) errors.push('--consent must be accept, reject or skip');
  if (!['chrome', 'chromium'].includes(values.channel)) errors.push('--channel must be chrome or chromium');

  const runs = Number.parseInt(values.runs, 10);
  if (!Number.isInteger(runs) || runs < 1) errors.push('--runs must be a positive integer');

  if (values.condition === 'agent') {
    if (!values.profile) errors.push('--profile is required for the agent condition');
    else if (!fs.existsSync(values.profile)) errors.push(`profile not found: ${values.profile}`);
    // Each visit changes the profile, so a second visit would not measure the agent's footprint.
    if (runs > 1) errors.push('agent profiles are measured once; make a new copy for another measurement');
    if (values.profile && !/_copy\b/.test(values.profile)) {
      console.warn('Warning: measuring a profile that is not a "_copy". The visit will change it.');
    }
  }

  if (errors.length) {
    console.error(`${errors.map((e) => `Error: ${e}`).join('\n')}\n${HELP}`);
    process.exit(1);
  }
  return { ...values, runs };
}

async function main() {
  const opts = parseCli();

  for (let run = 1; run <= opts.runs; run += 1) {
    // Baseline: a brand-new empty profile per run, deleted afterwards.
    const freshDir = opts.profile ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-profile-'));
    const profileDir = opts.profile ? path.resolve(opts.profile) : freshDir;

    // Timestamp in the file name so repeated batches with the same label never overwrite each other.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const screenshotPrefix = `${opts.label}_run${run}_${stamp}`;

    console.log(`[${opts.label}] run ${run}/${opts.runs} — ${opts.condition}, consent=${opts.consent}`);
    try {
      const record = await measureVisit({
        profileDir,
        url: opts.url,
        consent: opts.consent,
        channel: opts.channel,
        headless: opts.headless,
        screenshotPrefix,
      });

      const full = {
        condition: opts.condition,
        label: opts.label,
        run,
        profile: opts.profile ? path.relative(ROOT, profileDir) : 'fresh',
        note: opts.note,
        screenshots: [`${screenshotPrefix}_1_before.png`, `${screenshotPrefix}_2_after.png`],
        ...record,
      };
      appendRecord(opts.out, full);

      const { before, after } = full;
      console.log(
        `  consent: ${full.consent.clicked ? `clicked "${full.consent.label}"` : 'no button clicked'} | ` +
          `cookies at start: ${full.cookiesAtStart}\n` +
          `  before: ${before.bids} bids | after: ${after.bids} bids, ` +
          `median CPM ${after.medianCpm ?? '-'} | advertisers: ${after.advertisers.join(', ') || '-'}`,
      );
    } finally {
      if (freshDir) fs.rmSync(freshDir, { recursive: true, force: true });
    }

    if (run < opts.runs) await new Promise((r) => setTimeout(r, 5000)); // be polite to the publisher
  }
  console.log(`Saved to ${path.relative(process.cwd(), opts.out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
