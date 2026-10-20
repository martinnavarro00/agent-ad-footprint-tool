'use strict';

/**
 * Collects polled bids without double counting and summarizes them.
 * Pure logic (no browser), covered by test/bidStore.test.js.
 */

/**
 * Identity of one bid response. Prebid's adId is unique per response; older
 * records without adId fall back to the bid's descriptive fields. CPM is
 * deliberately NOT part of the key: different Prebid APIs return the same bid
 * with differently rounded CPMs (e.g. 0.80011 vs 0.8).
 */
function bidKey(bid) {
  if (bid.adId) return `id:${bid.adId}`;
  return ['f', bid.instance, bid.slot, bid.bidder, bid.creativeId, bid.size, bid.advertiser].join('|');
}

function noBidKey(nb) {
  return [nb.instance, nb.slot, nb.bidder].join('|');
}

class BidStore {
  constructor() {
    this._bids = new Map();
    this._noBids = new Map();
    this._instances = new Map();
  }

  /**
   * Add one poll result. The phase of a bid is the phase in which it was
   * FIRST seen, so a bid from before consent is never counted as "after".
   */
  add({ bids = [], noBids = [], instances = [] }, phase) {
    for (const inst of instances) this._instances.set(inst.name, inst.version);
    for (const bid of bids) {
      if (!bid.bidder) continue;
      const key = bidKey(bid);
      const existing = this._bids.get(key);
      if (!existing) {
        this._bids.set(key, { phase, firstSeen: new Date().toISOString(), ...bid });
      } else if (!existing.version && bid.version) {
        existing.version = bid.version;
      }
    }
    for (const nb of noBids) {
      if (!nb.bidder) continue;
      const key = noBidKey(nb);
      if (!this._noBids.has(key)) this._noBids.set(key, { phase, ...nb });
    }
  }

  bids(phase) {
    const all = [...this._bids.values()];
    return phase ? all.filter((b) => b.phase === phase) : all;
  }

  noBids(phase) {
    const all = [...this._noBids.values()];
    return phase ? all.filter((b) => b.phase === phase) : all;
  }

  instances() {
    return [...this._instances].map(([name, version]) => ({ name, version }));
  }
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (x, digits = 4) => (x === null ? null : Number(x.toFixed(digits)));

/** Summary statistics for a list of (already de-duplicated) bids. */
function summarize(bids, noBids = []) {
  const cpms = bids.map((b) => b.cpm).filter((c) => typeof c === 'number');
  return {
    bids: bids.length,
    noBids: noBids.length,
    slots: new Set(bids.map((b) => b.slot)).size,
    bidders: [...new Set(bids.map((b) => b.bidder))].sort(),
    advertisers: [...new Set(bids.map((b) => b.advertiser).filter(Boolean))].sort(),
    meanCpm: cpms.length ? round(cpms.reduce((a, b) => a + b, 0) / cpms.length) : null,
    medianCpm: round(median(cpms)),
    maxCpm: cpms.length ? Math.max(...cpms) : null,
  };
}

/** De-duplicate a plain list of bids (e.g. when re-reading old records). */
function dedupe(bids) {
  const seen = new Map();
  for (const b of bids) if (!seen.has(bidKey(b))) seen.set(bidKey(b), b);
  return [...seen.values()];
}

module.exports = { BidStore, bidKey, summarize, median, dedupe };
