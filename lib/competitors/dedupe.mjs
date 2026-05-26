/**
 * Deduplikacja ofert konkurencji (Otodom + OLX + Nieruchomosci-Online).
 *
 * Strategie matchowania (od najpewniejszej do heurystycznej):
 *
 * 1. EXTERNAL URL (OLX → Otodom)
 *    OLX `externalUrl` często wskazuje konkretną ofertę na otodom.
 *    Wyciągamy otodom slug z URL i matchujemy z otodom.href.
 *
 * 2. SAME CITY + SAME AREA + SAME PRICE (±2%)
 *    Identyczna oferta wystawiona na kilku portalach (NO też tak działa).
 *
 * Każda zduplikowana oferta dostaje:
 *   - sources: ["otodom","olx","nieruchomosci-online"] (subset)
 *   - olxId / nieruchomosciOnlineId: zewnętrzne ID drugiej strony (opcjonalnie)
 */

function otodomSlugFromUrl(url) {
  if (!url) return null;
  const m = url.match(/-(ID[0-9a-zA-Z]+)(?:\.html|$|\/)/);
  return m ? m[1] : null;
}

function otodomSlugFromHref(href) {
  if (!href) return null;
  const m = href.match(/-(ID[0-9a-zA-Z]+)(?:\/|$)/);
  return m ? m[1] : null;
}

function approxEqual(a, b, tolerancePct = 2) {
  if (a == null || b == null) return false;
  if (a === 0 || b === 0) return a === b;
  return Math.abs(a - b) / Math.max(a, b) <= tolerancePct / 100;
}

function buildMatchKey(offer) {
  if (!offer.city || !offer.areaM2 || !offer.pricePln) return null;
  const areaBucket = Math.round(offer.areaM2);
  const priceBucket = Math.round(offer.pricePln / 5000) * 5000;
  return `${offer.city.toUpperCase()}|${areaBucket}|${priceBucket}`;
}

/**
 * Zwraca { unique, duplicates, stats }.
 * - unique: lista unikalnych ofert z metadata sources
 * - duplicates: lista zduplikowanych (do debug)
 */
export function dedupeCompetitorOffers({ otodom, olx, no = [] }) {
  const otodomBySlug = new Map();
  for (const o of otodom) {
    const slug = otodomSlugFromHref(o.href);
    if (slug) otodomBySlug.set(slug, o);
  }

  const unique = [];
  const duplicates = [];

  // 1. Otodom = baza (source of truth, najpełniejsze dane)
  for (const o of otodom) {
    unique.push({ ...o, sources: ["otodom"] });
  }

  // Index unique po klucz miasto|m²|cena dla heurystyki
  const matchKeyToIndex = new Map();
  function rebuildKeyIndex() {
    matchKeyToIndex.clear();
    for (let i = 0; i < unique.length; i++) {
      const k = buildMatchKey(unique[i]);
      if (k) {
        if (!matchKeyToIndex.has(k)) matchKeyToIndex.set(k, []);
        matchKeyToIndex.get(k).push(i);
      }
    }
  }
  rebuildKeyIndex();

  let olxViaExternalUrl = 0;
  let olxViaKeyMatch = 0;
  let noViaKeyMatch = 0;

  // 2. OLX: spróbuj zmatchować z otodom
  for (const o of olx) {
    // 2a. externalUrl → otodom slug
    const externalSlug = otodomSlugFromUrl(o.externalUrl);
    if (externalSlug && otodomBySlug.has(externalSlug)) {
      const target = otodomBySlug.get(externalSlug);
      const idx = unique.findIndex((u) => u.externalId === target.externalId);
      if (idx >= 0 && !unique[idx].sources.includes("olx")) {
        unique[idx].sources.push("olx");
        unique[idx].olxId = o.externalId;
        if (!unique[idx].lat && o.lat) {
          unique[idx].lat = o.lat;
          unique[idx].lon = o.lon;
        }
        olxViaExternalUrl++;
        duplicates.push({ olxId: o.externalId, matched: target.externalId, via: "externalUrl" });
        continue;
      }
    }

    // 2b. Klucz miasto+m²+cena
    const matched = findKeyMatch(o, unique, matchKeyToIndex);
    if (matched != null) {
      if (!unique[matched].sources.includes("olx")) {
        unique[matched].sources.push("olx");
        unique[matched].olxId = o.externalId;
        if (!unique[matched].lat && o.lat) {
          unique[matched].lat = o.lat;
          unique[matched].lon = o.lon;
        }
        olxViaKeyMatch++;
        duplicates.push({ olxId: o.externalId, matched: unique[matched].externalId, via: "key" });
        continue;
      }
    }

    // 2c. Unique OLX
    unique.push({ ...o, sources: ["olx"] });
  }

  // OLX dorzucił swoje unique - przebudowujemy index żeby NO mogło matchować też z OLX
  rebuildKeyIndex();

  // 3. Nieruchomosci-Online: matchuj przez klucz (brak external URL referencji)
  for (const n of no) {
    const matched = findKeyMatch(n, unique, matchKeyToIndex);
    if (matched != null) {
      if (!unique[matched].sources.includes("nieruchomosci-online")) {
        unique[matched].sources.push("nieruchomosci-online");
        unique[matched].nieruchomosciOnlineId = n.externalId;
        noViaKeyMatch++;
        duplicates.push({ noId: n.externalId, matched: unique[matched].externalId, via: "key" });
        continue;
      }
    }
    unique.push({ ...n, sources: ["nieruchomosci-online"] });
  }

  return {
    unique,
    duplicates,
    stats: {
      otodomTotal: otodom.length,
      olxTotal: olx.length,
      noTotal: no.length,
      uniqueCombined: unique.length,
      duplicatesFound: duplicates.length,
      olxViaExternalUrl,
      olxViaKeyMatch,
      noViaKeyMatch,
    },
  };
}

function findKeyMatch(offer, unique, matchKeyToIndex) {
  const key = buildMatchKey(offer);
  if (!key || !matchKeyToIndex.has(key)) return null;
  for (const idx of matchKeyToIndex.get(key)) {
    const u = unique[idx];
    if (approxEqual(u.areaM2, offer.areaM2, 3) && approxEqual(u.pricePln, offer.pricePln, 2)) {
      return idx;
    }
  }
  return null;
}
