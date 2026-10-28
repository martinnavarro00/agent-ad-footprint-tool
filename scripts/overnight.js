#!/usr/bin/env node
'use strict';

/**
 * Run the whole agent experiment unattended (e.g. overnight).
 *
 * Each round, for every variant (A, B, C by default):
 *   1. agent:setup         fresh profile + MCP config
 *   2. claude -p <prompt>  Claude Code browses alone (only Playwright browser tools allowed)
 *   3. profile:copy        and measure the copy on every site (fresh copy per site)
 * then one baseline visit per site, in the same time window.
 *
 *   caffeinate -dimsu npm run overnight -- --rounds 4
 *   npm run overnight -- --dry-run        # print the plan only
 *
 * Prompts are read from docs/protocol.md (the "### Variant X" blocks), so the
 * protocol stays the single source of truth. Progress is appended to
 * results/overnight_log.jsonl. Per run, agent_output/<label>/ gets:
 *   transcript.jsonl    every message and tool call of the agent (raw, from Claude Code)
 *   actions.json        pages visited, cookie-banner clicks, cookie decision (parsed)
 *   claude_result.json  Claude's final answer and cost
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { PATHS, ROOT } = require('../src/config');
const { parseTranscript } = require('../src/agentTranscript');

const DEFAULT_SITES = ['https://www.bild.de/', 'https://www.spiegel.de/', 'https://www.transfermarkt.de/'];
const LOG_FILE = path.join(PATHS.results, 'overnight_log.jsonl');

// Same tools that agent:setup pre-approves; everything else is refused (no web search shortcuts, no shell).
const ALLOWED_TOOLS = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_take_screenshot',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_fill_form',
  'browser_wait_for',
  'browser_console_messages',
].map((t) => `mcp__playwright__${t}`);
const DISALLOWED_TOOLS = ['WebSearch', 'WebFetch', 'Bash'];

function parseCli() {
  const { values } = parseArgs({
    options: {
      rounds: { type: 'string', default: '4' },
      variants: { type: 'string', default: 'A,B,C' },
      sites: { type: 'string', default: DEFAULT_SITES.join(',') },
      'agent-timeout': { type: 'string', default: '25' },
      model: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(`Usage: npm run overnight -- [--rounds 4] [--variants A,B,C] [--sites url1,url2,url3]
       [--agent-timeout 25] (minutes per agent run) [--model <name>] [--dry-run]`);
    process.exit(0);
  }
  return {
    rounds: Number(values.rounds),
    variants: values.variants.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean),
    sites: values.sites.split(',').map((s) => s.trim()).filter(Boolean),
    agentTimeoutMs: Number(values['agent-timeout']) * 60 * 1000,
    model: values.model,
    dryRun: values['dry-run'],
  };
}

/** Read the prompt text for each variant from docs/protocol.md. */
function readPrompts() {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'protocol.md'), 'utf8');
  const prompts = {};
  const re = /### Variant ([A-Z])[^\n]*\n```text\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(text))) prompts[m[1]] = m[2].trim();
  return prompts;
}

