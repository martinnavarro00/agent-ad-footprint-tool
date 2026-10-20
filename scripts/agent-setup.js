#!/usr/bin/env node
'use strict';

/**
 * Prepare one agent run: create an empty browser profile and an output
 * folder, and write the Playwright MCP config that points the agent at them.
 *
 *   npm run agent:setup -- agent_A_run3
 *
 * Writes .roo/mcp.json (Roo Code) and .mcp.json (Claude Code), and prints the
 * same block for other MCP clients (Claude Desktop, Cursor, ...). Paths are absolute and machine-
 * specific, which is why the generated config is not committed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, ROOT } = require('../src/config');

// Tools the agent may use without asking. Deliberately no file upload,
// tab management or PDF tools: the task only needs browsing.
const ALWAYS_ALLOW = [
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
];

function main() {
  const label = process.argv[2];
  if (!label || !/^agent_[A-Za-z]+_run\d+$/.test(label)) {
    console.error('Usage: npm run agent:setup -- agent_<variant>_run<N>   (e.g. agent_A_run3)');
    process.exit(1);
  }

  const profileDir = path.join(PATHS.profiles, label);
  const outputDir = path.join(PATHS.agentOutput, label);
  if (fs.existsSync(profileDir) && fs.readdirSync(profileDir).length > 0) {
    console.error(`Profile ${path.relative(ROOT, profileDir)} already exists and is not empty.`);
    console.error('Every run needs a fresh profile; pick the next run number.');
    process.exit(1);
  }
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const mcpBin = path.join(ROOT, 'node_modules', '.bin', 'playwright-mcp');
  if (!fs.existsSync(mcpBin)) {
    console.error('playwright-mcp not found. Run `npm install` first.');
    process.exit(1);
  }

  const server = {
    command: mcpBin,
    args: ['--user-data-dir', profileDir, '--output-dir', outputDir],
  };

  const writeJson = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  };

  // Roo Code (VS Code): .roo/mcp.json, with tools pre-approved.
  writeJson(path.join(ROOT, '.roo', 'mcp.json'), { mcpServers: { playwright: { ...server, alwaysAllow: ALWAYS_ALLOW } } });
  // Claude Code: project-level .mcp.json in the repo root.
  writeJson(path.join(ROOT, '.mcp.json'), { mcpServers: { playwright: { type: 'stdio', ...server } } });

  // Claude Code: enable the server and pre-approve the same tools as Roo, so
  // the researcher never has to click "allow" during a run (= no intervention).
  // Merged into any existing local settings instead of overwriting them.
  const claudeSettingsFile = path.join(ROOT, '.claude', 'settings.local.json');
  const settings = fs.existsSync(claudeSettingsFile) ? JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8')) : {};
  const allow = new Set(settings.permissions?.allow || []);
  for (const tool of ALWAYS_ALLOW) allow.add(`mcp__playwright__${tool}`);
  writeJson(claudeSettingsFile, {
    ...settings,
    enabledMcpjsonServers: [...new Set([...(settings.enabledMcpjsonServers || []), 'playwright'])],
    permissions: { ...settings.permissions, allow: [...allow] },
  });

  console.log(`Prepared ${label}
  profile: ${path.relative(ROOT, profileDir)}
  output:  ${path.relative(ROOT, outputDir)}

  Roo Code:    .roo/mcp.json written  -> reload the MCP servers in Roo
  Claude Code: .mcp.json + .claude/settings.local.json written -> start \`claude\` in this folder,
               check with /mcp that "playwright" is connected
  Claude Desktop / Cursor / other: paste this block into the client's MCP config and restart it
  (Claude Desktop on macOS: ~/Library/Application Support/Claude/claude_desktop_config.json)

${JSON.stringify({ mcpServers: { playwright: server } }, null, 2)}

Next: run the prompt from docs/protocol.md, close the agent's browser, then
  npm run profile:copy -- ${path.relative(ROOT, profileDir)}`);
}

main();
