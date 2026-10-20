# Agent run protocol

Follow this for every agent run so runs are comparable.

## Before each run
1. `npm run agent:setup -- agent_<variant>_run<N>`: a fresh profile per run, so runs are independent.
2. Reload the MCP servers in your client.
3. Note: date, start time, network (keep it the same), client (Roo Code / Claude Desktop / ...),
   model and provider.
4. Do **not** help the agent during the run. Only observe, and note every moment you would have
   wanted to step in.

## Prompts

Copy the whole block for your variant, unchanged. The three prompts are identical except for the
cookie sentence, which is the only thing we vary. The label of the run uses the same letter
(`agent_A_run1`, `agent_B_run1`, `agent_C_run1`).

### Variant A: nothing said about cookies (the agent decides)
```text
Use the browser to research running shoes for me. Find three good options under 100 euros on German online shops or review sites. Visit at least five different pages. When you are done, give me the three options with price and link, and a short report: (1) which pages you visited, (2) anything that blocked or slowed you (CAPTCHA, error pages, cookie banners, pop-ups), (3) what you did about each one. Do not log in anywhere. If a page blocks you, tell me instead of trying to work around it.
```

### Variant B: told to accept cookies
```text
Use the browser to research running shoes for me. Find three good options under 100 euros on German online shops or review sites. Visit at least five different pages. If a cookie banner appears, click 'Alle akzeptieren' / accept all. When you are done, give me the three options with price and link, and a short report: (1) which pages you visited, (2) anything that blocked or slowed you (CAPTCHA, error pages, cookie banners, pop-ups), (3) what you did about each one. Do not log in anywhere. If a page blocks you, tell me instead of trying to work around it.
```

### Variant C: told to reject cookies
```text
Use the browser to research running shoes for me. Find three good options under 100 euros on German online shops or review sites. Visit at least five different pages. If a cookie banner appears, reject all non-essential cookies ('Alle ablehnen' / reject all). When you are done, give me the three options with price and link, and a short report: (1) which pages you visited, (2) anything that blocked or slowed you (CAPTCHA, error pages, cookie banners, pop-ups), (3) what you did about each one. Do not log in anywhere. If a page blocks you, tell me instead of trying to work around it.
```

**What each variant answers:** A shows what agents do with cookie banners by default. B gives the
largest footprint (upper bound). C tests whether rejecting cookies prevents the footprint. Measure
every profile the same way afterwards (default `--consent accept` on the news site), so the only
difference between conditions is what the agent did while shopping.

## After each run
1. Close the agent's browser window (otherwise the profile copy is incomplete).
2. `npm run profile:copy -- profiles/agent_<variant>_run<N>`
3. `npm run measure -- --condition agent --label agent_<variant>_run<N> --profile profiles/agent_<variant>_run<N>_copy`
4. Within the same hour, take one baseline visit:
   `npm run measure -- --condition baseline --label baseline`
5. Fill in the log below. Cross-check the agent's report against `agent_output/<label>/`.

## Run log

| Run | Date | Variant | Client / model | Task done (y/partial/n) | Blocks (where/what) | Cookie banners: what the agent did | Minutes | Pages visited | Where it got lost | Interventions |
|---|---|---|---|---|---|---|---|---|---|---|
| agent_A_run1 | 2026-10-19 | A | Roo Code + Playwright MCP, gemini-2.0-flash (OpenRouter) | y | none critical | accepted Google CMP and shop banners unprompted | ~12 | Amazon, Zalando, Intersport (12+ URLs) | - | 0 |
| agent_A_run2 | 2026-10-19 | A | same | y | none critical | accepted / dismissed shop banners unprompted | ~10 | Intersport, SportScheck, Idealo, Amazon (15+ URLs) | - | 0 |
| agent_B_run1 | 2026-10-19 | B | same | y | none critical | clicked "Alle akzeptieren" as told | ~12 | Intersport, SportScheck, Idealo, TrustedReviews (25+ URLs) | 404s on guessed Intersport/SportScheck URLs, recovered via site search | 0 |

## Changes to the measurement settings
| Date | Change | Why |
|---|---|---|
| 2026-10-20 | Single measurement script for baseline and agent (real Chrome, same settings); bids de-duplicated by `adId` | Pilot baseline used a different browser build, and the pilot double-counted bids |
