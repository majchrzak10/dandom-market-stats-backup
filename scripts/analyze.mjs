/**
 * Czyta snapshoty + eventy, wylicza statystyki, zapisuje data/analytics.json.
 *
 * Sekcje:
 *  - kpi:              ogólne liczby (aktywne, śr/mediana cen, byCategory)
 *  - timeSeries:       liczba ofert dziennie + added/removed
 *  - segmentation:     byCategory / byCity / byRooms (z avgPrice etc.)
 *  - priceChanges:     bieżące oferty z udokumentowaną zmianą ceny
 *  - timeOnMarket:     dni od pierwszego pojawienia per oferta
 *  - velocity:         histogram inventory aging + statystyki sprzedaży
 *  - agents:           statystyki per agentName (oferty, średnia cena, sprzedaż)
 *  - geo:              statystyki per city + per district (z miastem)
 *  - recentEvents:     ostatnie 30 dni zdarzeń (added/removed/price)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllEvents, buildOfferTimelines } from "../lib/events-loader.mjs";
import { buildMonthlyHistory, buildCompetitorHistory } from "../lib/history-builder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SNAP_DIR = path.join(ROOT, "data", "snapshots");
const EVENTS_DIR = path.join(ROOT, "data", "events");
const COMPETITORS_DIR = path.join(ROOT, "data", "competitors");

const ESTATE_TO_CATEGORY = { FLAT: "MIESZKANIE", HOUSE: "DOM", PLOT: "DZIAŁKA" };

const VELOCITY_BUCKETS = [
  { label: "0–7 dni (świeże)", min: 0, max: 7 },
  { label: "8–30 dni", min: 8, max: 30 },
  { label: "31–90 dni", min: 31, max: 90 },
  { label: "91–180 dni", min: 91, max: 180 },
  { label: ">180 dni (zalegają)", min: 181, max: Infinity },
];

function loadSnapshots() {
  if (!fs.existsSync(SNAP_DIR)) return [];
  return fs
    .readdirSync(SNAP_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), "utf8")));
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

function bucketBy(items, keyFn) {
  const buckets = new Map();
  for (const it of items) {
    const k = keyFn(it) || "—";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  return Array.from(buckets.entries())
    .map(([key, list]) => ({
      key,
      count: list.length,
      avgPrice: mean(list.map((x) => x.pricePln).filter(Boolean)),
      medianPrice: median(list.map((x) => x.pricePln).filter(Boolean)),
      avgPricePerM2: mean(list.map((x) => x.pricePerM2).filter(Boolean)),
    }))
    .sort((a, b) => b.count - a.count);
}

function daysBetween(dateA, dateB) {
  const a = Date.parse(dateA);
  const b = Date.parse(dateB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const snapshots = loadSnapshots();
if (snapshots.length === 0) {
  console.error("Brak snapshotów — uruchom najpierw `npm run snapshot`.");
  process.exit(1);
}

const latest = snapshots[snapshots.length - 1];
const offers = latest.offers;
const sale = offers.filter((o) => o.transaction === "SPRZEDAŻ");
const today = latest.date;
const events = loadAllEvents(EVENTS_DIR);
const timelines = buildOfferTimelines(events);

// === KPI ===
const kpi = {
  date: today,
  totalOffers: offers.length,
  sale: sale.length,
  rent: offers.filter((o) => o.transaction === "WYNAJEM").length,
  avgPrice: mean(sale.map((o) => o.pricePln).filter(Boolean)),
  medianPrice: median(sale.map((o) => o.pricePln).filter(Boolean)),
  avgPricePerM2: mean(sale.map((o) => o.pricePerM2).filter(Boolean)),
  totalActiveValue: offers.reduce((sum, o) => sum + (o.pricePln || 0), 0),
  byCategory: offers.reduce((acc, o) => {
    acc[o.category] = (acc[o.category] || 0) + 1;
    return acc;
  }, {}),
};

// === Time series ===
const sigByDate = new Map(snapshots.map((s) => [s.date, new Set(s.offers.map((o) => o.signature))]));
const timeSeries = snapshots.map((s, i) => {
  const prev = i > 0 ? sigByDate.get(snapshots[i - 1].date) : null;
  const curr = sigByDate.get(s.date);
  const added = prev ? [...curr].filter((sig) => !prev.has(sig)).length : 0;
  const removed = prev ? [...prev].filter((sig) => !curr.has(sig)).length : 0;
  return { date: s.date, total: s.offers.length, added, removed };
});

// === Price changes (z eventów + ze snapshotów) ===
const priceChangeEvents = events.filter((e) => e.type === "price_changed");
const priceChanges = priceChangeEvents
  .map((e) => ({ ...e, currentlyActive: offers.some((o) => o.signature === e.signature) }))
  .sort((a, b) => Math.abs(b.diffPct ?? 0) - Math.abs(a.diffPct ?? 0))
  .slice(0, 50);

// === Time on market (aktywne oferty) ===
// Używamy RZECZYWISTEJ daty wprowadzenia z Asari (listedAt = param 5), nie naszego firstSeenAt.
const timeOnMarket = offers
  .map((o) => {
    const referenceDate = o.listedAt || o.firstSeenAt;
    return {
      signature: o.signature,
      title: o.title,
      city: o.city,
      pricePln: o.pricePln,
      category: o.category,
      listedAt: o.listedAt,
      lastModifiedAt: o.lastModifiedAt,
      firstSeenAt: o.firstSeenAt,
      daysOnMarket: referenceDate ? daysBetween(referenceDate, today) : null,
      dataSource: o.listedAt ? "asari" : "our-first-seen",
    };
  })
  .sort((a, b) => (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0));

// === Velocity / inventory aging ===
const velocityBuckets = VELOCITY_BUCKETS.map((b) => ({
  ...b,
  count: timeOnMarket.filter((t) => t.daysOnMarket != null && t.daysOnMarket >= b.min && t.daysOnMarket <= b.max).length,
}));

// Średni czas-do-zniknięcia (z eventów: offer_removed mają daysOnMarket)
const removedEvents = events.filter((e) => e.type === "offer_removed" && e.daysOnMarket != null);
const velocity = {
  buckets: velocityBuckets,
  avgDaysOnMarket: timeOnMarket.length ? mean(timeOnMarket.map((t) => t.daysOnMarket).filter((d) => d != null)) : null,
  medianDaysOnMarket: timeOnMarket.length ? median(timeOnMarket.map((t) => t.daysOnMarket).filter((d) => d != null)) : null,
  avgDaysToRemoval: removedEvents.length ? mean(removedEvents.map((e) => e.daysOnMarket)) : null,
  totalRemoved: removedEvents.length,
};

// === Agent performance ===
const removedBySig = new Map(removedEvents.map((e) => [e.signature, e]));
const agentMap = new Map();
for (const o of offers) {
  const name = o.agentName?.trim() || "—";
  if (!agentMap.has(name)) {
    agentMap.set(name, { name, activeOffers: 0, totalActiveValue: 0, prices: [] });
  }
  const a = agentMap.get(name);
  a.activeOffers++;
  if (o.pricePln) {
    a.totalActiveValue += o.pricePln;
    a.prices.push(o.pricePln);
  }
}

// Agent historical: ile zniknęło ofert per agent (sprzedanych/wycofanych)
const agentHistorical = new Map();
for (const e of removedEvents) {
  // Trzeba znaleźć agentName z ostatniego snapshotu kiedy oferta istniała
  // Najprostsze: zbierz z timeline pierwsze "offer_added" event
  const timeline = timelines.get(e.signature) || [];
  const added = timeline.find((t) => t.type === "offer_added");
  const agentName = added?.agentName?.trim() || "—";
  if (!agentHistorical.has(agentName)) {
    agentHistorical.set(agentName, { removed: 0, avgDaysToRemoval: [] });
  }
  const ag = agentHistorical.get(agentName);
  ag.removed++;
  if (e.daysOnMarket != null) ag.avgDaysToRemoval.push(e.daysOnMarket);
}

const agents = Array.from(agentMap.values())
  .map((a) => {
    const hist = agentHistorical.get(a.name) || { removed: 0, avgDaysToRemoval: [] };
    return {
      name: a.name,
      activeOffers: a.activeOffers,
      avgActivePrice: mean(a.prices),
      medianActivePrice: median(a.prices),
      totalActiveValue: a.totalActiveValue,
      removedOffers: hist.removed,
      avgDaysToRemoval: hist.avgDaysToRemoval.length ? mean(hist.avgDaysToRemoval) : null,
    };
  })
  .sort((a, b) => b.activeOffers - a.activeOffers);

// === Geo: city + district ===
const geoByCity = bucketBy(sale, (o) => o.city);
const geoByDistrict = bucketBy(
  sale.filter((o) => o.district),
  (o) => `${o.district} (${o.city})`,
);

// === Recent events (30 dni) ===
// Defensive filter: nawet jeśli isBootstrap nie ma we wcześniejszych eventach
// (np. wygenerowanych przed dodaniem flagi), traktujemy zdarzenie jako "ostatnie"
// tylko gdy data efektywna (listedAt/effectiveDate) jest w ostatnich 30 dniach.
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

function effectiveDateOf(e) {
  // Priorytet: explicit effectiveDate → listedAt → date eventu
  return e.effectiveDate || e.listedAt || e.date;
}

function isLikelyBootstrap(e) {
  if (e.isBootstrap === true) return true;
  if (e.type !== "offer_added") return false;
  // Bez flagi: jeśli oferta w Asari istniała >7 dni przed zdarzeniem → bootstrap
  const listed = e.listedAt;
  if (!listed) return false;
  const gap = Math.round((Date.parse(e.date) - Date.parse(listed)) / 86_400_000);
  return gap > 7;
}

const recentEvents = events
  .filter((e) => !isLikelyBootstrap(e))
  .filter((e) => effectiveDateOf(e) >= thirtyDaysAgo)
  .sort((a, b) => effectiveDateOf(b).localeCompare(effectiveDateOf(a)))
  .slice(0, 100);

const bootstrapCount = events.filter(isLikelyBootstrap).length;

// === Benchmark vs konkurencja ===
function loadLatestCompetitorSnapshot(source) {
  const dir = path.join(COMPETITORS_DIR, source);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8"));
}

function buildBenchmark(ourOffers, competitorOffers, sourceLabel) {
  if (!competitorOffers || competitorOffers.length === 0) return null;

  // Grupowanie obu po (category, city)
  function group(offers, mapCategory) {
    const m = new Map();
    for (const o of offers) {
      const cat = mapCategory ? mapCategory(o) : o.category;
      const city = (o.city || "").toUpperCase();
      if (!cat || !city || !o.pricePln) continue;
      const k = `${cat}|${city}`;
      if (!m.has(k)) m.set(k, { category: cat, city, prices: [], pricesPerM2: [] });
      const b = m.get(k);
      b.prices.push(o.pricePln);
      if (o.pricePerM2) b.pricesPerM2.push(o.pricePerM2);
    }
    return m;
  }

  const ourGrouped = group(ourOffers);
  const compGrouped = group(competitorOffers, (o) => ESTATE_TO_CATEGORY[o.estate]);

  const comparison = [];
  for (const [key, ours] of ourGrouped) {
    const theirs = compGrouped.get(key);
    if (!theirs) continue;
    const ourMedPrice = median(ours.prices);
    const theirMedPrice = median(theirs.prices);
    const ourMedPerM2 = median(ours.pricesPerM2);
    const theirMedPerM2 = median(theirs.pricesPerM2);
    comparison.push({
      category: ours.category,
      city: ours.city,
      ourCount: ours.prices.length,
      competitorCount: theirs.prices.length,
      ourMedianPrice: ourMedPrice,
      competitorMedianPrice: theirMedPrice,
      priceDiffPct: ourMedPrice && theirMedPrice
        ? Math.round(((ourMedPrice - theirMedPrice) / theirMedPrice) * 1000) / 10
        : null,
      ourMedianPricePerM2: ourMedPerM2,
      competitorMedianPricePerM2: theirMedPerM2,
      pricePerM2DiffPct: ourMedPerM2 && theirMedPerM2
        ? Math.round(((ourMedPerM2 - theirMedPerM2) / theirMedPerM2) * 1000) / 10
        : null,
    });
  }

  return {
    source: sourceLabel,
    totalCompetitorOffers: competitorOffers.length,
    comparison: comparison.sort((a, b) => b.ourCount - a.ourCount),
  };
}

// Używamy zdedupliowanej kombinacji otodom+olx jako głównego pool-a konkurencji.
// Fallback do samego otodom gdy combined nie istnieje (przejściowe).
const combinedSnapshot =
  loadLatestCompetitorSnapshot("combined") ||
  loadLatestCompetitorSnapshot("otodom");

const benchmarkCombined = combinedSnapshot
  ? buildBenchmark(offers, combinedSnapshot.offers, "konkurencja")
  : null;

// Breakdown źródeł w combined pool
const sourceCounts = combinedSnapshot
  ? combinedSnapshot.offers.reduce((acc, o) => {
      const key = (o.sources || [o.source]).sort().join("+");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  : {};

const history = buildMonthlyHistory({
  events,
  currentOffers: offers,
  snapshots,
});

function loadAllCompetitorSnapshots(source) {
  const dir = path.join(COMPETITORS_DIR, source);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

const competitorSnapshots = loadAllCompetitorSnapshots("combined");
const competitorHistory = buildCompetitorHistory({ snapshots: competitorSnapshots });

const analytics = {
  generatedAt: new Date().toISOString(),
  kpi,
  history,
  competitorHistory,
  benchmark: {
    competitor: benchmarkCombined,
    sourceCounts,
  },
  timeSeries,
  segmentation: {
    byCategory: bucketBy(sale, (o) => o.category),
    byCity: bucketBy(sale, (o) => o.city),
    byRooms: bucketBy(sale.filter((o) => o.rooms), (o) => `${o.rooms} pok.`),
  },
  priceChanges,
  timeOnMarket: timeOnMarket.slice(0, 50),
  velocity,
  agents,
  geo: {
    byCity: geoByCity,
    byDistrict: geoByDistrict,
  },
  recentEvents,
  totalEventsLogged: events.length,
  bootstrapEvents: bootstrapCount,
};

fs.writeFileSync(path.join(ROOT, "data", "analytics.json"), JSON.stringify(analytics, null, 2) + "\n");

console.log(
  `Analytics: ${kpi.totalOffers} ofert · ${events.length} eventów history · ${agents.length} agentów · ${velocityBuckets.length} buckets velocity · ${history.months.length} okresów historii nas · ${competitorHistory.months.length} okresów historii konkurencji (${competitorHistory.totalOffers ?? 0} ofert)`,
);
