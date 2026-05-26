/**
 * Generuje dist/index.html — dashboard z zakładkami:
 *  1. 📊 Nasze oferty (KPI, velocity, eventy, top miejscowości)
 *  2. 🌍 Rynek i konkurencja (benchmark vs otodom)
 *  3. 📈 Historia (miesięczne agregaty + porównanie z konkurencją)
 *
 * Plik zawiera TYLKO HTML/CSS + wstrzyknięcie danych. Cały JS klienta żyje w
 * scripts/dashboard-app.js i jest kopiowany 1:1 do dist/app.js. Dzięki temu
 * edytor podświetla kod klienta jako prawdziwy JS, a nie jako string.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const analytics = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "analytics.json"), "utf8"));

const distDir = path.join(ROOT, "dist");
fs.mkdirSync(distDir, { recursive: true });

// Inline'ujemy dane jako JSON wewnątrz <script>. JSON.stringify musi zabezpieczyć
// `</script>` przed przedwczesnym domknięciem tagu — stąd replace.
const analyticsJson = JSON.stringify(analytics).replace(/<\/script/gi, "<\\/script");

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
      <span id="freshness" class="ml-2"></span>
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

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-8" id="agents-section">
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
    </section>

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

    <section class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <div class="bg-white rounded-2xl shadow-sm p-5">
        <h2 class="text-base font-semibold mb-1">Kto wystawia oferty</h2>
        <p class="text-xs text-stone-500 mb-3">Prywatne / biura / nieznane (oferty z Nieruchomosci-Online bez detail).</p>
        <canvas id="competitor-agents-pie"></canvas>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-5 lg:col-span-2">
        <h2 class="text-base font-semibold mb-1">Top 10 biur w regionie</h2>
        <p class="text-xs text-stone-500 mb-3">Aktywne oferty per biuro (bez nas). Tylko otodom + OLX — NO nie udostępnia agencji w listingu.</p>
        <canvas id="competitor-top-agencies"></canvas>
      </div>
    </section>

  </div>

  <!-- ============ TAB 3: HISTORIA ============ -->
  <div class="tab-panel" id="tab-history">

    <div class="bg-stone-50 border border-stone-200 rounded-xl p-4 mb-6 text-sm text-stone-600">
      Tracking zaczął się <span id="tracking-start" class="font-semibold"></span>.
      Wykresy pokazują stan portfela na koniec każdego 14-dniowego okresu — z każdym kolejnym okresem historia rośnie.
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
        <p class="text-xs text-stone-500 mb-3">Aktualna cena ofert aktywnych na koniec danego okresu (14 dni). Mediana zwykle stabilniejsza niż średnia.</p>
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
        <p class="text-xs text-stone-500 mb-3">Liczba ofert w największych miastach okres po okresie (14 dni).</p>
        <canvas id="hist-cities-chart"></canvas>
      </div>
    </section>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-8">
      <h2 class="text-base font-semibold mb-3">Tabela dwutygodniowa — nasze</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-stone-500 text-left border-b border-stone-200">
            <tr>
              <th class="pb-2">Okres (do)</th>
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
      <h2 class="text-xl font-bold mb-1">🌍 Rynek i konkurencja — historia (Otodom + OLX + Nieruchomosci-Online)</h2>
      <p class="text-sm text-stone-500 mb-4">Te same metryki dla ofert konkurencji w powiecie Wągrowiec i Rogoźno (województwo wielkopolskie). Listed = data utworzenia oferty na portalu (dateCreated). Oferty z Nieruchomości-Online nie mają tej daty - używamy daty kiedy je pierwszy raz zobaczyliśmy, co zaniża "czas na rynku" dla tego źródła.</p>
    </div>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-6">
      <h2 class="text-base font-semibold mb-1">📊 Nasz udział w rynku w czasie</h2>
      <p class="text-xs text-stone-500 mb-3">% nasz / (nasz + konkurencja). Dla pełnego rynku regionu Wągrowiec/Rogoźno.</p>
      <canvas id="market-share-history-chart"></canvas>
    </section>

    <section class="bg-white rounded-2xl shadow-sm p-5 mb-6">
      <h2 class="text-base font-semibold mb-1">🏢 Top biura konkurencyjne — trend</h2>
      <p class="text-xs text-stone-500 mb-3">Liczba aktywnych ofert per biuro w czasie. Top 5 z ostatniego dnia.</p>
      <canvas id="competitor-agencies-trend"></canvas>
    </section>

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
        <p class="text-xs text-stone-500 mb-3">Bezpośrednie porównanie okres po okresie (14 dni).</p>
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
      <h2 class="text-base font-semibold mb-3">Tabela dwutygodniowa — konkurencja</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-stone-500 text-left border-b border-stone-200">
            <tr>
              <th class="pb-2">Okres (do)</th>
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

<script>window.A = ${analyticsJson};</script>
<script src="app.js"></script>
</body>
</html>
`;

// Kopia kodu klienta — bez transformacji. Trzymamy źródło w scripts/dashboard-app.js
// żeby edytor traktował go jako JS, a nie jako string.
const appJs = fs.readFileSync(path.join(__dirname, "dashboard-app.js"), "utf8");
fs.writeFileSync(path.join(distDir, "app.js"), appJs);

fs.writeFileSync(path.join(distDir, "index.html"), html);
console.log(`Dashboard → dist/index.html (${(html.length / 1024).toFixed(1)} KB) + dist/app.js (${(appJs.length / 1024).toFixed(1)} KB)`);
