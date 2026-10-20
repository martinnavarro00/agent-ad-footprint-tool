'use strict';

/**
 * Reading header-bidding (Prebid.js) auctions from inside a page.
 *
 * Two sources are combined:
 *   1. a live hook on `bidResponse` / `noBid` events, installed before the
 *      page's own scripts run (installPrebidHook), and
 *   2. `pbjs.getEvents()`, which also contains bids that arrived before the
 *      hook was attached.
 * Both sources describe the same bids, so results MUST go through
 * BidStore (src/bidStore.js), which removes duplicates.
 *
 * NOTE: the functions passed to addInitScript / page.evaluate are serialized
 * and run in the browser, so they cannot use anything from this Node module.
 */

/** Runs in the page before any page script. Exposes window.__prebidObserver. */
function installPrebidHook() {
  function normalizeBid(bid, instance, version) {
    const meta = bid.meta || {};
    const targeting = bid.adserverTargeting || {};
    let advertiser = null;
    if (Array.isArray(meta.advertiserDomains) && meta.advertiserDomains.length > 0) {
      advertiser = meta.advertiserDomains.join(', ');
    } else {
      advertiser = meta.brandName || meta.advertiserName || targeting.hb_adomain || null;
    }
    return {
      adId: bid.adId || null, // unique per bid response in Prebid -> dedup key
      instance,
      version: version || null,
      slot: bid.adUnitCode || null,
      bidder: bid.bidder || bid.bidderCode || null,
      advertiser,
      cpm: typeof bid.cpm === 'number' ? bid.cpm : null,
      currency: bid.currency || null,
      size: Array.isArray(bid.size) ? bid.size.join('x') : bid.size || (bid.width ? `${bid.width}x${bid.height}` : null),
      creativeId: bid.creativeId || targeting.hb_crid || null,
      dealId: bid.dealId || targeting.hb_deal || null,
      mediaType: bid.mediaType || targeting.hb_format || null,
      timeToRespond: bid.timeToRespond || null,
    };
  }

  const observer = { bids: [], noBids: [], normalizeBid };
  window.__prebidObserver = observer;

  const hooked = new Set();
  setInterval(() => {
    // Sites may rename Prebid; renamed instances are listed in _pbjsGlobals.
    const names = new Set(['pbjs', ...(window._pbjsGlobals || [])]);
    for (const name of names) {
      const pb = window[name];
      if (!pb || typeof pb.onEvent !== 'function' || hooked.has(name)) continue;
      hooked.add(name);
      pb.onEvent('bidResponse', (bid) => observer.bids.push(normalizeBid(bid, name, pb.version)));
      pb.onEvent('noBid', (nb) =>
        observer.noBids.push({ instance: name, slot: nb.adUnitCode || null, bidder: nb.bidder || nb.bidderCode || null }),
      );
    }
  }, 100);
}

/** Runs in the page. Returns everything observed so far (with duplicates). */
function readPrebidState() {
  const observer = window.__prebidObserver;
  if (!observer) return { instances: [], bids: [], noBids: [] };

  const bids = [...observer.bids];
  const noBids = [...observer.noBids];
  const instances = [];

  for (const name of new Set(['pbjs', ...(window._pbjsGlobals || [])])) {
    const pb = window[name];
    if (!pb) continue;
    instances.push({ name, version: pb.version || null });
    if (typeof pb.getEvents !== 'function') continue;
    try {
      for (const ev of pb.getEvents() || []) {
        if (ev.eventType === 'bidResponse' && ev.args) {
          bids.push(observer.normalizeBid(ev.args, name, pb.version));
        } else if (ev.eventType === 'noBid' && ev.args) {
          noBids.push({ instance: name, slot: ev.args.adUnitCode || null, bidder: ev.args.bidder || ev.args.bidderCode || null });
        }
      }
    } catch (_) {
      /* some builds throw while an auction is running; next poll will catch up */
    }
  }
  return { instances, bids, noBids };
}

module.exports = { installPrebidHook, readPrebidState };
