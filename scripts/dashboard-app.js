/**
 * Kod klienta dashboardu Dan-Dom.
 * Zakłada że `window.A` (analytics) i Chart.js zostały załadowane wcześniej.
 *
 * Generowany do dist/app.js przez build-dashboard.mjs (zwykła kopia, bez transformacji).
 */
/* global Chart */

const A = window.A;

const fmtPLN = (n) => (n == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(n) + " zł");
const fmtNum = (n) => (n == null ? "—" : new Intl.NumberFormat("pl-PL").format(n));

document.getElementById("updated").textContent = new Date(A.generatedAt).toLocaleString("pl-PL");

(() => {
  const ageHours = (Date.now() - new Date(A.generatedAt).getTime()) / 3_600_000;
  const el = document.getElementById("freshness");
  if (ageHours > 36) {
    el.innerHTML = `<span class="badge badge-removed">⚠️ dane sprzed ${Math.round(ageHours / 24)} dni — workflow mógł paść</span>`;
  } else if (ageHours > 24) {
    el.innerHTML = `<span class="badge badge-price-up">dane sprzed ${Math.round(ageHours)}h</span>`;
  }
})();

// === TABS ===
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// === KPI: Nasze oferty ===
const kpiData = [
  { label: "Aktywnych ofert", value: A.kpi.totalOffers },
  { label: "Wartość portfela", value: fmtPLN(A.kpi.totalActiveValue) },
  { label: "Mediana ceny", value: fmtPLN(A.kpi.medianPrice) },
  { label: "Średnia cena/m²", value: fmtPLN(A.kpi.avgPricePerM2) },
  { label: "Śr. czas na rynku", value: A.velocity.avgDaysOnMarket != null ? A.velocity.avgDaysOnMarket + " dni" : "—" },
];
document.getElementById("kpi-cards").innerHTML = kpiData
  .map(
    (k) => `
  <div class="kpi-card bg-white rounded-2xl shadow-sm p-4">
    <div class="text-[10px] uppercase tracking-wider text-stone-500 font-medium">${k.label}</div>
    <div class="text-xl md:text-2xl font-bold mt-1">${k.value}</div>
  </div>
`,
  )
  .join("");

// === Charts: Nasze oferty ===
new Chart(document.getElementById("time-series-chart"), {
  type: "line",
  data: {
    labels: A.timeSeries.map((t) => t.date),
    datasets: [{ label: "Aktywne", data: A.timeSeries.map((t) => t.total), borderColor: "#800020", backgroundColor: "rgba(128,0,32,0.1)", tension: 0.3, fill: true }],
  },
  options: { responsive: true, plugins: { legend: { display: false } } },
});

new Chart(document.getElementById("velocity-chart"), {
  type: "bar",
  data: {
    labels: A.velocity.buckets.map((b) => b.label),
    datasets: [{ data: A.velocity.buckets.map((b) => b.count), backgroundColor: ["#22c55e", "#84cc16", "#eab308", "#f97316", "#dc2626"] }],
  },
  options: { plugins: { legend: { display: false } }, indexAxis: "y" },
});

document.getElementById("velocity-summary").innerHTML = `
  Średnia: <b>${A.velocity.avgDaysOnMarket ?? "—"}</b> dni · Mediana: <b>${A.velocity.medianDaysOnMarket ?? "—"}</b> dni
`;

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
    labels: A.segmentation.byCity.slice(0, 10).map((b) => b.key),
    datasets: [{ label: "Oferty", data: A.segmentation.byCity.slice(0, 10).map((b) => b.count), backgroundColor: "#800020" }],
  },
  options: { indexAxis: "y", plugins: { legend: { display: false } } },
});

