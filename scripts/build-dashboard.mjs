/**
 * Generuje dist/index.html — self-contained dashboard z osadzonym analytics.json.
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

const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Statystyki ofert — Dan-Dom</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .kpi-card { transition: transform 0.15s; }
  .kpi-card:hover { transform: translateY(-2px); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
  .badge-added { background: #dcfce7; color: #166534; }
  .badge-removed { background: #fee2e2; color: #991b1b; }
  .badge-price-up { background: #fef3c7; color: #92400e; }
  .badge-price-down { background: #dbeafe; color: #1e40af; }
</style>
</head>
<body class="bg-stone-50 text-stone-900">
<div class="max-w-7xl mx-auto p-6 md:p-10">
  <header class="mb-8">
    <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Statystyki ofert Dan-Dom</h1>
    <p class="text-stone-600 mt-2">
      Aktualizacja: <span id="updated"></span> · <span id="events-total" class="text-stone-500"></span>
    </p>
  </header>

  <section class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10" id="kpi-cards"></section>

  <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
    <div class="bg-white rounded-2xl shadow-sm p-6">
      <h2 class="text-lg font-semibold mb-4">Oferty w czasie</h2>
      <canvas id="time-series-chart"></canvas>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-6">
      <h2 class="text-lg font-semibold mb-4">Podział wg kategorii</h2>
      <canvas id="category-chart"></canvas>
    </div>
  </section>

  <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
    <div class="bg-white rounded-2xl shadow-sm p-6">
      <h2 class="text-lg font-semibold mb-4">Oferty wg miejscowości (sprzedaż)</h2>
      <canvas id="city-chart"></canvas>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-6">
      <h2 class="text-lg font-semibold mb-4">Inventory aging — ile czasu wiszą</h2>
      <canvas id="velocity-chart"></canvas>
      <div class="mt-4 text-sm text-stone-600" id="velocity-summary"></div>
    </div>
  </section>

  <section class="bg-white rounded-2xl shadow-sm p-6 mb-10">
    <h2 class="text-lg font-semibold mb-4">Performance agentów</h2>
    <table class="w-full text-sm">
      <thead class="text-stone-500 text-left border-b">
        <tr>
          <th class="pb-2">Agent</th>
          <th class="pb-2 text-right">Aktywne oferty</th>
          <th class="pb-2 text-right">Wartość portfela</th>
          <th class="pb-2 text-right">Średnia cena</th>
          <th class="pb-2 text-right">Sprzedane/wycofane</th>
          <th class="pb-2 text-right">Śr. dni do zniknięcia</th>
        </tr>
      </thead>
      <tbody id="agents-table"></tbody>
    </table>
  </section>

  <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
    <div class="bg-white rounded-2xl shadow-sm p-6">
      <h2 class="text-lg font-semibold mb-4">Średnia cena/m² wg kategorii</h2>
      <canvas id="price-per-m2-chart"></canvas>
    </div>
    <div class="bg-white rounded-2xl shadow-sm p-6">
      <h2 class="text-lg font-semibold mb-1">Najdłużej na rynku (top 10)</h2>
      <p class="text-xs text-stone-500 mb-4">Liczone od rzeczywistej daty wprowadzenia w Asari (param 5).</p>
      <table class="w-full text-sm">
        <thead class="text-stone-500 text-left border-b">
          <tr><th class="pb-2">Oferta</th><th class="pb-2">Wprowadzona</th><th class="pb-2 text-right">Cena</th><th class="pb-2 text-right">Dni</th></tr>
        </thead>
        <tbody id="tom-table"></tbody>
      </table>
    </div>
  </section>

  <section class="bg-white rounded-2xl shadow-sm p-6 mb-10" id="benchmark-section">
    <h2 class="text-lg font-semibold mb-1">Benchmark vs konkurencja (otodom)</h2>
    <p class="text-stone-500 text-sm mb-4" id="benchmark-summary"></p>
    <div id="benchmark-content" class="text-stone-500">Dane konkurencji jeszcze się pobierają.</div>
  </section>

  <section class="bg-white rounded-2xl shadow-sm p-6 mb-10">
    <h2 class="text-lg font-semibold mb-4">Ostatnie 30 dni — zdarzenia</h2>
    <div id="recent-events" class="text-stone-500">Pojawi się po pierwszych diff-ach (jutro).</div>
  </section>

  <section class="bg-white rounded-2xl shadow-sm p-6 mb-10" id="price-changes-section">
    <h2 class="text-lg font-semibold mb-4">Zmiany cen</h2>
    <div id="price-changes-content" class="text-stone-500">Zmiany cen pojawią się po zebraniu eventów (min. 2 dni historii).</div>
  </section>
</div>

<script>
const A = ${JSON.stringify(analytics, null, 2)};

document.getElementById("updated").textContent = new Date(A.generatedAt).toLocaleString("pl-PL");
document.getElementById("events-total").textContent = \`\${A.totalEventsLogged} eventów w historii\`;

const fmtPLN = (n) => n == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(n) + " zł";

const kpiData = [
  { label: "Aktywnych ofert", value: A.kpi.totalOffers },
  { label: "Średnia cena", value: fmtPLN(A.kpi.avgPrice) },
  { label: "Mediana ceny", value: fmtPLN(A.kpi.medianPrice) },
  { label: "Średnia cena/m²", value: fmtPLN(A.kpi.avgPricePerM2) },
];
document.getElementById("kpi-cards").innerHTML = kpiData.map(k => \`
  <div class="kpi-card bg-white rounded-2xl shadow-sm p-5">
    <div class="text-xs uppercase tracking-wider text-stone-500">\${k.label}</div>
    <div class="text-2xl font-bold mt-2">\${k.value}</div>
  </div>
\`).join("");

new Chart(document.getElementById("time-series-chart"), {
  type: "line",
  data: {
    labels: A.timeSeries.map(t => t.date),
    datasets: [{ label: "Aktywne oferty", data: A.timeSeries.map(t => t.total), borderColor: "#800020", backgroundColor: "rgba(128,0,32,0.1)", tension: 0.3, fill: true }],
  },
  options: { responsive: true, plugins: { legend: { display: false } } },
});

const catEntries = Object.entries(A.kpi.byCategory);
new Chart(document.getElementById("category-chart"), {
  type: "doughnut",
  data: {
    labels: catEntries.map(([k]) => k),
    datasets: [{ data: catEntries.map(([, v]) => v), backgroundColor: ["#800020", "#b8860b", "#5d7e3f", "#4a6fa5", "#8c4a6a"] }],
  },
});

new Chart(document.getElementById("city-chart"), {
  type: "bar",
  data: {
    labels: A.segmentation.byCity.slice(0, 8).map(b => b.key),
    datasets: [{ label: "Liczba ofert", data: A.segmentation.byCity.slice(0, 8).map(b => b.count), backgroundColor: "#800020" }],
  },
  options: { indexAxis: "y", plugins: { legend: { display: false } } },
});

new Chart(document.getElementById("velocity-chart"), {
  type: "bar",
  data: {
    labels: A.velocity.buckets.map(b => b.label),
    datasets: [{ label: "Oferty", data: A.velocity.buckets.map(b => b.count), backgroundColor: ["#22c55e", "#84cc16", "#eab308", "#f97316", "#dc2626"] }],
  },
  options: { plugins: { legend: { display: false } } },
});

document.getElementById("velocity-summary").innerHTML = \`
  Średni czas na rynku: <b>\${A.velocity.avgDaysOnMarket ?? "—"}</b> dni · Mediana: <b>\${A.velocity.medianDaysOnMarket ?? "—"}</b> dni<br>
  Zniknęło z bazy: <b>\${A.velocity.totalRemoved}</b> ofert · Śr. czas-do-zniknięcia: <b>\${A.velocity.avgDaysToRemoval ?? "—"}</b> dni
\`;

document.getElementById("agents-table").innerHTML = A.agents.map(a => \`
  <tr class="border-b last:border-0">
    <td class="py-2 font-medium">\${a.name}</td>
    <td class="py-2 text-right">\${a.activeOffers}</td>
    <td class="py-2 text-right">\${fmtPLN(a.totalActiveValue)}</td>
    <td class="py-2 text-right">\${fmtPLN(a.avgActivePrice)}</td>
    <td class="py-2 text-right">\${a.removedOffers}</td>
    <td class="py-2 text-right">\${a.avgDaysToRemoval ?? "—"}</td>
  </tr>
\`).join("");

new Chart(document.getElementById("price-per-m2-chart"), {
  type: "bar",
  data: {
    labels: A.segmentation.byCategory.map(b => b.key),
    datasets: [{ label: "śr. zł/m²", data: A.segmentation.byCategory.map(b => b.avgPricePerM2 ?? 0), backgroundColor: "#b8860b" }],
  },
  options: { plugins: { legend: { display: false } } },
});

document.getElementById("tom-table").innerHTML = A.timeOnMarket.slice(0, 10).map(t => \`
  <tr class="border-b last:border-0">
    <td class="py-2 max-w-xs truncate">\${t.title}</td>
    <td class="py-2 text-stone-500 text-xs">\${t.listedAt ?? t.firstSeenAt ?? "—"}</td>
    <td class="py-2 text-right">\${fmtPLN(t.pricePln)}</td>
    <td class="py-2 text-right font-semibold \${t.daysOnMarket > 365 ? "text-red-700" : t.daysOnMarket > 180 ? "text-amber-600" : ""}">\${t.daysOnMarket ?? "—"}</td>
  </tr>
\`).join("");

if (A.benchmark?.otodom) {
  const b = A.benchmark.otodom;
  document.getElementById("benchmark-summary").textContent =
    \`Otodom: \${b.totalCompetitorOffers} ofert w regionie. Porównanie tam gdzie mamy wspólne kategorie/miasta.\`;
  document.getElementById("benchmark-content").innerHTML = \`
    <table class="w-full text-sm">
      <thead class="text-stone-500 text-left border-b">
        <tr>
          <th class="pb-2">Kategoria</th>
          <th class="pb-2">Miasto</th>
          <th class="pb-2 text-right">Nasze oferty</th>
          <th class="pb-2 text-right">Otodom</th>
          <th class="pb-2 text-right">Mediana zł/m² my</th>
          <th class="pb-2 text-right">Mediana zł/m² oni</th>
          <th class="pb-2 text-right">Różnica</th>
        </tr>
      </thead>
      <tbody>
        \${b.comparison.map(c => {
          const diff = c.pricePerM2DiffPct;
          const cls = diff == null ? "text-stone-500" : diff < -5 ? "text-blue-700" : diff > 5 ? "text-amber-700" : "text-stone-600";
          return \`
            <tr class="border-b last:border-0">
              <td class="py-2">\${c.category}</td>
              <td class="py-2">\${c.city}</td>
              <td class="py-2 text-right">\${c.ourCount}</td>
              <td class="py-2 text-right">\${c.competitorCount}</td>
              <td class="py-2 text-right">\${fmtPLN(c.ourMedianPricePerM2)}</td>
              <td class="py-2 text-right">\${fmtPLN(c.competitorMedianPricePerM2)}</td>
              <td class="py-2 text-right font-semibold \${cls}">\${diff == null ? "—" : (diff > 0 ? "+" : "") + diff + "%"}</td>
            </tr>
          \`;
        }).join("")}
      </tbody>
    </table>
    <p class="text-xs text-stone-500 mt-4">
      Wartość ujemna (niebieska) = nasze ceny niższe niż rynek. Dodatnia (pomarańczowa) = wyższe.
      Porównujemy tylko ten same kategorie i miasta gdzie obie strony mają oferty.
    </p>
  \`;
}

const eventTypeMap = {
  offer_added: { label: "Nowa", badge: "badge-added" },
  offer_removed: { label: "Zniknęła", badge: "badge-removed" },
  price_changed: { label: "Zmiana ceny", badge: "" },
  area_changed: { label: "Zmiana metrażu", badge: "" },
  rooms_changed: { label: "Zmiana liczby pokoi", badge: "" },
  agent_changed: { label: "Zmiana agenta", badge: "" },
  title_changed: { label: "Zmiana tytułu", badge: "" },
};

if (A.recentEvents.length > 0) {
  document.getElementById("recent-events").innerHTML = \`
    <table class="w-full text-sm">
      <thead class="text-stone-500 text-left border-b">
        <tr><th class="pb-2">Data</th><th class="pb-2">Typ</th><th class="pb-2">Oferta</th><th class="pb-2">Miasto</th><th class="pb-2 text-right">Szczegóły</th></tr>
      </thead>
      <tbody>
        \${A.recentEvents.slice(0, 30).map(e => {
          const meta = eventTypeMap[e.type] || { label: e.type, badge: "" };
          let detail = "";
          if (e.type === "price_changed") {
            const direction = e.diff < 0 ? "badge-price-down" : "badge-price-up";
            detail = \`<span class="badge \${direction}">\${e.diffPct > 0 ? "+" : ""}\${e.diffPct}%</span> \${fmtPLN(e.from)} → \${fmtPLN(e.to)}\`;
          } else if (e.type === "offer_added") {
            detail = \`\${fmtPLN(e.pricePln)} · \${e.category}\`;
          } else if (e.type === "offer_removed") {
            detail = \`\${e.daysOnMarket ?? "?"} dni na rynku · \${fmtPLN(e.lastPricePln)}\`;
          } else if (e.from != null) {
            detail = \`\${e.from} → \${e.to}\`;
          }
          return \`
            <tr class="border-b last:border-0">
              <td class="py-2 text-stone-500">\${e.date}</td>
              <td class="py-2"><span class="badge \${meta.badge}">\${meta.label}</span></td>
              <td class="py-2">\${e.title || e.signature}</td>
              <td class="py-2">\${e.city || "—"}</td>
              <td class="py-2 text-right text-stone-700">\${detail}</td>
            </tr>
          \`;
        }).join("")}
      </tbody>
    </table>
  \`;
}

if (A.priceChanges.length > 0) {
  document.getElementById("price-changes-content").innerHTML = \`
    <table class="w-full text-sm">
      <thead class="text-stone-500 text-left border-b">
        <tr><th class="pb-2">Oferta</th><th class="pb-2">Miasto</th><th class="pb-2 text-right">Z</th><th class="pb-2 text-right">Na</th><th class="pb-2 text-right">Zmiana</th><th class="pb-2 text-right">Data</th></tr>
      </thead>
      <tbody>
        \${A.priceChanges.slice(0, 20).map(p => \`
          <tr class="border-b last:border-0">
            <td class="py-2">\${p.title}</td>
            <td class="py-2">\${p.city}</td>
            <td class="py-2 text-right">\${fmtPLN(p.from)}</td>
            <td class="py-2 text-right">\${fmtPLN(p.to)}</td>
            <td class="py-2 text-right font-semibold \${p.diff < 0 ? "text-green-700" : "text-red-700"}">\${p.diffPct > 0 ? "+" : ""}\${p.diffPct}%</td>
            <td class="py-2 text-right text-stone-500">\${p.date}</td>
          </tr>
        \`).join("")}
      </tbody>
    </table>
  \`;
}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(distDir, "index.html"), html);
console.log(`Dashboard → dist/index.html (${(html.length / 1024).toFixed(1)} KB)`);
