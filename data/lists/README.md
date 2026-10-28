# Website lists

Put site lists for `npm run prevalence` here. List files are not committed; write down **which
list and which month** you used instead, so the crawl can be reproduced and cited.

## CrUX: sites real people use (recommended)

The Chrome UX Report (CrUX) ranks websites by how many real Chrome users visit them. It is
published monthly by Google and is considered more accurate than other top lists. Ranks come in
buckets (top 1k, 10k, 100k, 1M); sites inside a bucket are not ordered.

- **Global list** (CSV `origin,rank`): the `crux-top-lists` project on GitHub (zakird/crux-top-lists),
  file `data/global/current.csv.gz`. Unzip and save as `data/lists/crux_global.csv`.
- **Germany**: Google publishes per-country lists in BigQuery (`chrome-ux-report.experimental.country`,
  `country_code = 'de'`). Check the crux-top-lists repo for ready-made country files first; otherwise
  export the German list from BigQuery as `origin,rank` and save it as `data/lists/crux_de.csv`.

## Tranco: general research ranking

Combines several popularity sources; standard in web-measurement papers, but contains many
infrastructure domains (CDNs, APIs) that are not sites people visit. Use it as context, not as the
main list. Download from <https://tranco-list.eu> (CSV `rank,domain`) and note the list ID.

## German news and content sites (`news_de.txt`, committed)

50 well-known German news, magazine and high-traffic content sites, hand-picked as candidates for
the ad measurement. Crawl it to see which of them run Prebid, then choose measurement sites from
those: `npm run prevalence -- --list data/lists/news_de.txt --out results/prevalence_news_de.jsonl`

## Own lists

One domain per line (`spiegel.de`) or one URL per line (`https://www.spiegel.de/politik/...`),
e.g. German news sites or the sites agents visited in our runs.
