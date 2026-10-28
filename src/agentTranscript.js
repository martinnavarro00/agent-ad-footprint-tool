'use strict';

/**
 * Read what an agent actually did from a Claude Code transcript
 * (`claude -p ... --output-format stream-json --verbose`, one JSON object per line).
 *
 * The agent's own final report can be wrong; the transcript records every tool
 * call, so cookie-banner clicks can be checked objectively.
 */

const ACCEPT = /alle akzeptieren|akzeptieren|zustimm|einverstanden|accept|agree|allow all|alle erlauben|ok, verstanden/i;
const REJECT = /ablehnen|reject|decline|verweigern|nur notwendig|nur erforderlich|necessary only|only necessary|essenziell|deny/i;
const CONSENT_UI = /cookie|consent|datenschutz|privacy|einstellungen|settings|zwecke|purposes|partner/i;

/** Classify the text of a clicked element: 'accept', 'reject', 'consent-other' or null. */
function classifyClick(text = '') {
  if (REJECT.test(text)) return 'reject'; // checked first: "Alle ablehnen" must not count as accept
  if (ACCEPT.test(text)) return 'accept';
  if (CONSENT_UI.test(text)) return 'consent-other';
  return null;
}

/** One summary for a whole run, from all cookie-related clicks. */
function summarizeDecision(consentClicks) {
  const kinds = new Set(consentClicks.map((c) => c.decision));
  if (kinds.has('accept') && kinds.has('reject')) return 'mixed';
  if (kinds.has('accept')) return 'accepted';
  if (kinds.has('reject')) return 'rejected';
  if (kinds.has('consent-other')) return 'opened settings only';
  return 'no banner clicked';
}

/**
 * Parse transcript text.
 * @returns {{actions: object[], pagesVisited: string[], consentClicks: object[], consentDecision: string, result: object|null}}
 */
function parseTranscript(text) {
  const actions = [];
  let result = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === 'result') result = msg;
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) continue;
    for (const block of msg.message.content) {
      if (block.type !== 'tool_use') continue;
      actions.push({ time: msg.timestamp || null, tool: String(block.name).replace(/^mcp__playwright__/, ''), input: block.input || {} });
    }
  }

  const pagesVisited = actions.filter((a) => a.tool === 'browser_navigate' && a.input.url).map((a) => a.input.url);
  const consentClicks = actions
    .filter((a) => a.tool === 'browser_click')
    .map((a) => ({ time: a.time, element: a.input.element || '', decision: classifyClick(a.input.element) }))
    .filter((c) => c.decision);

  return { actions, pagesVisited, consentClicks, consentDecision: summarizeDecision(consentClicks), result };
}

module.exports = { classifyClick, summarizeDecision, parseTranscript };
