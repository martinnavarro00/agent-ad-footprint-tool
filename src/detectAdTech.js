'use strict';

/**
 * Detect header-bidding / ad-tech libraries on a page (used by scripts/prevalence.js).
 *
 * Two independent signals, so a site counts as "Prebid" if either fires:
 *   1. JavaScript globals: window.pbjs or a renamed instance listed in
 *      window._pbjsGlobals (the official way Prebid registers renamed copies).
 *   2. Network: a loaded script whose URL looks like Prebid (collected in Node
 *      from page requests, see PREBID_URL).
 * Google Publisher Tag and Amazon's apstag are recorded too, because header
 * bidding usually runs next to them and they give context for the numbers.
 */

/** Script URLs that indicate Prebid.js (file names used by the official builds and common CDNs). */
const PREBID_URL = /prebid[^/]*\.js|\/prebid\/|pbjs|prebid-/i;

/** Runs in the page. Must be self-contained (it is serialized by Playwright). */
function readAdTechGlobals() {
  const names = Array.from(new Set(['pbjs', ...(Array.isArray(window._pbjsGlobals) ? window._pbjsGlobals : [])]));
  const instances = [];
  const bidders = new Set();
  for (const name of names) {
    const pb = window[name];
    // Before Prebid loads, pages often define a stub { que: [] }; only count real instances.
    if (!pb || typeof pb !== 'object') continue;
    const loaded = typeof pb.requestBids === 'function' || typeof pb.getConfig === 'function';
    instances.push({ name, version: pb.version || null, loaded });
    try {
      for (const unit of pb.adUnits || []) {
        for (const bid of unit.bids || []) if (bid && bid.bidder) bidders.add(bid.bidder);
      }
    } catch (_) {
      /* adUnits may be a getter that throws on some builds */
    }
  }
  return {
    prebid: instances.some((i) => i.loaded),
    prebidStub: instances.length > 0 && !instances.some((i) => i.loaded),
    instances,
    bidders: [...bidders].sort(),
    gpt: !!(window.googletag && typeof window.googletag.defineSlot === 'function'),
    apstag: !!(window.apstag && typeof window.apstag.fetchBids === 'function'),
  };
}

/**
 * Ad-tech vendors recognised from the URLs a page requests.
 * `role` says what the vendor does on a page:
 *   - header-bidding: browser-side auction (Prebid itself is detected via globals/scripts above)
 *   - ad-server:      decides which ad fills a slot (Google Ad Manager / GPT)
 *   - ad-network:     simple ad network the site embeds directly (AdSense)
 *   - native:         "recommended for you" content-ad widgets
 *   - exchange:       sells ad space / bids in auctions (SSPs, DSPs)
 *   - tracking:       collects data for ad targeting (retargeting pixels); shows no ads itself
 * Patterns are deliberately host-based and conservative; extend the list as needed.
 */
const AD_VENDORS = [
  { name: 'Amazon TAM / UAM', role: 'header-bidding', pattern: /c\.amazon-adsystem\.com|aax\.amazon-adsystem\.com/ },
  { name: 'Google Ad Manager (GPT)', role: 'ad-server', pattern: /securepubads\.g\.doubleclick\.net|googletagservices\.com\/tag\/js\/gpt/ },
  { name: 'Google AdSense', role: 'ad-network', pattern: /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle|adsbygoogle/ },
  { name: 'Taboola', role: 'native', pattern: /taboola\.com/ },
  { name: 'Outbrain', role: 'native', pattern: /outbrain\.com|outbrainimg\.com/ },
  { name: 'Plista', role: 'native', pattern: /plista\.com/ },
  { name: 'Criteo', role: 'exchange', pattern: /criteo\.(com|net)/ },
  { name: 'Xandr / Microsoft (AppNexus)', role: 'exchange', pattern: /adnxs\.com/ },
  { name: 'Magnite (Rubicon)', role: 'exchange', pattern: /rubiconproject\.com/ },
  { name: 'PubMatic', role: 'exchange', pattern: /pubmatic\.com/ },
  { name: 'Index Exchange', role: 'exchange', pattern: /casalemedia\.com|indexww\.com/ },
  { name: 'OpenX', role: 'exchange', pattern: /openx\.net/ },
  { name: 'Equativ (Smart AdServer)', role: 'exchange', pattern: /smartadserver\.com/ },
  { name: 'Yieldlab', role: 'exchange', pattern: /yieldlab\.net/ },
  { name: 'Adform', role: 'exchange', pattern: /adform\.net|adformdsp\.net/ },
  { name: 'Teads', role: 'exchange', pattern: /teads\.tv/ },
  { name: 'Seedtag', role: 'exchange', pattern: /seedtag\.com/ },
  { name: 'Google DV360 / ad delivery', role: 'exchange', pattern: /googlesyndication\.com|(?<!securepubads\.g\.)doubleclick\.net/ },
  { name: 'Meta Pixel', role: 'tracking', pattern: /connect\.facebook\.net\/.*fbevents|facebook\.com\/tr/ },
  { name: 'Google Ads conversion / remarketing', role: 'tracking', pattern: /googleadservices\.com|googleads\.g\.doubleclick\.net\/pagead\/viewthroughconversion/ },
  { name: 'TikTok Pixel', role: 'tracking', pattern: /analytics\.tiktok\.com/ },
  { name: 'Microsoft Ads (UET)', role: 'tracking', pattern: /bat\.bing\.com/ },
];

/** Names of all vendors whose pattern matches a request URL. */
function matchVendors(url) {
  return AD_VENDORS.filter((v) => v.pattern.test(url)).map((v) => v.name);
}

/**
 * One label per site for "how does this site show ads?", in priority order.
 * @param {{prebid: boolean, vendors: string[], gpt: boolean, apstag: boolean}} site
 */
function classifyAdSetup({ prebid, vendors, gpt, apstag }) {
  const roles = new Set(AD_VENDORS.filter((v) => vendors.includes(v.name)).map((v) => v.role));
  if (prebid) return 'Prebid (header bidding)';
  if (apstag || vendors.includes('Amazon TAM / UAM')) return 'Amazon TAM, no Prebid';
  if (gpt || vendors.includes('Google Ad Manager (GPT)')) return 'Google Ad Manager only';
  if (vendors.includes('Google AdSense')) return 'Google AdSense';
  if (roles.has('native')) return 'Native widgets only (Taboola/Outbrain/Plista)';
  if (roles.has('exchange')) return 'Other ad exchanges';
  if (roles.has('tracking')) return 'No ads, but ad-tracking pixels';
  return 'No third-party ad tech detected';
}

module.exports = { PREBID_URL, readAdTechGlobals, AD_VENDORS, matchVendors, classifyAdSetup };
