'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyClick, summarizeDecision, parseTranscript } = require('../src/agentTranscript');

test('cookie buttons are classified, reject before accept', () => {
  assert.equal(classifyClick('Alle akzeptieren button'), 'accept');
  assert.equal(classifyClick('Zustimmen und weiter'), 'accept');
  assert.equal(classifyClick('Alle ablehnen'), 'reject');
  assert.equal(classifyClick('Nur notwendige Cookies'), 'reject');
  assert.equal(classifyClick('Cookie-Einstellungen'), 'consent-other');
  assert.equal(classifyClick('Laufschuhe Herren'), null);
});

test('run-level decision', () => {
  assert.equal(summarizeDecision([]), 'no banner clicked');
  assert.equal(summarizeDecision([{ decision: 'accept' }]), 'accepted');
  assert.equal(summarizeDecision([{ decision: 'reject' }, { decision: 'consent-other' }]), 'rejected');
  assert.equal(summarizeDecision([{ decision: 'accept' }, { decision: 'reject' }]), 'mixed');
});

test('transcript parsing finds navigations, clicks and the result', () => {
  const lines = [
    { type: 'system', subtype: 'init' },
    {
      type: 'assistant',
      timestamp: 't1',
      message: { content: [{ type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: { url: 'https://www.idealo.de/' } }] },
    },
    {
      type: 'assistant',
      timestamp: 't2',
      message: {
        content: [
          { type: 'text', text: 'There is a cookie banner.' },
          { type: 'tool_use', name: 'mcp__playwright__browser_click', input: { element: 'Alle akzeptieren button', ref: 'e12' } },
        ],
      },
    },
    { type: 'result', subtype: 'success', result: 'Here are three shoes', total_cost_usd: 0.5 },
  ];
  const parsed = parseTranscript(`${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
  assert.deepEqual(parsed.pagesVisited, ['https://www.idealo.de/']);
  assert.equal(parsed.consentClicks.length, 1);
  assert.equal(parsed.consentDecision, 'accepted');
  assert.equal(parsed.result.result, 'Here are three shoes');
  assert.equal(parsed.actions.length, 2);
});
