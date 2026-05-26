/**
 * Pobiera oferty konkurencji (otodom, OLX) dla regionu Wągrowiec/Rogoźno
 * i zapisuje data/competitors/{source}/YYYY-MM-DD.json.
 *
 * Uruchamiane raz na dobę przez GitHub Actions (osobny workflow,
 * żeby błąd scrapingu nie zablokował głównych statystyk).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOtodomSnapshot } from "../lib/competitors/otodom.mjs";
import { fetchOlxSnapshot } from "../lib/competitors/olx.mjs";
import { fetchNoSnapshot } from "../lib/competitors/nieruchomosci-online.mjs";
import { dedupeCompetitorOffers } from "../lib/competitors/dedupe.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const today = new Date().toISOString().slice(0, 10);

async function save(source, offers) {
  const dir = path.join(ROOT, "data", "competitors", source);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${today}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      { source, date: today, generatedAt: new Date().toISOString(), offerCount: offers.length, offers },
      null,
      2,
    ) + "\n",
  );
  console.log(`[${source}] ${offers.length} ofert → ${path.relative(ROOT, out)}`);
}

async function main() {
  const cities = (process.env.COMPETITOR_CITIES || "wagrowiec,rogozno")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Pobieram konkurencję dla: ${cities.join(", ")}`);

  let otodom = [];
  let olx = [];
  let no = [];

  try {
    otodom = await fetchOtodomSnapshot({ cities });
    await save("otodom", otodom);
  } catch (err) {
    console.error("[otodom] Błąd:", err.message);
  }

  try {
    olx = await fetchOlxSnapshot({ cities });
    await save("olx", olx);
  } catch (err) {
    console.error("[olx] Błąd:", err.message);
  }

  try {
    no = await fetchNoSnapshot({ cities });
    await save("nieruchomosci-online", no);
  } catch (err) {
    console.error("[NO] Błąd:", err.message);
  }

  // Deduplikacja: scal otodom + olx + NO w jedną unikalną listę
  if (otodom.length > 0 || olx.length > 0 || no.length > 0) {
    const { unique, stats } = dedupeCompetitorOffers({ otodom, olx, no });
    await save("combined", unique);
    console.log("[dedupe]", JSON.stringify(stats, null, 2));
  }
}

main().catch((err) => {
  console.error("[fetch-competitors] Błąd:", err.message);
  process.exit(1);
});
