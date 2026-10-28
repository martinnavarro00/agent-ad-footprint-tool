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

### 2b. Unattended agent runs (e.g. overnight)

`npm run overnight` repeats step 2 automatically: per round it runs every variant (A, B, C), each
with a fresh profile, Claude Code in non-interactive mode (`claude -p`, only the Playwright browser
tools allowed; web search and shell are refused), copies the profile and measures it on each site,
then takes one baseline visit per site in the same time window. Run numbers continue automatically.

```bash
npm run overnight -- --dry-run                 # show the plan, run nothing
caffeinate -dimsu npm run overnight -- --rounds 4
```

Defaults: 4 rounds, variants A,B,C, and the sites in `DEFAULT_SITES` at the top of
`scripts/overnight.js`. Only use sites where the prevalence crawl found Prebid **and** clicked the
cookie banner, otherwise the measurement records no bids. Change with `--rounds`, `--variants`, `--sites url1,url2,url3`, `--agent-timeout <min>`.
One round takes about 45 minutes. `caffeinate` keeps the Mac awake: leave it plugged in with the lid
open. Progress goes to `results/overnight_log.jsonl`, including each run's **cookie decision**
(accepted / rejected / mixed / no banner clicked), taken from the agent's actual clicks, not its own
report. Per run, `agent_output/<label>/` holds `transcript.jsonl` (every message and tool call),
`actions.json` (pages visited, cookie-banner clicks) and `claude_result.json` (final answer, cost). Agent runs use your Claude plan; if a usage limit is
reached, the remaining runs fail and are logged, and the script carries on with the baselines.
Fill in the run log in `docs/protocol.md` afterwards from these files.

### 3. Compare

```bash
npm run summarize -- --shops sportscheck.com,intersport.de,idealo.de,amazon.de,zalando.de --save
```

`--save` also writes the output to `results/summary_<date>_<time>.txt` (leave it out to only print). This prints one row per visit, the averages per condition, and the advertisers that bid **only** on
agent profiles (candidate retargeting). Shops the agent visited are flagged.

### 4. How many commonly used sites use Prebid, and what do the others use? (ad-tech crawl)

Our measurement reads Prebid.js auctions, so it matters how common Prebid is and what sites use
instead. This crawler visits the homepage of every site in a list and records, per site:

- **Prebid** (found before or only after accepting the cookie banner, and which bidders)
- **other ad tech the page loads**: Google Ad Manager, Google AdSense, Amazon TAM, native widgets
  (Taboola, Outbrain, Plista), ad exchanges (Criteo, PubMatic, Xandr…), and ad-tracking pixels
  (Meta, Google Ads, TikTok, Microsoft)
- **ads.txt**: whether the site publishes a list of authorised ad sellers (= it sells ads)
- **one label for how the site shows ads**, e.g. "Prebid", "Google Ad Manager only", "Native widgets
  only", "No third-party ad tech detected"

No agent involved. Use the **CrUX list** (sites real Chrome users visit, also available for Germany);
see `data/lists/README.md` for where to get it.

```bash
npm run prevalence -- --list data/lists/crux_de.csv --top 1000 --exclude-adult   # top 1000 sites in Germany
npm run prevalence -- --list data/lists/crux_global.csv --top 1000 --exclude-adult
npm run prevalence:summary                                        # print the summary again
```

About 1,000 sites take roughly 1 hour with the default 4 sites in parallel (`--concurrency`). Results
go to `results/prevalence.jsonl`, one line per site, written immediately: you can stop with Ctrl+C
and re-run the same command to continue. Use a different `--out` file per list. The summary shows how
sites show ads, the share of sites with ad tech / ads.txt / Prebid, the most common vendors, results
by popularity rank, and the most common Prebid bidders. Add `--headed` to watch.

`--exclude-adult` skips adult and malware sites before visiting them: it asks Cloudflare for Families
(the 1.1.1.3 family-safe DNS) whether a domain is blocked, plus a keyword check on the domain name.
Skipped sites are neither visited nor saved in the results; the crawl prints how many were skipped.

Limitations: homepages only (some sites run ads only on article pages: pass a list of article URLs
for those); first-party ad systems (e.g. Amazon's or eBay's own sponsored products) are not detected;
headless Chrome can be blocked by some sites; results depend on the country you crawl from (consent
rules), so note where you ran it. The vendor list is in `src/detectAdTech.js` and can be extended.

### 5. Results report (charts and tables for the group)

```bash
npm run report
open results/report/index.html
```

Builds a self-contained page from everything in `results/`: Prebid prevalence per crawl list, how sites
without Prebid show ads, a searchable table of all crawled sites, the agents' cookie decisions, bids per
news site and condition, and the agent runs with their retargeting check. Re-run it after every crawl or
overnight run and commit `results/report/` so the group always sees the latest numbers. The same tables
are written to `results/report/data/*.json`, which is what the online dashboard reads. The page design
lives in `src/report-template.html`, the calculations in `src/report.js` (unit-tested).

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
| `npm run overnight -- [--rounds N] [--dry-run]` | unattended agent runs + measurements + baselines |
| `npm run measure -- --help` | all measurement options: `--consent accept\|reject\|skip`, `--headless`, `--url`, `--note`, `--channel` |
| `npm run agent:setup -- <label>` | prepares one agent run |
| `npm run profile:copy -- <profile> [--force]` | copies an agent profile for measuring |
| `npm run summarize [-- --file <jsonl>] [--save]` | compares conditions; `--save` writes a text file to `results/` |
| `npm run prevalence -- --list <file>` | crawls a list of sites for Prebid and other ad tech (`--top`, `--tld`, `--exclude-adult`, `--concurrency`, `--headed`, `--out`) |
| `npm run prevalence:summary` | summary of the crawl results |
| `npm run report` | rebuilds the results report in `results/report/` |
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
  agentTranscript.js  reads an agent transcript: pages visited, cookie clicks, decision (unit-tested)
  report.js        aggregations for the results report (unit-tested)
  report-template.html  design of the results report page
  measure.js       one measurement visit; reading and writing result files
  detectAdTech.js  detects Prebid and other ad-tech vendors; labels how a site shows ads
scripts/
  measure.js       CLI: baseline / agent measurement
  agent-setup.js   CLI: prepare profile + MCP config for an agent run
  copy-profile.js  CLI: safe copy of an agent profile (refuses while Chrome is open)
  summarize.js     CLI: compare conditions
  overnight.js     CLI: unattended agent runs (setup, claude -p, copy, measure, baselines)
  report.js        CLI: builds the results report (results/report/)
  prevalence.js    CLI: crawl a list of websites for Prebid and other ad tech
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
