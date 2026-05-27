/**
 * Wzbogaca oferty Nieruchomosci-Online o agencyName (biuro nieruchomosci).
 *
 * NO ukrywa biuro w listingu. Sciezka:
 *   1. detail page oferty -> URL agenta (np. /agenci/marta-janusz)
 *   2. profile agenta -> tytul "Profesjonalny Agent biura: {BIURO} w {MIASTO}"
 *
 * Optymalizacja przez 2-poziomowy cache:
 *   data/no-cache/offers.json  - per externalId: agentSlug + agencyName (TTL 30 dni)
 *   data/no-cache/agents.json  - per agentSlug: agencyName (TTL 90 dni)
 *
 * Pierwszy run dla ~600 ofert: ~50 min (5s delay). Kolejne (weekly): tylko diff = kilka min.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "data", "no-cache");
const COMPETITORS_DIR = path.join(ROOT, "data", "competitors", "nieruchomosci-online");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OFFER_TTL_DAYS = 30;
const AGENT_TTL_DAYS = 90;
const DELAY_MS = 5000;
const JITTER_MS = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitterDelay() {
  return DELAY_MS + Math.floor(Math.random() * JITTER_MS);
}

function nowIso() {
  return new Date().toISOString();
}

function ageDays(iso) {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / 86_400_000;
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "pl-PL,pl;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function loadCache(filename) {
  const p = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(filename, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, filename), JSON.stringify(data, null, 2) + "\n");
}

// Wyciaga agent-slug z detail page oferty NO.
// Format: <a class="name" href="https://www.nieruchomosci-online.pl/agenci/{slug}">
function extractAgentSlug(html) {
  const m = html.match(/href="https:\/\/www\.nieruchomosci-online\.pl\/agenci\/([a-z0-9-]+)"/);
  return m ? m[1] : null;
}

// Wyciaga nazwe biura z tytulu strony profilu agenta NO.
// Format: <title>{Agent} - Profesjonalny Agent biura nieruchomosci: {BIURO} w {MIASTO}</title>
function extractAgencyFromAgentTitle(html) {
  const m = html.match(/<title>[^<]*biura nieruchomości:\s*([^<]+?)\s+w\s+[^<]+<\/title>/i);
  return m ? m[1].trim() : null;
}

async function getAgencyForOffer(externalId, hrefOriginal, offersCache, agentsCache) {
  const cached = offersCache[externalId];
  if (cached && ageDays(cached.fetchedAt) < OFFER_TTL_DAYS) {
    return { agencyName: cached.agencyName, agentSlug: cached.agentSlug, cached: true };
  }

  let html;
  try {
    html = await fetchHtml(hrefOriginal);
  } catch (err) {
    console.warn(`[no-detail] ${externalId} fail: ${err.message}`);
    offersCache[externalId] = { agentSlug: null, agencyName: null, fetchedAt: nowIso(), error: err.message };
    return { agencyName: null, agentSlug: null, cached: false };
  }

  const agentSlug = extractAgentSlug(html);
  if (!agentSlug) {
    // Brak linka do /agenci/ w detail page = oferta prywatna (tylko imie sprzedajacego,
    // brak biura). Sprawdzilismy probkami i to konsekwentnie sa oferty od wlascicieli.
    offersCache[externalId] = { agentSlug: null, agencyName: null, isPrivate: true, fetchedAt: nowIso(), reason: "no-agent-link" };
    return { agencyName: null, agentSlug: null, isPrivate: true, cached: false };
  }

  // Sprawdz cache agentow zanim fetch
  let agencyName = null;
  const agentCached = agentsCache[agentSlug];
  if (agentCached && ageDays(agentCached.fetchedAt) < AGENT_TTL_DAYS) {
    agencyName = agentCached.agencyName;
  } else {
    await sleep(jitterDelay());
    try {
      const agentHtml = await fetchHtml(`https://www.nieruchomosci-online.pl/agenci/${agentSlug}`);
      agencyName = extractAgencyFromAgentTitle(agentHtml);
      agentsCache[agentSlug] = { agencyName, fetchedAt: nowIso() };
    } catch (err) {
      console.warn(`[no-detail] agent ${agentSlug} fail: ${err.message}`);
      agentsCache[agentSlug] = { agencyName: null, fetchedAt: nowIso(), error: err.message };
    }
  }

  offersCache[externalId] = { agentSlug, agencyName, fetchedAt: nowIso() };
  return { agencyName, agentSlug, cached: false };
}

async function main() {
  // Wczytaj najnowszy NO snapshot
  if (!fs.existsSync(COMPETITORS_DIR)) {
    console.error("Brak NO snapshots - uruchom najpierw fetch-competitors.mjs");
    process.exit(1);
  }
  const files = fs.readdirSync(COMPETITORS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (files.length === 0) {
    console.error("Brak plikow NO");
    process.exit(1);
  }
  const latestFile = files[files.length - 1];
  const snapshot = JSON.parse(fs.readFileSync(path.join(COMPETITORS_DIR, latestFile), "utf8"));
  console.log(`Wzbogacam ${snapshot.offers.length} ofert z ${latestFile}`);

  const offersCache = loadCache("offers.json");
  const agentsCache = loadCache("agents.json");
  const cacheStartSize = Object.keys(offersCache).length;

  let stats = { cached: 0, fetched: 0, fails: 0, withAgency: 0 };

  const limit = process.env.MAX_OFFERS ? parseInt(process.env.MAX_OFFERS) : snapshot.offers.length;
  for (let i = 0; i < Math.min(limit, snapshot.offers.length); i++) {
    const o = snapshot.offers[i];
    if (!o.externalId || !o.href) continue;

    const result = await getAgencyForOffer(o.externalId, o.href, offersCache, agentsCache);
    if (result.cached) stats.cached++;
    else stats.fetched++;
    if (result.agencyName) stats.withAgency++;
    else if (!result.agentSlug) stats.fails++;

    // Wzbogac obiekt w snapshocie
    if (result.agencyName) {
      o.agencyName = result.agencyName;
    }
    if (result.isPrivate) {
      o.isPrivate = true;
    }

    // Progress co 50
    if ((i + 1) % 50 === 0) {
      console.log(`  [${i + 1}/${snapshot.offers.length}] cache:${stats.cached} fetch:${stats.fetched} agency:${stats.withAgency}`);
      // Auto-save co 50 zeby nie tracic postepu jak skrypt padnie
      saveCache("offers.json", offersCache);
      saveCache("agents.json", agentsCache);
    }

    // Sleep tylko gdy faktycznie zrobilismy fetch (cached -> 0 delay)
    if (!result.cached) await sleep(jitterDelay());
  }

  // Final save
  saveCache("offers.json", offersCache);
  saveCache("agents.json", agentsCache);

  // Zapisz wzbogacony snapshot
  fs.writeFileSync(path.join(COMPETITORS_DIR, latestFile), JSON.stringify(snapshot, null, 2) + "\n");

  console.log(`\nDONE. Cache: ${cacheStartSize} -> ${Object.keys(offersCache).length} ofert, ${Object.keys(agentsCache).length} agentow.`);
  console.log(`Statystyki: cache hit=${stats.cached}, fetched=${stats.fetched}, with agency=${stats.withAgency}, fails=${stats.fails}`);

  // Przebuduj combined - bez tego analytics nie widzi nowych agencyName w NO
  console.log("\nPrzebudowywanie combined snapshot...");
  const { dedupeCompetitorOffers } = await import("../lib/competitors/dedupe.mjs");
  const otodomDir = path.join(ROOT, "data", "competitors", "otodom");
  const olxDir = path.join(ROOT, "data", "competitors", "olx");
  function loadLatest(dir) {
    if (!fs.existsSync(dir)) return [];
    const fs2 = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    if (fs2.length === 0) return [];
    return JSON.parse(fs.readFileSync(path.join(dir, fs2[fs2.length - 1]), "utf8")).offers || [];
  }
  const otodom = loadLatest(otodomDir);
  const olx = loadLatest(olxDir);
  const { unique, stats: dedupeStats } = dedupeCompetitorOffers({ otodom, olx, no: snapshot.offers });
  const combinedDir = path.join(ROOT, "data", "competitors", "combined");
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(combinedDir, `${today}.json`),
    JSON.stringify({ source: "combined", date: today, generatedAt: nowIso(), offerCount: unique.length, offers: unique }, null, 2) + "\n",
  );
  console.log("Combined zaktualizowany:", JSON.stringify(dedupeStats));
}

main().catch((err) => {
  console.error("[fetch-no-detail] Blad:", err.message);
  process.exit(1);
});
