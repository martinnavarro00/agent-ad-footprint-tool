'use strict';

/**
 * Shared measurement settings.
 *
 * Every measurement (baseline AND agent profile) uses these exact values, so
 * that differences in bids can be attributed to the browser profile and not
 * to a different browsing procedure. Change them only between studies, never
 * between runs of the same study, and note the change in docs/protocol.md.
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  ROOT,

  /** Publisher page on which ad auctions are observed. */
  DEFAULT_URL: 'https://www.tagesspiegel.de/',

  /** Browser fingerprint kept identical across conditions. */
  BROWSER: {
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  },

  /** Timing of one measurement visit (milliseconds / pixels). */
  TIMING: {
    beforeConsentMs: 6000, // observe auctions while the cookie banner is open
    afterConsentMs: 3000, // settle time right after the consent click
    scrollSteps: 6,
    scrollDistancePx: 700,
    scrollPauseMs: 2000,
    finalWaitMs: 4000, // catch late / lazy-loaded auctions
    pollIntervalMs: 1000,
    consentButtonTimeoutMs: 1500,
  },

  /** Cookie-banner button labels (German publishers first). */
  CONSENT_BUTTONS: {
    accept: /alle akzeptieren|akzeptieren|zustimmen|einverstanden|accept all|agree/i,
    reject: /alle ablehnen|ablehnen|nur notwendige|reject all|reject/i,
  },

  PATHS: {
    profiles: path.join(ROOT, 'profiles'),
    agentOutput: path.join(ROOT, 'agent_output'),
    results: path.join(ROOT, 'results'),
    measurements: path.join(ROOT, 'results', 'measurements.jsonl'),
    screenshots: path.join(ROOT, 'results', 'screenshots'),
  },

  /** Bump when the record format written by scripts/measure.js changes. */
  SCHEMA_VERSION: 1,
};
