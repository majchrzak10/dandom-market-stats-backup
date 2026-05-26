/**
 * Scraper nieruchomosci-online.pl - uzywa JSON-LD (schema.org/Offer) wbudowanego w HTML.
 *
 * Pagination: `&p=N`. Default page size ~41 ofert.
 * Slug miast: lowercase bez polskich znakow ("wagrowiec", "rogozno").
 * Dane JSON-LD sciezka: data.mainEntity.offers[0].offers (AggregateOffer.offers).
 *
 * Strażnik bezpieczeczenstwa:
 *  - max 8 stron per kategoria/miasto (~328 ofert/miasto-kat)
 *  - 4-7s delay miedzy requestami
 *  - graceful failure: jedna strona padła, pomijamy
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://www.nieruchomosci-online.pl";

const CATEGORIES = [
  { slug: "mieszkanie", estate: "FLAT" },
  { slug: "dom", estate: "HOUSE" },
  { slug: "dzialka", estate: "PLOT" },
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitterDelay() {
  return 4000 + Math.floor(Math.random() * 3000);
}

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "pl-PL,pl;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function parseJsonLd(html) {
  // Pierwszy block JSON-LD na stronie listingu to CollectionPage z ofertami.
  const m = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractOffers(jsonLd) {
  const agg = jsonLd?.mainEntity?.offers?.[0];
  if (!agg || agg["@type"] !== "AggregateOffer") return [];
  return Array.isArray(agg.offers) ? agg.offers : [];
}

// URL: https://wagrowiec.nieruchomosci-online.pl/mieszkanie,m2,xxx/26578519.html → ID 26578519
function externalIdFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/(\d{6,9})\.html(?:[?#]|$)/);
  return m ? m[1] : null;
}

function num(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function normalizeOffer(o, defaultEstate) {
  if (!o || o["@type"] !== "Offer") return null;
  if (o.priceCurrency && o.priceCurrency !== "PLN") return null;

  const url = o.url || null;
  const externalId = externalIdFromUrl(url);
  if (!externalId) return null;

  const pricePln = num(o.price);
  const pricePerM2 = num(o.priceSpecification?.price);
  const item = o.itemOffered || {};
  const areaM2 = num(item.floorSize?.value);
  const rooms = num(item.numberOfRooms);
  const addr = item.address || {};

  return {
    source: "nieruchomosci-online",
    externalId,
    title: o.name || "",
    estate: defaultEstate,
    transaction: "SELL",
    pricePln: pricePln != null ? Math.round(pricePln) : null,
    pricePerM2: pricePerM2 != null ? Math.round(pricePerM2) : null,
    areaM2,
    rooms,
    floor: null,
    city: addr.addressLocality || "",
    street: addr.streetAddress || "",
    province: addr.addressRegion || "",
    isPrivate: false, // NO nie udostepnia tej informacji w JSON-LD
    agencyName: null,
    dateCreated: null, // brak w JSON-LD - trzeba by parsowac szczegolowa strone
    href: url,
  };
}

/**
 * Pobiera oferty z NO dla danego miasta + kategorii (paginacja przez &p=N).
 */
export async function fetchNoForCity({ category, citySlug, maxPages = 8 }) {
  const offers = [];
  const seenIds = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const pageParam = page > 1 ? `&p=${page}` : "";
    const url = `${BASE}/szukaj.html?3,${category.slug},sprzedaz,,${citySlug}${pageParam}`;

    let html;
    try {
      html = await fetchPage(url);
    } catch (err) {
      console.warn(`[NO] ${citySlug}/${category.slug} strona ${page}: ${err.message}`);
      break;
    }

    const jsonLd = parseJsonLd(html);
    if (!jsonLd) {
      console.warn(`[NO] Brak JSON-LD na ${citySlug}/${category.slug} p.${page}`);
      break;
    }

    const raw = extractOffers(jsonLd);
    if (raw.length === 0) break;

    let pageNew = 0;
    for (const r of raw) {
      const n = normalizeOffer(r, category.estate);
      if (!n) continue;
      if (seenIds.has(n.externalId)) continue;
      seenIds.add(n.externalId);
      offers.push(n);
      pageNew++;
    }

    console.log(`[NO] ${citySlug}/${category.slug} p.${page}: ${raw.length} raw, ${pageNew} nowych`);

    // Jezeli strona zwrocila te same ID co poprzednia (paginacja sie konczy) - stop
    if (pageNew === 0) break;

    if (page < maxPages) await sleep(jitterDelay());
  }

  return offers;
}

export async function fetchNoSnapshot({ cities = ["wagrowiec", "rogozno"] } = {}) {
  const all = [];
  for (const citySlug of cities) {
    for (const category of CATEGORIES) {
      const offers = await fetchNoForCity({ category, citySlug });
      all.push(...offers);
      await sleep(jitterDelay());
    }
  }
  return all;
}
