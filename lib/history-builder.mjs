/**
 * Buduje historyczne agregaty miesięczne — co było aktywne na koniec każdego miesiąca,
 * mediana cen, mediana zł/m², średni czas na rynku, miks kategorii i miast.
 *
 * UWAGA — survivorship bias:
 *  Dla miesięcy PRZED `trackingStartDate` (data najwcześniejszego snapshotu) nie widzimy ofert,
 *  które zostały sprzedane/wycofane zanim zaczęliśmy tracking. Wynik jest oszacowaniem.
 *  Od `trackingStartDate` historia jest pełna (offer_removed eventy mamy).
 *
 * Cena: używamy bieżącej ceny z aktywnej oferty lub ceny z momentu offer_added.
 * Nie odtwarzamy price_changed wstecz — dodać w przyszłości jeśli będzie potrzeba.
 */

function endOfMonth(year, month) {
  // month: 1-12 → ostatni dzień miesiąca w UTC ISO
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : s[m];
}

function mean(arr) {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function daysBetween(dateA, dateB) {
  const a = Date.parse(dateA);
  const b = Date.parse(dateB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function monthRange(startMonthISO, endMonthISO) {
  // startMonthISO / endMonthISO: "YYYY-MM"
  const out = [];
  const [y0, m0] = startMonthISO.split("-").map(Number);
  const [y1, m1] = endMonthISO.split("-").map(Number);
  let y = y0;
  let m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    out.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      year: y,
      month: m,
      end: endOfMonth(y, m),
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Rdzeń: bierze znormalizowane oferty i wylicza agregaty miesięczne.
 * Każda oferta musi mieć: { listedAt, removedDate|null, pricePln, pricePerM2,
 *   category, city, transaction, areaM2 }.
 */
function aggregateMonthly({ normalizedOffers, trackingStartDate, today, saleLabel = "SPRZEDAŻ" }) {
  const allListedAts = normalizedOffers
    .map((o) => o.listedAt)
    .filter(Boolean)
    .sort();

  if (allListedAts.length === 0) {
    return { earliestListedAt: null, months: [] };
  }

  const earliestListedAt = allListedAts[0];
  const startMonth = earliestListedAt.slice(0, 7);
  const endMonth = today.slice(0, 7);
  const months = monthRange(startMonth, endMonth);

  const result = months.map((M) => {
    const active = normalizedOffers.filter((o) => {
      if (!o.listedAt || o.listedAt > M.end) return false;
      if (o.removedDate && o.removedDate <= M.end) return false;
      return true;
    });

    const sale = active.filter((o) => o.transaction === saleLabel);
    const prices = sale.map((o) => o.pricePln).filter(Boolean);
    const pricesPerM2 = sale.map((o) => o.pricePerM2).filter(Boolean);
    const daysOnMarket = active
      .map((o) => daysBetween(o.listedAt, M.end))
      .filter((d) => d != null && d >= 0);

    const byCategory = {};
    for (const o of active) {
      byCategory[o.category] = (byCategory[o.category] || 0) + 1;
    }

    const cityCounts = {};
    for (const o of active) {
      if (!o.city) continue;
      cityCounts[o.city] = (cityCounts[o.city] || 0) + 1;
    }
    const topCities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([city, count]) => ({ city, count }));

    return {
      key: M.key,
      year: M.year,
      month: M.month,
      end: M.end,
      total: active.length,
      sale: sale.length,
      byCategory,
      medianPrice: median(prices),
      avgPrice: mean(prices),
      medianPricePerM2: median(pricesPerM2),
      avgDaysOnMarket: mean(daysOnMarket),
      medianDaysOnMarket: median(daysOnMarket),
      topCities,
      beforeTracking: M.end < trackingStartDate,
    };
  });

  return {
    earliestListedAt,
    months: result.filter((m) => m.end >= trackingStartDate),
  };
}

/**
 * @param {object} args
 * @param {Array} args.events - eventy z lib/events-loader.loadAllEvents
 * @param {Array} args.currentOffers - aktualnie aktywne oferty (latest snapshot)
 * @param {Array} args.snapshots - wszystkie snapshoty
 * @returns {object}
 */
export function buildMonthlyHistory({ events, currentOffers, snapshots }) {
  const addedEvents = events.filter((e) => e.type === "offer_added");
  const removedEvents = events.filter((e) => e.type === "offer_removed");
  const removedBySig = new Map(removedEvents.map((e) => [e.signature, e]));

  // Mapa: signature → meta. Aktualne oferty mają pierwszeństwo (najświeższe ceny).
  const offerMeta = new Map();

  for (const o of currentOffers) {
    offerMeta.set(o.signature, {
      signature: o.signature,
      listedAt: o.listedAt,
      pricePln: o.pricePln,
      pricePerM2: o.pricePerM2,
      areaM2: o.areaM2,
      category: o.category,
      transaction: o.transaction,
      city: (o.city || "").toUpperCase(),
      removedDate: null,
    });
  }

  // Dla zniknionych ofert: rekonstrukcja z eventu offer_added
  for (const e of addedEvents) {
    if (offerMeta.has(e.signature)) continue;
    const removed = removedBySig.get(e.signature);
    offerMeta.set(e.signature, {
      signature: e.signature,
      listedAt: e.listedAt,
      pricePln: e.pricePln,
      pricePerM2:
        e.pricePln && e.areaM2 ? Math.round(e.pricePln / e.areaM2) : null,
      areaM2: e.areaM2,
      category: e.category,
      transaction: e.transaction,
      city: (e.city || "").toUpperCase(),
      removedDate: removed?.date || null,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const trackingStartDate = snapshots.length > 0 ? snapshots[0].date : today;

  const normalizedOffers = Array.from(offerMeta.values());
  const { earliestListedAt, months } = aggregateMonthly({
    normalizedOffers,
    trackingStartDate,
    today,
    saleLabel: "SPRZEDAŻ",
  });

  return {
    trackingStartDate,
    earliestListedAt,
    months,
  };
}

// FLAT/HOUSE/PLOT z Otodom, TERRAIN z OLX (= działka), INVESTMENT = nowe inwestycje deweloperskie.
const ESTATE_TO_CATEGORY = {
  FLAT: "MIESZKANIE",
  HOUSE: "DOM",
  PLOT: "DZIAŁKA",
  TERRAIN: "DZIAŁKA",
  INVESTMENT: "INWESTYCJA",
};

/**
 * Historia konkurencji — buduje z serii dziennych snapshotów Otodom/OLX.
 *
 * Logika "kiedy zniknęła":
 *   - dla każdej unikalnej oferty patrzymy w którym snapshocie pojawia się ostatni raz
 *   - jeśli nie ma jej w najnowszym snapshocie → removedDate = ostatni snapshot w którym była
 *   - dateCreated z Otodom/OLX traktujemy jako listedAt
 *   - odrzucamy oferty z dateCreated < 2010 (śmieciowe wartości typu 1999-02-29)
 *
 * @param {Array} snapshots - posortowane chronologicznie competitor snapshots
 */
export function buildCompetitorHistory({ snapshots }) {
  if (!snapshots || snapshots.length === 0) {
    return { trackingStartDate: null, earliestListedAt: null, months: [] };
  }

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const trackingStartDate = sorted[0].date;
  const latestDate = sorted[sorted.length - 1].date;
  const today = new Date().toISOString().slice(0, 10);

  // Klucz unikalnej oferty: signature z combined (deterministyczny) lub fallback source+externalId
  const keyOf = (o) => o.signature || `${o.source}|${o.externalId}`;

  // Zbiór unique offers z lastSeenDate
  const offerMap = new Map();
  for (const snap of sorted) {
    for (const o of snap.offers || []) {
      const k = keyOf(o);
      if (!offerMap.has(k)) {
        offerMap.set(k, { offer: o, lastSeen: snap.date });
      } else {
        offerMap.get(k).lastSeen = snap.date;
        // Zachowujemy najnowsze meta (np. cena mogła się zmienić)
        offerMap.get(k).offer = o;
      }
    }
  }

  // Normalizuj
  const normalizedOffers = [];
  for (const { offer, lastSeen } of offerMap.values()) {
    const listedAt = (offer.dateCreated || "").slice(0, 10);
    if (!listedAt || listedAt < "2010-01-01" || listedAt > today) continue;
    const isActiveNow = lastSeen === latestDate;
    normalizedOffers.push({
      listedAt,
      removedDate: isActiveNow ? null : lastSeen,
      pricePln: offer.pricePln,
      pricePerM2: offer.pricePerM2,
      areaM2: offer.areaM2,
      category: ESTATE_TO_CATEGORY[offer.estate] || offer.estate || "—",
      city: (offer.city || "").toUpperCase(),
      transaction: offer.transaction === "SELL" ? "SPRZEDAŻ" : offer.transaction === "RENT" ? "WYNAJEM" : offer.transaction,
    });
  }

  const { earliestListedAt, months } = aggregateMonthly({
    normalizedOffers,
    trackingStartDate,
    today,
    saleLabel: "SPRZEDAŻ",
  });

  return {
    trackingStartDate,
    earliestListedAt,
    months,
    totalOffers: normalizedOffers.length,
  };
}
