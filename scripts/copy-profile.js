#!/usr/bin/env node
'use strict';

/**
 * Copy an agent's browser profile before measuring it.
 *
 *   npm run profile:copy -- profiles/agent_A_run3      -> profiles/agent_A_run3_copy
 *
 * Why a copy: measuring visits the publisher site, which changes cookies and
 * history. The original stays untouched as the record of what the agent did.
 * Caches are skipped (large and irrelevant for tracking state); cookies,
 * local storage and history are kept.
 */

const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'GraphiteDawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUPersistentCache',
  'ShaderCache',
  'component_crx_cache',
  'extensions_crx_cache',
  'BrowserMetrics-spare.pma',
]);

function main() {
  const src = process.argv[2];
  const force = process.argv.includes('--force');
  if (!src || !fs.existsSync(src)) {
    console.error('Usage: npm run profile:copy -- <profileDir> [--force]');
    process.exit(1);
  }

  // Chrome holds these while the profile is open; copying then gives a
  // half-written profile (that is how "Default 2" folders appeared in the pilot).
  const lock = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].find((f) => {
    try {
      fs.lstatSync(path.join(src, f));
      return true;
    } catch {
      return false;
    }
  });
  if (lock) {
    console.error(`The profile is still open in a browser (${lock} found). Close the agent's browser first.`);
    process.exit(1);
  }

  const dest = `${src.replace(/[\\/]+$/, '')}_copy`;
  if (fs.existsSync(dest)) {
    if (!force) {
      console.error(`${dest} already exists. Use --force to replace it.`);
      process.exit(1);
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => !SKIP.has(path.basename(p)) && !path.basename(p).startsWith('Singleton'),
  });
  console.log(`Copied ${src} -> ${dest}\nNext: npm run measure -- --condition agent --label ${path.basename(src)} --profile ${dest}`);
}

main();
