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

const BUCKET_DAYS = 14;

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(dateISO, days) {
  return isoDate(Date.parse(dateISO) + days * 86_400_000);
}

/**
 * Zwraca listę bucketów 14-dniowych od `startDateISO` do `endDateISO` włącznie.
 * Każdy bucket: { key, start, end } gdzie end = data ostatniego dnia w bucketcie.
 * Pierwszy bucket startuje w `startDateISO`, kolejne co +14 dni.
 */
function biweeklyRange(startDateISO, endDateISO) {
  const out = [];
  let start = startDateISO;
  while (start <= endDateISO) {
    const end = addDays(start, BUCKET_DAYS - 1);
    out.push({ key: end, start, end });
    start = addDays(start, BUCKET_DAYS);
  }
  return out;
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


/**
 * Rdzeń: bierze znormalizowane oferty i wylicza agregaty w 14-dniowych bucketach.
 * Pole `months` w wyniku zachowane dla wstecznej kompatybilności z dashboardem —
 * pomimo nazwy zawiera buckety dwutygodniowe (key = data końca bucketu).
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
  // Buckety zaczynają się od trackingStartDate — przed nim mamy survivorship bias
  // i tak buckety są filtrowane na końcu funkcji. Liczymy od startu trackingu.
  const buckets = biweeklyRange(trackingStartDate, today);

  const result = buckets.map((B) => {
    const active = normalizedOffers.filter((o) => {
      if (!o.listedAt || o.listedAt > B.end) return false;
      if (o.removedDate && o.removedDate <= B.end) return false;
      return true;
    });

    const sale = active.filter((o) => o.transaction === saleLabel);
    const prices = sale.map((o) => o.pricePln).filter(Boolean);
    const pricesPerM2 = sale.map((o) => o.pricePerM2).filter(Boolean);
    const daysOnMarket = active
      .map((o) => daysBetween(o.listedAt, B.end))
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
      key: B.key,
      start: B.start,
      end: B.end,
      total: active.length,
      sale: sale.length,
      byCategory,
      medianPrice: median(prices),
      avgPrice: mean(prices),
      medianPricePerM2: median(pricesPerM2),
      avgDaysOnMarket: mean(daysOnMarket),
      medianDaysOnMarket: median(daysOnMarket),
      topCities,
      beforeTracking: B.end < trackingStartDate,
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
  // Dla ofert bez dateCreated (NO nie udostępnia tego w JSON-LD) używamy lastSeen
  // jako proxy daty wprowadzenia. To zaniża "czas na rynku" ale jest najmniej zła
  // opcja - alternatywą jest odrzucenie wszystkich ofert NO z analizy historycznej.
  const normalizedOffers = [];
  for (const { offer, lastSeen } of offerMap.values()) {
    const rawListed = (offer.dateCreated || "").slice(0, 10);
    const listedAt = rawListed && rawListed >= "2010-01-01" && rawListed <= today ? rawListed : lastSeen;
    if (!listedAt) continue;
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