// === Tabele: Nasze oferty ===
document.getElementById("tom-table").innerHTML = A.timeOnMarket
  .slice(0, 15)
  .map((t) => {
    const days = t.daysOnMarket;
    const cls = days > 365 ? "text-red-700" : days > 180 ? "text-amber-600" : "text-stone-900";
    return `
    <tr class="border-b border-stone-100 last:border-0">
      <td class="py-2 max-w-md truncate" data-label="Oferta">${t.title}</td>
      <td class="py-2 text-stone-600" data-label="Lokalizacja">${t.city}</td>
      <td class="py-2 text-stone-500 text-xs" data-label="Wprowadzona">${t.listedAt ?? t.firstSeenAt ?? "—"}</td>
      <td class="py-2 text-right" data-label="Cena">${fmtPLN(t.pricePln)}</td>
      <td class="py-2 text-right font-semibold ${cls}" data-label="Dni na rynku">${days ?? "—"}</td>
    </tr>
  `;
  })
  .join("");

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
  document.getElementById("recent-events").innerHTML = `
    <table class="w-full text-sm responsive-table">
      <thead class="text-stone-500 text-left border-b border-stone-200">
        <tr><th class="pb-2">Data</th><th class="pb-2">Typ</th><th class="pb-2">Oferta</th><th class="pb-2">Miasto</th><th class="pb-2 text-right">Szczegóły</th></tr>
      </thead>
      <tbody>
        ${A.recentEvents
          .slice(0, 30)
          .map((e) => {
            const meta = eventTypeMap[e.type] || { label: e.type, badge: "" };
            const displayDate = e.effectiveDate || e.date;
            let detail = "";
            if (e.type === "price_changed") {
              const dir = e.diff < 0 ? "badge-price-down" : "badge-price-up";
              detail = `<span class="badge ${dir}">${e.diffPct > 0 ? "+" : ""}${e.diffPct}%</span> ${fmtPLN(e.from)} → ${fmtPLN(e.to)}`;
            } else if (e.type === "offer_added") {
              detail = `${fmtPLN(e.pricePln)} · ${e.category}`;
            } else if (e.type === "offer_removed") {
              detail = `${e.daysOnMarket ?? "?"} dni · ${fmtPLN(e.lastPricePln)}`;
            } else if (e.from != null) {
              detail = `${e.from} → ${e.to}`;
            }
            return `
            <tr class="border-b border-stone-100 last:border-0">
              <td class="py-2 text-stone-500" data-label="Data">${displayDate}</td>
              <td class="py-2" data-label="Typ"><span class="badge ${meta.badge}">${meta.label}</span></td>
              <td class="py-2 max-w-xs truncate" data-label="Oferta">${e.title || e.signature}</td>
              <td class="py-2" data-label="Miasto">${e.city || "—"}</td>
              <td class="py-2 text-right text-stone-700" data-label="Szczegóły">${detail}</td>
            </tr>
          `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

// Sekcja agentów: renderowana w HTML zawsze, ukrywana gdy <2 agentów.
const agentsSection = document.getElementById("agents-section");
if (A.agents && A.agents.length > 1) {
  document.getElementById("agents-table").innerHTML = A.agents
    .map(
      (a) => `
    <tr class="border-b border-stone-100 last:border-0">
      <td class="py-2 font-medium" data-label="Agent">${a.name}</td>
      <td class="py-2 text-right" data-label="Aktywne">${a.activeOffers}</td>
      <td class="py-2 text-right" data-label="Wartość">${fmtPLN(a.totalActiveValue)}</td>
      <td class="py-2 text-right" data-label="Średnia cena">${fmtPLN(a.avgActivePrice)}</td>
      <td class="py-2 text-right" data-label="Zniknęło">${a.removedOffers}</td>
    </tr>
  `,
    )
    .join("");
} else if (agentsSection) {
  agentsSection.style.display = "none";
}

// === Tab 2: Rynek ===
const bench = A.benchmark?.competitor;
if (bench) {
  const ourCount = bench.comparison.reduce((sum, c) => sum + c.ourCount, 0);
  const theirCount = bench.totalCompetitorOffers;
  const sharePct = ourCount + theirCount > 0 ? Math.round((ourCount / (ourCount + theirCount)) * 1000) / 10 : 0;
  const avgDiff = bench.comparison.filter((c) => c.pricePerM2DiffPct != null).reduce((sum, c, _, arr) => sum + c.pricePerM2DiffPct / arr.length, 0);

  document.getElementById("market-kpi").innerHTML = [
    { label: "Konkurencja w regionie", value: theirCount },
    { label: "Nasze (porównywalne)", value: ourCount },
    { label: "Nasz udział", value: sharePct + "%" },
    { label: "Średnia różnica cen/m²", value: (avgDiff > 0 ? "+" : "") + avgDiff.toFixed(1) + "%" },
  ]
    .map(
      (k) => `
    <div class="kpi-card bg-white rounded-2xl shadow-sm p-4">
      <div class="text-[10px] uppercase tracking-wider text-stone-500 font-medium">${k.label}</div>
      <div class="text-xl md:text-2xl font-bold mt-1">${k.value}</div>
    </div>
  `,
    )
    .join("");

  const sources = A.benchmark.sourceCounts || {};
  const srcLines = Object.entries(sources)
    .map(([k, v]) => `${k}: <b>${v}</b>`)
    .join(" · ");
  if (srcLines) {
    document.getElementById("benchmark-sources").innerHTML = `Źródła: ${srcLines}. Duplikaty wykryte przez externalUrl + heurystykę miasto+powierzchnia+cena.`;
  }

  document.getElementById("benchmark-content").innerHTML = `
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
        ${bench.comparison
          .map((c) => {
            const diff = c.pricePerM2DiffPct;
            const cls = diff == null ? "text-stone-500" : diff < -5 ? "text-blue-700" : diff > 5 ? "text-amber-700" : "text-stone-700";
            return `
            <tr class="border-b border-stone-100 last:border-0">
              <td class="py-2" data-label="Kategoria">${c.category}</td>
              <td class="py-2" data-label="Miasto">${c.city}</td>
              <td class="py-2 text-right" data-label="Nasze">${c.ourCount}</td>
              <td class="py-2 text-right" data-label="Konkurencja">${c.competitorCount}</td>
              <td class="py-2 text-right" data-label="Mediana zł/m² my">${fmtPLN(c.ourMedianPricePerM2)}</td>
              <td class="py-2 text-right" data-label="Mediana zł/m² oni">${fmtPLN(c.competitorMedianPricePerM2)}</td>
              <td class="py-2 text-right font-semibold ${cls}" data-label="Różnica">${diff == null ? "—" : (diff > 0 ? "+" : "") + diff + "%"}</td>
            </tr>
          `;
          })
          .join("")}
      </tbody>
    </table>
  `;

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
        { label: "Nasze", data: cities.map((c) => byCity[c].ours), backgroundColor: "#800020" },
        { label: "Konkurencja", data: cities.map((c) => byCity[c].theirs), backgroundColor: "#a8a29e" },
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
        { label: "Nasze", data: cats.map((c) => Math.round(avg(byCat[c].ours))), backgroundColor: "#800020" },
        { label: "Konkurencja", data: cats.map((c) => Math.round(avg(byCat[c].theirs))), backgroundColor: "#a8a29e" },
      ],
    },
    options: { plugins: { legend: { position: "bottom" } }, responsive: true },
  });
}

// === Tab 2: Kto wystawia oferty konkurencji ===
const CA = A.competitorAgents;
if (CA && CA.total > 0) {
  // Pie: prywatne | top10 biur | reszta biur | nieznane
  const top10Count = CA.byAgency.slice(0, 10).reduce((s, a) => s + a.count, 0);
  const restAgenciesCount = CA.knownAgent - top10Count;
  new Chart(document.getElementById("competitor-agents-pie"), {
    type: "doughnut",
    data: {
      labels: ["Prywatne", "Top 10 biur", "Pozostałe biura", "Nieznane (NO)"],
      datasets: [
        {
          data: [CA.private, top10Count, restAgenciesCount, CA.unknown],
          backgroundColor: ["#5d7e3f", "#800020", "#b8860b", "#a8a29e"],
        },
      ],
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => ctx.label + ": " + ctx.parsed + " (" + Math.round((ctx.parsed / CA.total) * 100) + "%)" } },
      },
    },
  });

  // Bar: top 10 biur (Dan-Dom highlighted)
  const top10 = CA.byAgency.slice(0, 10);
  new Chart(document.getElementById("competitor-top-agencies"), {
    type: "bar",
    data: {
      labels: top10.map((a) => (a.isOurs ? "★ " : "") + (a.name.length > 35 ? a.name.slice(0, 35) + "…" : a.name)),
      datasets: [
        {
          label: "Oferty",
          data: top10.map((a) => a.count),
          backgroundColor: top10.map((a) => (a.isOurs ? "#22c55e" : "#800020")),
        },
      ],
    },
    options: {
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { afterBody: (ctx) => (top10[ctx[0].dataIndex].isOurs ? "(Twoje biuro)" : "") } },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

// === TAB 3: HISTORIA ===
const H = A.history;
if (H && H.months && H.months.length > 0) {
  document.getElementById("tracking-start").textContent = H.trackingStartDate || "—";

  const labels = H.months.map((m) => m.key);

  const CAT_COLORS = {
    DOM: "#800020",
    MIESZKANIE: "#b8860b",
    DZIAŁKA: "#5d7e3f",
    OBIEKT: "#4a6fa5",
  };

  // 1. Liczba aktywnych ofert — line z breakdown per kategoria
  const categories = Array.from(new Set(H.months.flatMap((m) => Object.keys(m.byCategory))));
  const totalDataset = {
    label: "Łącznie",
    data: H.months.map((m) => m.total),
    borderColor: "#1c1917",
    backgroundColor: "transparent",
    borderWidth: 2.5,
    tension: 0.25,
    fill: false,
  };
  const catDatasets = categories.map((cat) => ({
    label: cat,
    data: H.months.map((m) => m.byCategory[cat] || 0),
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
      datasets: categories.map((cat) => ({
        label: cat,
        data: H.months.map((m) => {
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
      scales: { y: { stacked: true, beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" } } },
    },
  });

  // 3. Mediana ceny
  new Chart(document.getElementById("hist-price-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Mediana", data: H.months.map((m) => m.medianPrice), borderColor: "#800020", backgroundColor: "rgba(128,0,32,0.1)", tension: 0.25, fill: true, borderWidth: 2 },
        { label: "Średnia", data: H.months.map((m) => m.avgPrice), borderColor: "#a8a29e", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 1.5, borderDash: [4, 4] },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + fmtPLN(ctx.parsed.y) } },
      },
      scales: { y: { ticks: { callback: (v) => fmtPLN(v) } } },
    },
  });

  // 4. Mediana zł/m²
  new Chart(document.getElementById("hist-pricepm2-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Mediana zł/m²", data: H.months.map((m) => m.medianPricePerM2), borderColor: "#5d7e3f", backgroundColor: "rgba(93,126,63,0.15)", tension: 0.25, fill: true, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => fmtPLN(ctx.parsed.y) + "/m²" } },
      },
      scales: { y: { ticks: { callback: (v) => fmtPLN(v) } } },
    },
  });

  // 5. Średni czas na rynku
  new Chart(document.getElementById("hist-days-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Średnia", data: H.months.map((m) => m.avgDaysOnMarket), borderColor: "#b8860b", backgroundColor: "rgba(184,134,11,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
        { label: "Mediana", data: H.months.map((m) => m.medianDaysOnMarket), borderColor: "#78716c", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 1.5, borderDash: [4, 4] },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y + " dni" } },
      },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + " dni" } } },
    },
  });

  // 6. Top miasta — multiline (top N w ostatnim miesiącu)
  const lastMonth = H.months[H.months.length - 1];
  const topCityNames = lastMonth.topCities.map((c) => c.city);
  const cityColors = ["#800020", "#b8860b", "#5d7e3f", "#4a6fa5", "#8c4a6a"];
  new Chart(document.getElementById("hist-cities-chart"), {
    type: "line",
    data: {
      labels,
      datasets: topCityNames.map((city, i) => ({
        label: city,
        data: H.months.map((m) => {
          const found = m.topCities.find((c) => c.city === city);
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
    const cLabels = CH.months.map((m) => m.key);
    const cCategories = Array.from(new Set(CH.months.flatMap((m) => Object.keys(m.byCategory))));

    // === Top biura konkurencyjne - trend w czasie ===
    const CAH = A.competitorAgentsHistory;
    if (CAH && CAH.length > 0) {
      // Top 5 z ostatniego dnia, narysuj ich trajektorie w czasie
      const lastDay = CAH[CAH.length - 1];
      const top5Names = lastDay.topAgencies.slice(0, 5).map((a) => a.name);
      const cahLabels = CAH.map((d) => d.date);
      const trendColors = ["#800020", "#b8860b", "#5d7e3f", "#4a6fa5", "#8c4a6a"];

      // Find isOurs flag per name (latest day's metadata)
      const lastDayMeta = new Map(lastDay.topAgencies.map((a) => [a.name, a.isOurs]));
      new Chart(document.getElementById("competitor-agencies-trend"), {
        type: "line",
        data: {
          labels: cahLabels,
          datasets: top5Names.map((name, i) => ({
            label: (lastDayMeta.get(name) ? "★ " : "") + (name.length > 30 ? name.slice(0, 30) + "…" : name),
            data: CAH.map((d) => d.topAgencies.find((a) => a.name === name)?.count ?? 0),
            borderColor: trendColors[i % trendColors.length],
            backgroundColor: "transparent",
            tension: 0.25,
            fill: false,
            borderWidth: 1.8,
          })),
        },
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      });
    }

    // === Nasz udzial w rynku w czasie ===
    // Wspólne klucze (oba muszą mieć dany bucket), inaczej share nie ma sensu.
    const ourByKeyForShare = new Map(H.months.map((m) => [m.key, m.total]));
    const sharedKeys = cLabels.filter((k) => ourByKeyForShare.has(k));
    const shareSeries = sharedKeys.map((k) => {
      const ours = ourByKeyForShare.get(k) || 0;
      const theirs = CH.months.find((m) => m.key === k)?.total || 0;
      const total = ours + theirs;
      return total > 0 ? Math.round((ours / total) * 1000) / 10 : null;
    });
    new Chart(document.getElementById("market-share-history-chart"), {
      type: "line",
      data: {
        labels: sharedKeys,
        datasets: [
          {
            label: "Nasz udział (%)",
            data: shareSeries,
            borderColor: "#800020",
            backgroundColor: "rgba(128,0,32,0.15)",
            tension: 0.25,
            fill: true,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => "Udział: " + ctx.parsed.y + "%" } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + "%" } } },
      },
    });

    const cTotalDataset = {
      label: "Łącznie (konkurencja)",
      data: CH.months.map((m) => m.total),
      borderColor: "#1c1917",
      backgroundColor: "transparent",
      borderWidth: 2.5,
      tension: 0.25,
      fill: false,
    };
    const cCatDatasets = cCategories.map((cat) => ({
      label: cat,
      data: CH.months.map((m) => m.byCategory[cat] || 0),
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

    new Chart(document.getElementById("chist-category-mix-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: cCategories.map((cat) => ({
          label: cat,
          data: CH.months.map((m) => {
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
        scales: { y: { stacked: true, beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" } } },
      },
    });

    const ourByKey = new Map(H.months.map((m) => [m.key, m]));
    const ourSeries = (field) => cLabels.map((k) => ourByKey.get(k)?.[field] ?? null);

    new Chart(document.getElementById("chist-price-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: [
          { label: "Nasze (mediana)", data: ourSeries("medianPrice"), borderColor: "#800020", backgroundColor: "rgba(128,0,32,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
          { label: "Konkurencja (mediana)", data: CH.months.map((m) => m.medianPrice), borderColor: "#4a6fa5", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + fmtPLN(ctx.parsed.y) } },
        },
        scales: { y: { ticks: { callback: (v) => fmtPLN(v) } } },
      },
    });

    new Chart(document.getElementById("chist-pricepm2-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: [
          { label: "Nasze (zł/m²)", data: ourSeries("medianPricePerM2"), borderColor: "#5d7e3f", backgroundColor: "rgba(93,126,63,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
          { label: "Konkurencja (zł/m²)", data: CH.months.map((m) => m.medianPricePerM2), borderColor: "#4a6fa5", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + fmtPLN(ctx.parsed.y) + "/m²" } },
        },
        scales: { y: { ticks: { callback: (v) => fmtPLN(v) } } },
      },
    });

    new Chart(document.getElementById("chist-days-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: [
          { label: "Nasze (śr.)", data: ourSeries("avgDaysOnMarket"), borderColor: "#b8860b", backgroundColor: "rgba(184,134,11,0.15)", tension: 0.25, fill: true, borderWidth: 2 },
          { label: "Konkurencja (śr.)", data: CH.months.map((m) => m.avgDaysOnMarket), borderColor: "#4a6fa5", backgroundColor: "transparent", tension: 0.25, fill: false, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y + " dni" } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + " dni" } } },
      },
    });

    const cLastMonth = CH.months[CH.months.length - 1];
    const cTopCityNames = cLastMonth.topCities.map((c) => c.city);
    const cCityColors = ["#4a6fa5", "#800020", "#b8860b", "#5d7e3f", "#8c4a6a"];
    new Chart(document.getElementById("chist-cities-chart"), {
      type: "line",
      data: {
        labels: cLabels,
        datasets: cTopCityNames.map((city, i) => ({
          label: city,
          data: CH.months.map((m) => {
            const found = m.topCities.find((c) => c.city === city);
            return found ? found.count : 0;
          }),
          borderColor: cCityColors[i % cCityColors.length],
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

    document.getElementById("chist-table").innerHTML = CH.months
      .slice()
      .reverse()
      .map(
        (m) => `
      <tr class="border-b border-stone-100 last:border-0">
        <td class="py-2 font-medium">${m.key}</td>
        <td class="py-2 text-right font-semibold">${m.total}</td>
        <td class="py-2 text-right">${m.byCategory.DOM || 0}</td>
        <td class="py-2 text-right">${m.byCategory.MIESZKANIE || 0}</td>
        <td class="py-2 text-right">${m.byCategory["DZIAŁKA"] || 0}</td>
        <td class="py-2 text-right">${fmtPLN(m.medianPrice)}</td>
        <td class="py-2 text-right">${fmtPLN(m.medianPricePerM2)}</td>
        <td class="py-2 text-right">${m.avgDaysOnMarket ?? "—"}</td>
      </tr>
    `,
      )
      .join("");
  }

  // Tabela nasza
  document.getElementById("hist-table").innerHTML = H.months
    .slice()
    .reverse()
    .map(
      (m) => `
    <tr class="border-b border-stone-100 last:border-0">
      <td class="py-2 font-medium">${m.key}</td>
      <td class="py-2 text-right font-semibold">${m.total}</td>
      <td class="py-2 text-right">${m.byCategory.DOM || 0}</td>
      <td class="py-2 text-right">${m.byCategory.MIESZKANIE || 0}</td>
      <td class="py-2 text-right">${m.byCategory["DZIAŁKA"] || 0}</td>
      <td class="py-2 text-right">${fmtPLN(m.medianPrice)}</td>
      <td class="py-2 text-right">${fmtPLN(m.medianPricePerM2)}</td>
      <td class="py-2 text-right">${m.avgDaysOnMarket ?? "—"}</td>
    </tr>
  `,
    )
    .join("");
}
