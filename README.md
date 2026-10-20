# Agent Ad Footprint


This code lets an AI agent browse the web in a real browser, then measures what the online
advertising market does with that browser afterwards. We look at the ad auctions on a news site
(header bidding with Prebid.js). Advertisers
bid in real time to show an ad to "this visitor". If the agent's browsing changes **who bids** (for
example, a shop the agent visited starts retargeting it) or **how much they bid**, then the agent's
activity has become part of a tracking profile.

```
 1. Agent run                  2. Copy profile            3. Measure                 4. Compare
 AI agent shops for running    keep the original as the   open tagesspiegel.de with   agent vs. fresh baseline:
 shoes in a real browser   ->  record of what the agent   the profile, accept     ->  who bids, how many,
 (Playwright MCP)              did                        cookies, record all bids    at what price
```

The **baseline** is the same measurement with a brand-new, empty browser profile. Baseline and
agent profiles go through exactly the same code (`src/measure.js`) and the same settings
(`src/config.js`), so any difference comes from the profile.

## How to run

### 0. One-time setup

You need [Node.js](https://nodejs.org) 20 or newer, Google Chrome, and an AI client that can use MCP
servers. We use **Claude Code** (needs a paid Claude plan); Roo Code in VS Code, Claude Desktop or
Cursor also work.

```bash
# Claude Code (skip if `claude --version` already works). Open a new terminal afterwards.
curl -fsSL https://claude.ai/install.sh | bash

# Project
git clone <repo-url> && cd <repo-folder>
npm install
npm test                 # should print: pass 8, fail 0
npm run summarize:pilot  # optional: look at the pilot data from 2026-10-19
```

Run every command below from the project folder.

### 1. Baseline: measurement without an agent

Opens Tagesspiegel in a fresh, empty Chrome profile, records the ad bids with the cookie banner
open, clicks "Alle akzeptieren", scrolls, and records the bids again. About 1 minute per visit.

```bash
npm run measure -- --condition baseline --label baseline --runs 3
```

Check the output: `before: 0 bids` and some bids `after` means the measurement works. Take baseline
visits in the same hour as your agent measurements (ad prices change during the day).

### 2. One agent run

Pick a variant and the next free run number, e.g. `agent_A_run1`, `agent_B_run2`.
A = nothing said about cookies, B = told to accept, C = told to reject.
The full prompts are in [`docs/protocol.md`](docs/protocol.md).

```bash
# a) Prepare: empty profile + output folder + MCP config for Claude Code and Roo
npm run agent:setup -- agent_A_run1

# b) Start the agent
claude
#    - type /mcp and check that "playwright" is connected
#    - paste the prompt for your variant from docs/protocol.md
#    - do NOT help it; note anything you would have wanted to step in on

# c) When it's finished: type /exit and close the Chrome window the agent used

# d) Copy the profile, then measure the copy
npm run profile:copy -- profiles/agent_A_run1
npm run measure -- --condition agent --label agent_A_run1 --profile profiles/agent_A_run1_copy
```

Then fill in the run log in `docs/protocol.md` (client, model, time, what the agent did with cookie
banners, interventions).

**Why a copy?** `profiles/agent_A_run1` is the untouched record of what the agent left behind.
Measuring visits Tagesspiegel and adds cookies, so we always measure `_copy`. To measure the same run
again later, make a fresh copy with `npm run profile:copy -- profiles/agent_A_run1 --force`.

### 3. Compare

```bash
npm run summarize -- --shops sportscheck.com,intersport.de,idealo.de,amazon.de,zalando.de --save
```

`--save` also writes the output to `results/summary_<date>_<time>.txt` (leave it out to only print). This prints one row per visit, the averages per condition, and the advertisers that bid **only** on
agent profiles (candidate retargeting). Shops the agent visited are flagged.

### Rules that keep runs comparable

- One `agent:setup` per run, and **restart `claude` after every setup**: each setup points the
  Playwright server to a new profile.
- Measure every agent profile the same way (default `--consent accept`), whatever the variant.
- Use only the Playwright MCP browser, never a built-in browser such as Claude in Chrome: only the
  Playwright server writes to the run's own profile.
- Write the client and model in the run log; the model is part of the study design.

### Using another client instead of Claude Code

`agent:setup` also writes `.roo/mcp.json` for **Roo Code** (reload the MCP servers in Roo) and prints
a config block for **Claude Desktop** (paste it into
`~/Library/Application Support/Claude/claude_desktop_config.json` and restart the app) or Cursor.

### All commands and options

| Command | What it does |
|---|---|
| `npm run measure -- --help` | all measurement options: `--consent accept\|reject\|skip`, `--headless`, `--url`, `--note`, `--channel` |
| `npm run agent:setup -- <label>` | prepares one agent run |
| `npm run profile:copy -- <profile> [--force]` | copies an agent profile for measuring |
| `npm run summarize [-- --file <jsonl>] [--save]` | compares conditions; `--save` writes a text file to `results/` |
| `npm test` | unit tests |

### Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: claude` | install Claude Code (step 0), open a new terminal; if still missing, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` |
| `/mcp` shows no "playwright" | run `npm run agent:setup -- <label>` first, then start `claude` from the project folder |
| Claude asks permission for every click | exit Claude, run `agent:setup` again for the same label (works while the profile is empty), restart |
| `profile is still open in a browser` | close the agent's Chrome window, then copy again |
| `Profile ... already exists and is not empty` | that run was used; take the next run number |
| `Executable doesn't exist` / no Chrome | install Google Chrome, or add `--channel chromium` after `npx playwright install chromium` |
| `before: 0 bids` and `after: 0 bids` | the cookie button wasn't found (check the screenshots in `results/screenshots/`) or the site changed |

## Repository layout

```
src/
  config.js        all measurement settings (URL, timings, browser locale, consent labels)
  prebid.js        code that runs inside the page: hooks Prebid events, reads auction state
  bidStore.js      removes duplicate bids and computes the statistics (unit-tested)
  consent.js       finds and clicks the cookie-banner button (main page + iframes)
  measure.js       one measurement visit; reading and writing result files
scripts/
  measure.js       CLI: baseline / agent measurement
  agent-setup.js   CLI: prepare profile + MCP config for an agent run
  copy-profile.js  CLI: safe copy of an agent profile (refuses while Chrome is open)
  summarize.js     CLI: compare conditions
test/              node:test unit tests
docs/protocol.md   agent prompts, run procedure, run log
data/pilot-2026-10-19/   pilot results (converted) + original files + notes
results/           your measurements (measurements.jsonl is committed, screenshots are not)
```

Not committed (see `.gitignore`): `profiles/` (real cookies and history), `agent_output/`,
screenshots, `.roo/` (absolute paths for one machine).

## Result format

`results/measurements.jsonl` has one JSON object per visit, one per line:

| field | meaning |
|---|---|
| `condition`, `label`, `run` | study condition (`baseline` / `agent`), run name, visit number |
| `profile` | `fresh` or the measured profile copy |
| `cookiesAtStart` | cookies in the profile before the visit (size of the agent's footprint) |
| `consent` | decision, whether a button was clicked, its label |
| `before` / `after` | summary before and after the consent decision: `bids`, `noBids`, `slots`, `bidders`, `advertisers`, `meanCpm`, `medianCpm`, `maxCpm` |
| `bids` | every unique bid: `phase`, `slot`, `bidder`, `advertiser`, `cpm` (EUR per 1000 impressions), `size`, `creativeId`, ... |
| `screenshots` | file names in `results/screenshots/` (before and after the consent click) |
| `browser`, `url`, `timestamp`, `note` | context |

## Method notes and known limitations

- **One bid, one count.** Prebid reports the same bid through several APIs (with differently rounded
  CPMs). `bidStore.js` de-duplicates by Prebid's `adId`. The pilot scripts did not, so their
  averages were too high.
- **Prefer advertisers and medians over mean CPM.** A single high bid (e.g. Lidl at about €5.6) moves the
  mean a lot with this few visits. In the pilot, median CPM was about the same in both conditions (≈ €1.30).
- **Same time window.** Ad demand changes during the day: alternate baseline and agent measurements.
- **Bids are consent-gated.** With a fresh profile there are 0 bids before the cookie click; this is
  the sanity check that the setup works.
- **The agent's own report can be wrong.** Check it against `agent_output/` and the profile.
- Only one publisher and one shopping task so far. Results are for one site and one category.

## Ethics and data handling

No logins, no personal accounts, no CAPTCHA solving. Profiles contain real tracking cookies:
keep them local. Five seconds' pause between visits so we don't load the publisher.

## Team conventions

- Work on a branch, open a pull request, and have one other person review it.
- Don't change `src/config.js` in the middle of a study; if needed, note the change and the date in
  `docs/protocol.md`.
- Every run that counts goes into the run log, including failed ones.
