# Pilot, 2026-10-19

First end-to-end test of the idea. **Exploratory only, not for the final analysis.**

Files
- `measurements.jsonl`: pilot results converted to the current format (de-duplicated bids).
  View with `npm run summarize:pilot`.
- `level1_results_original.json`, `level2_measure_results_original.json`: untouched outputs of
  the old scripts.

## What was done
- **Baseline (5 visits):** fresh profile, tagesspiegel.de, accept cookies, scroll, record bids.
  Ran on Playwright's bundled Chromium with a fake Chrome 124 user agent (old Level 1 script).
- **Agent (3 runs):** gemini-2.0-flash via Roo Code + Playwright MCP shopped for running shoes
  (variant A ×2, variant B ×1), then the profile copy was measured on tagesspiegel.de with real Chrome.

## What it showed
- Bids are consent-gated: 0 bids before the cookie click on every fresh visit.
- The agent accepted cookie banners **on its own** in variant A.
- Agent profiles had 330 to 427 cookies after one short shopping task.
- **sportscheck.com bid on the agent_B_run1 profile** and never on a baseline profile, a shop the
  agent had visited. That is the first sign of retargeting agent traffic.
- Agent profiles got more unique bids on average (21 vs 11), but the **median CPM was the same**
  (≈ €1.30). The higher mean CPM of the agent-A runs comes from a few high Lidl bids.

## Why it can't be used as a result
- The baseline and agent visits used different browser builds (bundled Chromium with a spoofed UA vs.
  real Chrome). Fixed: both now use `scripts/measure.js`.
- The old scripts counted the same bid up to 3 times. Fixed with de-duplication by `adId`
  (the converted file is already de-duplicated by descriptive fields).
- Baseline at ~19:55, agent measurements at 20:18 to 20:55: different time windows.
- n = 5 vs n = 3; one publisher; agent visits had no "before consent" phase.
