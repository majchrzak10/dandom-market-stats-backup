/**
 * Generuje dist/index.html — dashboard z zakładkami:
 *  1. 📊 Nasze oferty (KPI, velocity, eventy, top miejscowości)
 *  2. 🌍 Rynek i konkurencja (benchmark vs otodom)
 * Mobile-friendly: tabele zmieniają się w karty na małych ekranach.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const analytics = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "analytics.json"), "utf8"),
);

const distDir = path.join(ROOT, "dist");
fs.mkdirSync(distDir, { recursive: true });

const showAgents = analytics.agents && analytics.agents.length > 1;

const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Statystyki — Dan-Dom</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .kpi-card { transition: transform 0.15s; }
  .kpi-card:hover { transform: translateY(-2px); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
  .badge-added { background: #dcfce7; color: #166534; }
  .badge-removed { background: #fee2e2; color: #991b1b; }
  .badge-price-up { background: #fef3c7; color: #92400e; }
  .badge-price-down { background: #dbeafe; color: #1e40af; }
  .tab-btn { padding: 12px 20px; border-bottom: 3px solid transparent; cursor: pointer; font-weight: 500; color: #57534e; transition: all 0.15s; }
  .tab-btn:hover { color: #1c1917; }
  .tab-btn.active { color: #800020; border-bottom-color: #800020; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  /* Mobile-friendly cards */
  @media (max-width: 640px) {
    .responsive-table thead { display: none; }
    .responsive-table tr { display: block; padding: 12px; border: 1px solid #e7e5e4; border-radius: 12px; margin-bottom: 8px; background: white; }
    .responsive-table td { display: block; padding: 4px 0; text-align: left !important; }
    .responsive-table td::before { content: attr(data-label) ": "; font-weight: 600; color: #78716c; font-size: 0.75rem; text-transform: uppercase; display: inline; margin-right: 6px; }
    .responsive-table td:first-child { font-weight: 600; font-size: 1rem; margin-bottom: 4px; }
    .responsive-table td:first-child::before { display: none; }
  }
</style>
</head>
<body class="bg-stone-50 text-stone-900">
<div class="max-w-7xl mx-auto p-4 md:p-8">

  <header class="mb-6">
    <h1 class="text-2xl md:text-4xl font-bold tracking-tight">Statystyki Dan-Dom</h1>
    <p class="text-stone-500 text-sm mt-1">
      Aktualizacja: <span id="updated"></span>
    </p>
  </header>

  <nav class="border-b border-stone-200 mb-8 flex gap-2 overflow-x-auto">
    <button class="tab-btn active" data-tab="my-offers">📊 Nasze oferty</button>
    <button class="tab-btn" data-tab="market">🌍 Rynek i konkurencja</button>
    <button class="tab-btn" data-tab="history">📈 Historia</button>
  </nav>

  <!-- ============ TAB 1: NASZE OFERTY ============ -->
  <div class="tab-panel active" id="tab-my-offers">

    <section class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8" id="kpi-cards"></section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-3">Oferty w czasie</h2>
        <canvas id="time-series-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Ile czasu wiszą oferty</h2>
        <p class="text-xs text-stone-500 mb-3">Liczone od rzeczywistej daty wprowadzenia w Asari.</p>
        <canvas id="velocity-chart"></canvas>
        <p class="mt-3 text-sm text-stone-600" id="velocity-summary"></p>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-3">Kategorie</h2>
        <canvas id="category-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5 lg:col-span-2">
        <h2 class="text-base font-semibold mb-3">Miejscowości (sprzedaż)</h2>
        <canvas id="city-chart"></canvas>
      </div>
    </section>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-8">
      <h2 class="text-base font-semibold mb-3">Najdłużej na rynku (top 15)</h2>
      <p class="text-xs text-stone-500 mb-3">Czerwone = ponad rok. Pomarańczowe = ponad pół roku.</p>
      <table class="w-full text-sm responsive-table">
        <thead class="text-stone-500 text-left border-b border-stone-200">
          <tr>
            <th class="pb-2">Oferta</th>
            <th class="pb-2">Lokalizacja</th>
            <th class="pb-2">Wprowadzona</th>
            <th class="pb-2 text-right">Cena</th>
            <th class="pb-2 text-right">Dni</th>
          </tr>
        </thead>
        <tbody id="tom-table"></tbody>
      </table>
    </section>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-8">
      <h2 class="text-base font-semibold mb-3">Ostatnie zmiany (30 dni)</h2>
      <div id="recent-events" class="text-stone-500 text-sm">Pojawi się gdy coś się zmieni w bazie.</div>
    </section>

    ${
      showAgents
        ? `<section class="bg-white rounded-2xl shadow-sm p-5 mb-8">
      <h2 class="text-base font-semibold mb-3">Agenci</h2>
      <table class="w-full text-sm responsive-table">
        <thead class="text-stone-500 text-left border-b border-stone-200">
          <tr>
            <th class="pb-2">Agent</th>
            <th class="pb-2 text-right">Aktywne</th>
            <th class="pb-2 text-right">Wartość portfela</th>
            <th class="pb-2 text-right">Średnia cena</th>
            <th class="pb-2 text-right">Zniknęło</th>
          </tr>
        </thead>
        <tbody id="agents-table"></tbody>
      </table>
    </section>`
        : ""
    }

  </div>

  <!-- ============ TAB 2: RYNEK I KONKURENCJA ============ -->
  <div class="tab-panel" id="tab-market">

    <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8" id="market-kpi"></section>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-8">
      <h2 class="text-base font-semibold mb-1">Benchmark: my vs konkurencja</h2>
      <p class="text-xs text-stone-500 mb-1" id="benchmark-sources"></p>
      <p class="text-xs text-stone-500 mb-3">
        Niebieskie = nasze ceny niższe niż rynek · Pomarańczowe = wyższe. Porównujemy tylko wspólne kategorie/miasta.
      </p>
      <div id="benchmark-content" class="text-stone-500 text-sm">Dane konkurencji jeszcze się ładują.</div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-3">Ilość ofert: my vs konkurencja</h2>
        <canvas id="market-share-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-3">Średnia cena/m² — nasze vs rynek</h2>
        <canvas id="price-comparison-chart"></canvas>
      </div>
    </section>

  </div>

  <!-- ============ TAB 3: HISTORIA ============ -->
  <div class="tab-panel" id="tab-history">

    <div class="bg-stone-50 border border-stone-200 rounded-xl p-4 mb-6 text-sm text-stone-600">
      Tracking zaczął się <span id="tracking-start" class="font-semibold"></span>.
      Wykresy pokazują stan portfela na koniec każdego miesiąca — z każdym kolejnym miesiącem historia rośnie.
    </div>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Liczba aktywnych ofert</h2>
        <p class="text-xs text-stone-500 mb-3">Łącznie + breakdown per kategoria.</p>
        <canvas id="hist-count-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Miks kategorii w czasie</h2>
        <p class="text-xs text-stone-500 mb-3">Udział % typów nieruchomości w portfelu.</p>
        <canvas id="hist-category-mix-chart"></canvas>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Mediana ceny (sprzedaż)</h2>
        <p class="text-xs text-stone-500 mb-3">Aktualna cena ofert aktywnych w danym miesiącu. Mediana zwykle stabilniejsza niż średnia.</p>
        <canvas id="hist-price-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Mediana zł/m² (sprzedaż)</h2>
        <p class="text-xs text-stone-500 mb-3">Lepszy wskaźnik trendu cenowego niż sama cena.</p>
        <canvas id="hist-pricepm2-chart"></canvas>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Średni czas na rynku</h2>
        <p class="text-xs text-stone-500 mb-3">Dni od daty wprowadzenia (param 5 Asari) do końca miesiąca.</p>
        <canvas id="hist-days-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Top 5 miejscowości</h2>
        <p class="text-xs text-stone-500 mb-3">Liczba ofert w największych miastach miesiąc po miesiącu.</p>
        <canvas id="hist-cities-chart"></canvas>
      </div>
    </section>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-8">
      <h2 class="text-base font-semibold mb-3">Tabela miesięczna — nasze</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-stone-500 text-left border-b border-stone-200">
            <tr>
              <th class="pb-2">Miesiąc</th>
              <th class="pb-2 text-right">Aktywnych</th>
              <th class="pb-2 text-right">DOM</th>
              <th class="pb-2 text-right">MIESZKANIE</th>
              <th class="pb-2 text-right">DZIAŁKA</th>
              <th class="pb-2 text-right">Mediana ceny</th>
              <th class="pb-2 text-right">Mediana zł/m²</th>
              <th class="pb-2 text-right">Śr. dni</th>
            </tr>
          </thead>
          <tbody id="hist-table"></tbody>
        </table>
      </div>
    </section>

    <!-- === Historia konkurencji === -->
    <div class="border-t border-stone-200 pt-8 mb-6">
      <h2 class="text-xl font-bold mb-1">🌍 Rynek i konkurencja — historia (Otodom + OLX)</h2>
      <p class="text-sm text-stone-500 mb-4">Te same metryki dla ofert konkurencji w Wągrowcu i Rogoźnie. Listed = data utworzenia oferty na portalu (dateCreated).</p>
    </div>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Liczba aktywnych ofert konkurencji</h2>
        <p class="text-xs text-stone-500 mb-3">Łącznie + breakdown per kategoria.</p>
        <canvas id="chist-count-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Miks kategorii konkurencji w czasie</h2>
        <canvas id="chist-category-mix-chart"></canvas>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Mediana ceny — my vs konkurencja</h2>
        <p class="text-xs text-stone-500 mb-3">Bezpośrednie porównanie miesiąc po miesiącu.</p>
        <canvas id="chist-price-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Mediana zł/m² — my vs konkurencja</h2>
        <canvas id="chist-pricepm2-chart"></canvas>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Średni czas na rynku — my vs konkurencja</h2>
        <canvas id="chist-days-chart"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Top 5 miejscowości konkurencji</h2>
        <canvas id="chist-cities-chart"></canvas>
      </div>
    </section>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-8">
      <h2 class="text-base font-semibold mb-3">Tabela miesięczna — konkurencja</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-stone-500 text-left border-b border-stone-200">
            <tr>
              <th class="pb-2">Miesiąc</th>
              <th class="pb-2 text-right">Aktywnych</th>
              <th class="pb-2 text-right">DOM</th>
              <th class="pb-2 text-right">MIESZKANIE</th>
              <th class="pb-2 text-right">DZIAŁKA</th>
              <th class="pb-2 text-right">Mediana ceny</th>
              <th class="pb-2 text-right">Mediana zł/m²</th>
              <th class="pb-2 text-right">Śr. dni</th>
            </tr>
          </thead>
          <tbody id="chist-table"></tbody>
        </table>
      </div>
    </section>

  </div>
</div>

<script>
const A = ${JSON.stringify(analytics, null, 2)};

document.getElementById("updated").textContent = new Date(A.generatedAt).toLocaleString("pl-PL");

const fmtPLN = (n) => n == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(n) + " zł";
const fmtNum = (n) => n == null ? "—" : new Intl.NumberFormat("pl-PL").format(n);

// === TABS ===
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// === KPI: Nasze oferty ===
const kpiData = [
  { label: "Aktywnych ofert", value: A.kpi.totalOffers },
  { label: "Wartość portfela", value: fmtPLN(A.agents.reduce((sum, a) => sum + (a.totalActiveValue || 0), 0)) },
  { label: "Mediana ceny", value: fmtPLN(A.kpi.medianPrice) },
  { label: "Średnia cena/m²", value: fmtPLN(A.kpi.avgPricePerM2) },
  { label: "Śr. czas na rynku", value: A.velocity.avgDaysOnMarket != null ? A.velocity.avgDaysOnMarket + " dni" : "—" },
];
document.getElementById("kpi-cards").innerHTML = kpiData.map(k => \`
  <div class="kpi-card bg-white rounded-2xl shadow-sm p-4">
    <div class="text-[10px] uppercase tracking-wider text-stone-500 font-medium">\${k.label}</div>
    <div class="text-xl md:text-2xl font-bold mt-1">\${k.value}</div>
  </div>
\`).join("");

// === Charts: Nasze oferty ===
new Chart(document.getElementById("time-series-chart"), {
  type: "line",
  data: {
    labels: A.timeSeries.map(t => t.date),
    datasets: [{ label: "Aktywne", data: A.timeSeries.map(t => t.total), borderColor: "#800020", backgroundColor: "rgba(128,0,32,0.1)", tension: 0.3, fill: true }],
  },
  options: { responsive: true, plugins: { legend: { display: false } } },
});

new Chart(document.getElementById("velocity-chart"), {
  type: "bar",
  data: {
    labels: A.velocity.buckets.map(b => b.label),
    datasets: [{ data: A.velocity.buckets.map(b => b.count), backgroundColor: ["#22c55e", "#84cc16", "#eab308", "#f97316", "#dc2626"] }],
  },
  options: { plugins: { legend: { display: false } }, indexAxis: "y" },
});

document.getElementById("velocity-summary").innerHTML = \`
  Średnia: <b>\${A.velocity.avgDaysOnMarket ?? "—"}</b> dni · Mediana: <b>\${A.velocity.medianDaysOnMarket ?? "—"}</b> dni
\`;

const catEntries = Object.entries(A.kpi.byCategory);
new Chart(document.getElementById("category-chart"), {
  type: "doughnut",
  data: {
    labels: catEntries.map(([k]) => k),
    datasets: [{ data: catEntries.map(([, v]) => v), backgroundColor: ["#800020", "#b8860b", "#5d7e3f", "#4a6fa5", "#8c4a6a"] }],
  },
  options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } },
});

new Chart(document.getElementById("city-chart"), {
  type: "bar",
  data: {
    labels: A.segmentation.byCity.slice(0, 10).map(b => b.key),
    datasets: [{ label: "Oferty", data: A.segmentation.byCity.slice(0, 10).map(b => b.count), backgroundColor: "#800020" }],
  },
  options: { indexAxis: "y", plugins: { legend: { display: false } } },
});

// === Tabele: Nasze oferty ===
document.getElementById("tom-table").innerHTML = A.timeOnMarket.slice(0, 15).map(t => {
  const days = t.daysOnMarket;
  const cls = days > 365 ? "text-red-700" : days > 180 ? "text-amber-600" : "text-stone-900";
  return \`
    <tr class="border-b border-stone-100 last:border-0">
      <td class="py-2 max-w-md truncate" data-label="Oferta">\${t.title}</td>
      <td class="py-2 text-stone-600" data-label="Lokalizacja">\${t.city}</td>
      <td class="py-2 text-stone-500 text-xs" data-label="Wprowadzona">\${t.listedAt ?? t.firstSeenAt ?? "—"}</td>
      <td class="py-2 text-right" data-label="Cena">\${fmtPLN(t.pricePln)}</td>
      <td class="py-2 text-right font-semibold \${cls}" data-label="Dni na rynku">\${days ?? "—"}</td>
    </tr>
  \`;
}).join("");

const eventTypeMap = {
  offer_added: { label: "Nowa", badge: "badge-added" },
  offer_removed: { label: "Zniknęła", badge: "badge-removed" },
  price_changed: { label: "Cena", badge: "" },
  area_changed: { label: "Metraż", badge: "" },
  rooms_changed: { label: "Pokoje", badge: "" },
  agent_changed: { label: "Agent", badge: "" },
  title_changed: { label: "Tytuł", badge: "" },
};

if (A.recentEvents && A.recentEvents.length > 0) {
  document.getElementById("recent-events").innerHTML = \`
    <table class="w-full text-sm responsive-table">
      <thead class="text-stone-500 text-left border-b border-stone-200">
        <tr><th class="pb-2">Data</th><th class="pb-2">Typ</th><th class="pb-2">Oferta</th><th class="pb-2">Miasto</th><th class="pb-2 text-right">Szczegóły</th></tr>
      </thead>
      <tbody>
        \${A.recentEvents.slice(0, 30).map(e => {
          const meta = eventTypeMap[e.type] || { label: e.type, badge: "" };
          const displayDate = e.effectiveDate || e.date;
          let detail = "";
          if (e.type === "price_changed") {
            const dir = e.diff < 0 ? "badge-price-down" : "badge-price-up";
            detail = \`<span class="badge \${dir}">\${e.diffPct > 0 ? "+" : ""}\${e.diffPct}%</span> \${fmtPLN(e.from)} → \${fmtPLN(e.to)}\`;
          } else if (e.type === "offer_added") {
            detail = \`\${fmtPLN(e.pricePln)} · \${e.category}\`;
          } else if (e.type === "offer_removed") {
            detail = \`\${e.daysOnMarket ?? "?"} dni · \${fmtPLN(e.lastPricePln)}\`;
          } else if (e.from != null) {
            detail = \`\${e.from} → \${e.to}\`;
          }
          return \`
            <tr class="border-b border-stone-100 last:border-0">
              <td class="py-2 text-stone-500" data-label="Data">\${displayDate}</td>
              <td class="py-2" data-label="Typ"><span class="badge \${meta.badge}">\${meta.label}</span></td>
              <td class="py-2 max-w-xs truncate" data-label="Oferta">\${e.title || e.signature}</td>
              <td class="py-2" data-label="Miasto">\${e.city || "—"}</td>
              <td class="py-2 text-right text-stone-700" data-label="Szczegóły">\${detail}</td>
            </tr>
          \`;
        }).join("")}
      </tbody>
    </table>
  \`;
}

${
  showAgents
    ? `document.getElementById("agents-table").innerHTML = A.agents.map(a => \`
  <tr class="border-b border-stone-100 last:border-0">
    <td class="py-2 font-medium" data-label="Agent">\${a.name}</td>
    <td class="py-2 text-right" data-label="Aktywne">\${a.activeOffers}</td>
    <td class="py-2 text-right" data-label="Wartość">\${fmtPLN(a.totalActiveValue)}</td>
    <td class="py-2 text-right" data-label="Średnia cena">\${fmtPLN(a.avgActivePrice)}</td>
    <td class="py-2 text-right" data-label="Zniknęło">\${a.removedOffers}</td>
  </tr>
\`).join("");`
    : ""
}

// === Tab 2: Rynek ===
const bench = A.benchmark?.competitor;
if (bench) {
  const ourCount = bench.comparison.reduce((sum, c) => sum + c.ourCount, 0);
  const theirCount = bench.totalCompetitorOffers;
  const sharePct = ourCount + theirCount > 0 ? Math.round((ourCount / (ourCount + theirCount)) * 1000) / 10 : 0;
  const avgDiff = bench.comparison.filter(c => c.pricePerM2DiffPct != null).reduce((sum, c, _, arr) => sum + c.pricePerM2DiffPct / arr.length, 0);

  document.getElementById("market-kpi").innerHTML = [
    { label: "Konkurencja w regionie", value: theirCount },
    { label: "Nasze (porównywalne)", value: ourCount },
    { label: "Nasz udział", value: sharePct + "%" },
    { label: "Średnia różnica cen/m²", value: (avgDiff > 0 ? "+" : "") + avgDiff.toFixed(1) + "%" },
  ].map(k => \`
    <div class="kpi-card bg-white rounded-2xl shadow-sm p-4">
      <div class="text-[10px] uppercase tracking-wider text-stone-500 font-medium">\${k.label}</div>
      <div class="text-xl md:text-2xl font-bold mt-1">\${k.value}</div>
    </div>
  \`).join("");

  // Pokaż breakdown źródeł
  const sources = A.benchmark.sourceCounts || {};
  const srcLines = Object.entries(sources)
    .map(([k, v]) => \`\${k}: <b>\${v}</b>\`)
    .join(" · ");
  if (srcLines) {
    document.getElementById("benchmark-sources").innerHTML =
      \`Źródła: \${srcLines}. Duplikaty wykryte przez externalUrl + heurystykę miasto+powierzchnia+cena.\`;
  }

  document.getElementById("benchmark-content").innerHTML = \`
    <table class="w-full text-sm responsive-table">
      <thead class="text-stone-500 text-left border-b border-stone-200">
        <tr>
          <th class="pb-2">Kategoria</th>
          <th class="pb-2">Miasto</th>
          <th class="pb-2 text-right">Nasze</th>
          <th class="pb-2 text-right">Konkurencja</th>
          <th class="pb-2 text-right">Mediana zł/m² my</th>
          <th class="pb-2 text-right">Mediana zł/m² oni</th>
          <th class="pb-2 text-right">Różnica</th>
        </tr>
      </thead>
      <tbody>
        \${bench.comparison.map(c => {
          const diff = c.pricePerM2DiffPct;
          const cls = diff == null ? "text-stone-500" : diff < -5 ? "text-blue-700" : diff > 5 ? "text-amber-700" : "text-stone-700";
          return \`
            <tr class="border-b border-stone-100 last:border-0">
              <td class="py-2" data-label="Kategoria">\${c.category}</td>
              <td class="py-2" data-label="Miasto">\${c.city}</td>
              <td class="py-2 text-right" data-label="Nasze">\${c.ourCount}</td>
              <td class="py-2 text-right" data-label="Konkurencja">\${c.competitorCount}</td>
              <td class="py-2 text-right" data-label="Mediana zł/m² my">\${fmtPLN(c.ourMedianPricePerM2)}</td>
              <td class="py-2 text-right" data-label="Mediana zł/m² oni">\${fmtPLN(c.competitorMedianPricePerM2)}</td>
              <td class="py-2 text-right font-semibold \${cls}" data-label="Różnica">\${diff == null ? "—" : (diff > 0 ? "+" : "") + diff + "%"}</td>
            </tr>
          \`;
        }).join("")}
      </tbody>
    </table>
  \`;

  // Market share chart: per city, our vs theirs
  const byCity = {};
  for (const c of bench.comparison) {
    if (!byCity[c.city]) byCity[c.city] = { ours: 0, theirs: 0 };
    byCity[c.city].ours += c.ourCount;
    byCity[c.city].theirs += c.competitorCount;
  }
  const cities = Object.keys(byCity).slice(0, 10);
  new Chart(document.getElementById("market-share-chart"), {
    type: "bar",
    data: {
      labels: cities,
      datasets: [
        { label: "Nasze", data: cities.map(c => byCity[c].ours), backgroundColor: "#800020" },
        { label: "Konkurencja", data: cities.map(c => byCity[c].theirs), backgroundColor: "#a8a29e" },
      ],
    },
    options: { plugins: { legend: { position: "bottom" } }, responsive: true },
  });

  // Price comparison per category
  const byCat = {};
  for (const c of bench.comparison) {
    if (!c.ourMedianPricePerM2 || !c.competitorMedianPricePerM2) continue;
    if (!byCat[c.category]) byCat[c.category] = { ours: [], theirs: [] };
    byCat[c.category].ours.push(c.ourMedianPricePerM2);
    byCat[c.category].theirs.push(c.competitorMedianPricePerM2);
  }
  const cats = Object.keys(byCat);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  new Chart(document.getElementById("price-comparison-chart"), {
    type: "bar",
    data: {
      labels: cats,
      datasets: [
        { label: "Nasze", data: cats.map(c => Math.round(avg(byCat[c].ours))), backgroundColor: "#800020" },
        { label: "Otodom", data: cats.map(c => Math.round(avg(byCat[c].theirs))), backgroundColor: "#a8a29e" },
      ],
    },
    options: { plugins: { legend: { position: "bottom" } }, responsive: true },
  });
}

// === TAB 3: HISTORIA ===
const H = A.history;
if (H && H.months && H.months.length > 0) {
  document.getElementById("tracking-start").textContent = H.trackingStartDate || "—";

  const labels = H.months.map(m => m.key);

  const CAT_COLORS = {
    DOM: "#800020",
    MIESZKANIE: "#b8860b",
    "DZIAŁKA": "#5d7e3f",
    OBIEKT: "#4a6fa5",
  };

  // 1. Liczba aktywnych ofert — line z breakdown per kategoria
  const categories = Array.from(new Set(H.months.flatMap(m => Object.keys(m.byCategory))));
  const totalDataset = {
    label: "Łącznie",
    data: H.months.map(m => m.total),
    borderColor: "#1c1917",
    backgroundColor: "transparent",
    borderWidth: 2.5,
    tension: 0.25,
    fill: false,
  };
  const catDatasets = categories.map(cat => ({
    label: cat,
    data: H.months.map(m => m.byCategory[cat] || 0),
    borderColor: CAT_COLORS[cat] || "#78716c",
    backgroundColor: "transparent",
    borderWidth: 1.5,
    tension: 0.25,
    fill: false,
  }));
  new Chart(document.getElementById("hist-count-chart"), {
    type: "line",
    data: { labels, datasets: [totalDataset, ...catDatasets] },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { beginAtZero: true } },
    },
  });

  // 2. Miks kategorii — stacked area %
  new Chart(document.getElementById("hist-category-mix-chart"), {
    type: "line",
    data: {
      labels,
      datasets: categories.map(cat => ({
        label: cat,
        data: H.months.map(m => {
          const total = m.total || 1;
          return Math.round(((m.byCategory[cat] || 0) / total) * 1000) / 10;
        }),
        borderColor: CAT_COLORS[cat] || "#78716c",
        backgroundColor: (CAT_COLORS[cat] || "#78716c") + "60",
        fill: true,
        tension: 0.25,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y + "%" } },
      },
      scales: { y: { stacked: true, beginAtZero: true, max: 100, ticks: { callback: v => v + "%" } } },
    },
  });

  // 3. Mediana ceny
  new Chart(document.getElementById("hist-price-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Mediana", data: H.months.map(m => m.medianPrice), borderColor: "#800020", backgroundColor: "rgba(128,0,32,0.1)", tension: 0.25, fill: true, borderWidth: 2 },
        { label: "Średnia", data: H.months.map(m => m.avgPrice), borderColor: "#a8a29e", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 1.5, borderDash: [4, 4] },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + fmtPLN(ctx.parsed.y) } },
      },
      scales: { y: { ticks: { callback: v => fmtPLN(v) } } },
    },
  });

  // 4. Mediana zł/m²
  new Chart(document.getElementById("hist-pricepm2-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Mediana zł/m²", data: H.months.map(m => m.medianPricePerM2), borderColor: "#5d7e3f", backgroundColor: "rgba(93,126,63,0.15)", tension: 0.25, fill: true, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => fmtPLN(ctx.parsed.y) + "/m²" } },
      },
      scales: { y: { ticks: { callback: v => fmtPLN(v) } } },
    },
  });

  // 5. Średni czas na rynku
  new Chart(document.getElementById("hist-days-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Średnia", data: H.months.map(m => m.avgDaysOnMarket), borderColor: "#b8860b", backgroundColor: "rgba(184,134,11,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
        { label: "Mediana", data: H.months.map(m => m.medianDaysOnMarket), borderColor: "#78716c", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 1.5, borderDash: [4, 4] },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y + " dni" } },
      },
      scales: { y: { beginAtZero: true, ticks: { callback: v => v + " dni" } } },
    },
  });

  // 6. Top miasta — multiline (top N w ostatnim miesiącu)
  const lastMonth = H.months[H.months.length - 1];
  const topCityNames = lastMonth.topCities.map(c => c.city);
  const cityColors = ["#800020", "#b8860b", "#5d7e3f", "#4a6fa5", "#8c4a6a"];
  new Chart(document.getElementById("hist-cities-chart"), {
    type: "line",
    data: {
      labels,
      datasets: topCityNames.map((city, i) => ({
        label: city,
        data: H.months.map(m => {
          const found = m.topCities.find(c => c.city === city);
          return found ? found.count : 0;
        }),
        borderColor: cityColors[i % cityColors.length],
        backgroundColor: "transparent",
        tension: 0.25,
        fill: false,
        borderWidth: 1.8,
      })),
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { beginAtZero: true } },
    },
  });

  // === HISTORIA KONKURENCJI ===
  const CH = A.competitorHistory;
  if (CH && CH.months && CH.months.length > 0) {
    const cLabels = CH.months.map(m => m.key);
    const cCategories = Array.from(new Set(CH.months.flatMap(m => Object.keys(m.byCategory))));

    // 1. Liczba ofert konkurencji + breakdown
    const cTotalDataset = {
      label: "Łącznie (konkurencja)",
      data: CH.months.map(m => m.total),
      borderColor: "#1c1917",
      backgroundColor: "transparent",
      borderWidth: 2.5,
      tension: 0.25,
      fill: false,
    };
    const cCatDatasets = cCategories.map(cat => ({
      label: cat,
      data: CH.months.map(m => m.byCategory[cat] || 0),
      borderColor: CAT_COLORS[cat] || "#78716c",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      tension: 0.25,
      fill: false,
    }));
    new Chart(document.getElementById("chist-count-chart"), {
      type: "line",
      data: { labels: cLabels, datasets: [cTotalDataset, ...cCatDatasets] },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { beginAtZero: true } },
      },
    });

    // 2. Miks kategorii %
    new Chart(document.getElementById("chist-category-mix-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: cCategories.map(cat => ({
          label: cat,
          data: CH.months.map(m => {
            const total = m.total || 1;
            return Math.round(((m.byCategory[cat] || 0) / total) * 1000) / 10;
          }),
          borderColor: CAT_COLORS[cat] || "#78716c",
          backgroundColor: (CAT_COLORS[cat] || "#78716c") + "60",
          fill: true,
          tension: 0.25,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y + "%" } },
        },
        scales: { y: { stacked: true, beginAtZero: true, max: 100, ticks: { callback: v => v + "%" } } },
      },
    });

    // Helper: dopasuj nasze miesiące do miesięcy konkurencji (po kluczu)
    const ourByKey = new Map(H.months.map(m => [m.key, m]));
    const ourSeries = (field) => cLabels.map(k => ourByKey.get(k)?.[field] ?? null);

    // 3. Mediana ceny — my vs konkurencja
    new Chart(document.getElementById("chist-price-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: [
          { label: "Nasze (mediana)", data: ourSeries("medianPrice"), borderColor: "#800020", backgroundColor: "rgba(128,0,32,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
          { label: "Konkurencja (mediana)", data: CH.months.map(m => m.medianPrice), borderColor: "#4a6fa5", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + fmtPLN(ctx.parsed.y) } },
        },
        scales: { y: { ticks: { callback: v => fmtPLN(v) } } },
      },
    });

    // 4. Mediana zł/m² — my vs konkurencja
    new Chart(document.getElementById("chist-pricepm2-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: [
          { label: "Nasze (zł/m²)", data: ourSeries("medianPricePerM2"), borderColor: "#5d7e3f", backgroundColor: "rgba(93,126,63,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
          { label: "Konkurencja (zł/m²)", data: CH.months.map(m => m.medianPricePerM2), borderColor: "#4a6fa5", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + fmtPLN(ctx.parsed.y) + "/m²" } },
        },
        scales: { y: { ticks: { callback: v => fmtPLN(v) } } },
      },
    });

    // 5. Średni czas na rynku — my vs konkurencja
    new Chart(document.getElementById("chist-days-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: [
          { label: "Nasze (śr.)", data: ourSeries("avgDaysOnMarket"), borderColor: "#b8860b", backgroundColor: "rgba(184,134,11,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
          { label: "Konkurencja (śr.)", data: CH.months.map(m => m.avgDaysOnMarket), borderColor: "#4a6fa5", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y + " dni" } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: v => v + " dni" } } },
      },
    });

    // 6. Top 5 miast konkurencji
    const cLastMonth = CH.months[CH.months.length - 1];
    const cTopCityNames = cLastMonth.topCities.map(c => c.city);
    const cityColors = ["#4a6fa5", "#800020", "#b8860b", "#5d7e3f", "#8c4a6a"];
    new Chart(document.getElementById("chist-cities-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: cTopCityNames.map((city, i) => ({
          label: city,
          data: CH.months.map(m => {
            const found = m.topCities.find(c => c.city === city);
            return found ? found.count : 0;
          }),
          borderColor: cityColors[i % cityColors.length],
          backgroundColor: "transparent",
          tension: 0.25,
          fill: false,
          borderWidth: 1.8,
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { beginAtZero: true } },
      },
    });

    // Tabela konkurencji
    document.getElementById("chist-table").innerHTML = CH.months.slice().reverse().map(m => \`
      <tr class="border-b border-stone-100 last:border-0">
        <td class="py-2 font-medium">\${m.key}</td>
        <td class="py-2 text-right font-semibold">\${m.total}</td>
        <td class="py-2 text-right">\${m.byCategory.DOM || 0}</td>
        <td class="py-2 text-right">\${m.byCategory.MIESZKANIE || 0}</td>
        <td class="py-2 text-right">\${m.byCategory["DZIAŁKA"] || 0}</td>
        <td class="py-2 text-right">\${fmtPLN(m.medianPrice)}</td>
        <td class="py-2 text-right">\${fmtPLN(m.medianPricePerM2)}</td>
        <td class="py-2 text-right">\${m.avgDaysOnMarket ?? "—"}</td>
      </tr>
    \`).join("");
  }

  // Tabela
  document.getElementById("hist-table").innerHTML = H.months.slice().reverse().map(m => \`
    <tr class="border-b border-stone-100 last:border-0">
      <td class="py-2 font-medium">\${m.key}</td>
      <td class="py-2 text-right font-semibold">\${m.total}</td>
      <td class="py-2 text-right">\${m.byCategory.DOM || 0}</td>
      <td class="py-2 text-right">\${m.byCategory.MIESZKANIE || 0}</td>
      <td class="py-2 text-right">\${m.byCategory["DZIAŁKA"] || 0}</td>
      <td class="py-2 text-right">\${fmtPLN(m.medianPrice)}</td>
      <td class="py-2 text-right">\${fmtPLN(m.medianPricePerM2)}</td>
      <td class="py-2 text-right">\${m.avgDaysOnMarket ?? "—"}</td>
    </tr>
  \`).join("");
}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(distDir, "index.html"), html);
console.log(`Dashboard → dist/index.html (${(html.length / 1024).toFixed(1)} KB)`);
