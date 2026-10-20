'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const { BROWSER, TIMING, PATHS, SCHEMA_VERSION } = require('./config');
const { installPrebidHook, readPrebidState } = require('./prebid');
const { BidStore, summarize } = require('./bidStore');
const { handleConsent } = require('./consent');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollFor(page, store, phase, durationMs) {
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    try {
      store.add(await page.evaluate(readPrebidState), phase);
    } catch (_) {
      /* page is navigating; skip this poll */
    }
    await sleep(TIMING.pollIntervalMs);
  }
}

/**
 * One measurement visit. Identical procedure for baseline and agent profiles:
 *   open URL -> observe with banner open ("before") -> consent decision ->
 *   observe while scrolling ("after") -> record.
 *
 * @param {object} opts
 * @param {string} opts.profileDir  browser profile to use (fresh or agent copy)
 * @param {string} opts.url
 * @param {'accept'|'reject'|'skip'} opts.consent
 * @param {string} opts.channel     'chrome' (installed Google Chrome) or 'chromium'
 * @param {boolean} opts.headless
 * @param {string} opts.screenshotPrefix  file prefix, e.g. "baseline_run1"
 * @returns {Promise<object>} measurement record (without study labels)
 */
async function measureVisit({ profileDir, url, consent, channel, headless, screenshotPrefix }) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: channel === 'chromium' ? undefined : channel,
    headless,
    locale: BROWSER.locale,
    timezoneId: BROWSER.timezoneId,
    viewport: BROWSER.viewport,
    args: BROWSER.args,
  });

  try {
    await context.addInitScript(installPrebidHook);
    const cookiesAtStart = (await context.cookies()).length;
    const page = context.pages()[0] || (await context.newPage());
    const store = new BidStore();

    fs.mkdirSync(PATHS.screenshots, { recursive: true });
    const shot = (name) => page.screenshot({ path: path.join(PATHS.screenshots, `${screenshotPrefix}_${name}.png`) });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Phase 1: banner open. A fresh profile should show ~0 bids here; an
    // agent profile that already consented may show bids immediately.
    await pollFor(page, store, 'before', TIMING.beforeConsentMs);
    await shot('1_before');

    const consentResult = await handleConsent(page, consent);

    // Phase 2: after the decision, scroll deterministically to trigger lazy slots.
    await pollFor(page, store, 'after', TIMING.afterConsentMs);
    for (let i = 0; i < TIMING.scrollSteps; i += 1) {
      await page.mouse.wheel(0, TIMING.scrollDistancePx);
      await pollFor(page, store, 'after', TIMING.scrollPauseMs);
    }
    await pollFor(page, store, 'after', TIMING.finalWaitMs);
    await shot('2_after');

    return {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      url,
      // Persistent contexts expose no browser object, so read the UA instead.
      browser: { channel, headless, userAgent: await page.evaluate(() => navigator.userAgent) },
      cookiesAtStart,
      cookiesAtEnd: (await context.cookies()).length,
      consent: consentResult,
      prebidInstances: store.instances(),
      before: summarize(store.bids('before'), store.noBids('before')),
      after: summarize(store.bids('after'), store.noBids('after')),
      bids: store.bids(),
    };
  } finally {
    await context.close();
  }
}

/** Append one record as a line of JSON (safe to append, easy to analyze). */
function appendRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/** Read a .jsonl file into an array of records. */
function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${file}: line ${i + 1} is not valid JSON (${err.message})`);
      }
    });
}

module.exports = { measureVisit, appendRecord, readRecords };