/** Next free run number for a variant, based on existing profile folders. */
function nextRunNumber(variant) {
  if (!fs.existsSync(PATHS.profiles)) return 1;
  const nums = fs
    .readdirSync(PATHS.profiles)
    .map((name) => name.match(new RegExp(`^agent_${variant}_run(\\d+)$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(entry) {
  fs.mkdirSync(PATHS.results, { recursive: true });
  fs.appendFileSync(LOG_FILE, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
}

/** Run a command, stream its output, and report success. In dry-run mode only print it. */
function run(cmd, args, { dryRun, timeout, stdoutFile } = {}) {
  const shown = [cmd, ...args.map((a) => (a.length > 60 ? `"${a.slice(0, 57)}..."` : a))].join(' ');
  console.log(`  $ ${shown}`);
  if (dryRun) return { ok: true, stdout: '' };
  // stdout can be large (full agent transcript), so it goes straight into a file when requested.
  const fd = stdoutFile ? fs.openSync(stdoutFile, 'w') : null;
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    timeout,
    stdio: fd === null ? 'inherit' : ['ignore', fd, 'inherit'],
  });
  if (fd !== null) fs.closeSync(fd);
  const ok = res.status === 0;
  if (!ok) console.log(`  ! failed (exit ${res.status}${res.error ? `, ${res.error.code}` : ''})`);
  return { ok, status: res.status, error: res.error?.code };
}

/** Wait until Chrome has released the profile (no Singleton lock files). */
async function waitForProfileUnlocked(dir, maxMs = 90000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const locked = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].some((f) => {
      try {
        fs.lstatSync(path.join(dir, f));
        return true;
      } catch {
        return false;
      }
    });
    if (!locked) return true;
    await sleep(3000);
  }
  return false;
}

async function agentRun(variant, prompt, opts) {
  const label = `agent_${variant}_run${opts.dryRun ? 'N' : nextRunNumber(variant)}`;
  const profile = path.join('profiles', label);
  const started = Date.now();
  console.log(`\n=== ${label} (${new Date().toLocaleTimeString()}) ===`);

  if (!run('node', ['scripts/agent-setup.js', label], opts).ok) {
    log({ label, step: 'setup', ok: false });
    return;
  }

  const claudeArgs = [
    '-p',
    prompt,
    '--mcp-config',
    '.mcp.json',
    '--strict-mcp-config',
    '--allowedTools',
    ...ALLOWED_TOOLS,
    '--disallowedTools',
    ...DISALLOWED_TOOLS,
    '--permission-mode',
    'dontAsk',
    '--output-format',
    'stream-json',
    '--verbose',
    ...(opts.model ? ['--model', opts.model] : []),
  ];
  const outDir = path.join(PATHS.agentOutput, label);
  const transcriptFile = path.join(outDir, 'transcript.jsonl');
  if (!opts.dryRun) fs.mkdirSync(outDir, { recursive: true });
  const agent = run('claude', claudeArgs, { ...opts, timeout: opts.agentTimeoutMs, stdoutFile: opts.dryRun ? null : transcriptFile });

  let parsed = { actions: [], pagesVisited: [], consentClicks: [], consentDecision: 'unknown', result: null };
  if (!opts.dryRun && fs.existsSync(transcriptFile)) {
    parsed = parseTranscript(fs.readFileSync(transcriptFile, 'utf8'));
    const { result: _result, ...actionsSummary } = parsed;
    fs.writeFileSync(path.join(outDir, 'actions.json'), `${JSON.stringify(actionsSummary, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'claude_result.json'), `${JSON.stringify(parsed.result, null, 2)}\n`);
  }
  const result = parsed.result;
  console.log(`  cookie decision: ${parsed.consentDecision} | pages: ${parsed.pagesVisited.length} | clicks on consent UI: ${parsed.consentClicks.length}`);
  log({
    label,
    variant,
    step: 'agent',
    ok: agent.ok,
    exit: agent.status,
    error: agent.error,
    minutes: Number(((Date.now() - started) / 60000).toFixed(1)),
    turns: result?.num_turns,
    costUsd: result?.total_cost_usd,
    consentDecision: parsed.consentDecision,
    consentClicks: parsed.consentClicks.map((c) => `${c.decision}: ${c.element}`),
    pagesVisited: parsed.pagesVisited,
    answer: typeof result?.result === 'string' ? result.result.slice(0, 2000) : undefined,
  });
  if (!agent.ok) return; // nothing to measure

  if (!opts.dryRun && !(await waitForProfileUnlocked(path.join(ROOT, profile)))) {
    log({ label, step: 'copy', ok: false, error: 'profile still locked after 90 s' });
    return;
  }
  opts.sites.forEach((site, i) => {
    run('node', ['scripts/copy-profile.js', profile, ...(i > 0 ? ['--force'] : [])], opts);
    const m = run(
      'node',
      ['scripts/measure.js', '--condition', 'agent', '--label', label, '--profile', `${profile}_copy`, '--url', site, '--note', `overnight variant ${variant}`],
      opts,
    );
    log({ label, step: 'measure', site, ok: m.ok });
  });
}

function baselineRound(opts) {
  console.log(`\n=== baseline (${new Date().toLocaleTimeString()}) ===`);
  for (const site of opts.sites) {
    const m = run('node', ['scripts/measure.js', '--condition', 'baseline', '--label', 'baseline', '--url', site, '--note', 'overnight'], opts);
    log({ label: 'baseline', step: 'measure', site, ok: m.ok });
  }
}

async function main() {
  const opts = parseCli();
  const prompts = readPrompts();
  const missing = opts.variants.filter((v) => !prompts[v]);
  if (missing.length) {
    console.error(`No prompt found in docs/protocol.md for variant(s): ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!opts.dryRun && spawnSync('claude', ['--version'], { encoding: 'utf8' }).status !== 0) {
    console.error('Claude Code (`claude`) not found. Install it first (see README).');
    process.exit(1);
  }

  console.log(`Overnight plan: ${opts.rounds} rounds x variants ${opts.variants.join(', ')}, sites: ${opts.sites.join(', ')}`);
  log({ step: 'start', rounds: opts.rounds, variants: opts.variants, sites: opts.sites, dryRun: opts.dryRun });

  for (let round = 1; round <= opts.rounds; round += 1) {
    console.log(`\n##### Round ${round}/${opts.rounds} #####`);
    for (const variant of opts.variants) await agentRun(variant, prompts[variant], opts);
    baselineRound(opts);
  }
  log({ step: 'done' });
  console.log(`\nAll rounds finished. Progress log: ${path.relative(ROOT, LOG_FILE)}`);
}

main().catch((err) => {
  log({ step: 'crash', error: err.message });
  console.error(err);
  process.exit(1);
});
