/**
 * Czytnik eksportu Asari (format EbiuroV2).
 *
 * Asari eksportuje przyrostowo: każda paczka XYZ_YYYYMMDD_HHMMSS_001.xml zawiera
 * nowe/zmienione oferty i (opcjonalnie) sekcję PACKAGE/DELETE z sygnaturami
 * wycofanymi. Aktualny stan = scalenie wszystkich paczek chronologicznie
 * minus DELETE-y.
 */
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  processEntities: { maxTotalExpansions: 500_000 },
});

const PARAM = {
  SIGNATURE: "1",
  LAST_MODIFIED: "3",       // data ostatniej modyfikacji w Asari
  LISTED_AT: "5",            // data wprowadzenia oferty do Asari (real listing date!)
  PRICE_PLN: "10",
  PRICE_PER_M2: "13",
  ROOMS_STR: "19",
  STATUS: "26",              // AKTUALNA / REZERWACJA / SPRZEDANA
  CATEGORY: "36",
  TRANSACTION: "43",
  CITY_A: "47",
  CITY_B: "48",
  AREA_USABLE: "58",
  AREA_LOT: "61",
  FLOOR: "62",
  ROOMS_NUM: "79",
  AREA_TOTAL: "128",
  DISTRICT: "300",
  AGENT_NAME: "305",
  AGENT_PHONE: "170",
  TITLE_SHORT: "491",
};

function isOfferPackageFile(name) {
  const lower = name.toLowerCase();
  if (!lower.endsWith("_001.xml")) return false;
  if (lower === "definictions.xml" || lower === "definitions.xml") return false;
  if (lower.endsWith("_cfg.xml")) return false;
  return true;
}

function timestampFromFilename(name) {
  const m = name.match(/_(\d{8})_(\d{6})_001\.xml$/i);
  if (!m) return 0;
  const [, ymd, hms] = m;
  return Number(ymd + hms);
}

function collect(nodes) {
  if (nodes == null) return [];
  return Array.isArray(nodes) ? nodes : [nodes];
}

function paramText(p) {
  const text = p["#text"];
  if (typeof text === "string") return text;
  if (typeof text === "number") return String(text);
  for (const k of Object.keys(p)) {
    if (k.startsWith("@_")) continue;
    const v = p[k];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function parametersToMap(parameters) {
  const map = new Map();
  const raw = parameters?.p;
  for (const p of collect(raw)) {
    const id = p?.["@_id"];
    if (id != null) map.set(String(id), paramText(p));
  }
  return map;
}

function num(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function isPlot(category) {
  return category.toUpperCase().includes("DZIAŁK");
}

function pickArea(pm, category) {
  const lot = num(pm.get(PARAM.AREA_LOT));
  const total = num(pm.get(PARAM.AREA_TOTAL));
  const usable = num(pm.get(PARAM.AREA_USABLE));
  if (isPlot(category)) return lot ?? total ?? null;
  return total ?? usable ?? lot ?? null;
}

function pickRooms(pm) {
  const fromNum = num(pm.get(PARAM.ROOMS_NUM));
  if (fromNum != null && fromNum > 0) return Math.round(fromNum);
  const raw = pm.get(PARAM.ROOMS_STR) ?? "";
  const m = raw.match(/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Asari używa formatu "YYYY-MM-DD HH:MM:SS.ffff" w paramach 3 i 5. */
function parseAsariDate(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  // Format Asari: 2021-10-29 11:38:18.0762
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Fallback - inne formaty
  const iso = Date.parse(t);
  if (Number.isFinite(iso)) return new Date(iso).toISOString().slice(0, 10);
  return null;
}

function rawToOffer(raw, packageDateIso) {
  const signature = String(raw?.signature ?? "").trim();
  if (!signature) return null;
  const pm = parametersToMap(raw.parameters);

  const category = (pm.get(PARAM.CATEGORY) ?? "").trim() || "Nieruchomość";
  const transaction = (pm.get(PARAM.TRANSACTION) ?? "").trim() || "Oferta";
  const city = (pm.get(PARAM.CITY_B) ?? pm.get(PARAM.CITY_A) ?? "").trim();
  const district = (pm.get(PARAM.DISTRICT) ?? "").trim();
  const titleShort = (pm.get(PARAM.TITLE_SHORT) ?? "").trim();
  const pricePln = num(pm.get(PARAM.PRICE_PLN));
  const pricePerM2Xml = num(pm.get(PARAM.PRICE_PER_M2));
  const areaM2 = pickArea(pm, category);
  const rooms = pickRooms(pm);
  const floor = num(pm.get(PARAM.FLOOR));

  const pricePerM2 =
    pricePerM2Xml ??
    (pricePln && areaM2 && areaM2 > 0 ? pricePln / areaM2 : null);

  return {
    signature,
    title: titleShort || `${category} · ${city}`,
    category,
    transaction,
    status: (pm.get(PARAM.STATUS) ?? "").trim(),
    city,
    district,
    locationLabel: [district, city].filter(Boolean).join(", "),
    pricePln,
    pricePerM2: pricePerM2 != null ? Math.round(pricePerM2) : null,
    areaM2,
    rooms,
    floor,
    agentName: (pm.get(PARAM.AGENT_NAME) ?? "").trim(),
    listedAt: parseAsariDate(pm.get(PARAM.LISTED_AT)),       // RZECZYWISTA data wprowadzenia do Asari
    lastModifiedAt: parseAsariDate(pm.get(PARAM.LAST_MODIFIED)),
    firstSeenAt: packageDateIso,                              // kiedy my pierwszy raz zobaczyliśmy
  };
}

function packageDateFromFilename(name) {
  const m = name.match(/_(\d{4})(\d{2})(\d{2})_/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Wczytuje wszystkie paczki z folderu i scala je chronologicznie.
 * Zwraca aktualną listę ofert (po DELETE), nadpisując starsze wersje świeższymi.
 */
export function loadCurrentOffers(asariDir) {
  const allFiles = fs.readdirSync(asariDir).filter(isOfferPackageFile);
  const sorted = allFiles
    .map((name) => ({ name, ts: timestampFromFilename(name) }))
    .sort((a, b) => a.ts - b.ts);

  const offers = new Map();
  const firstSeen = new Map();

  for (const { name } of sorted) {
    const filePath = path.join(asariDir, name);
    const xml = fs.readFileSync(filePath, "utf8");
    const root = parser.parse(xml);
    const pkg = root?.PACKAGE;
    if (!pkg) continue;

    const packageDate = packageDateFromFilename(name);

    const offerNodes = collect(pkg.offer);
    for (const node of offerNodes) {
      const sig = String(node?.signature ?? "").trim();
      if (!sig) continue;
      if (!firstSeen.has(sig)) firstSeen.set(sig, packageDate);
      const mapped = rawToOffer(node, firstSeen.get(sig));
      if (mapped) offers.set(sig, mapped);
    }

    const deletedRaw = pkg?.DELETE?.offers?.signature;
    for (const sigRaw of collect(deletedRaw)) {
      const sig = typeof sigRaw === "string" ? sigRaw.trim() : paramText(sigRaw).trim();
      if (sig) offers.delete(sig);
    }
  }

  return Array.from(offers.values());
}
