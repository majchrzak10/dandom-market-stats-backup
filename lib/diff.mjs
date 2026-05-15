/**
 * Diff engine: porównuje dwa snapshoty i zwraca listę eventów.
 *
 * Typy eventów:
 *   offer_added       — sygnatura pojawiła się
 *   offer_removed     — sygnatura zniknęła (sprzedaż lub wycofanie)
 *   price_changed     — pricePln różny niż poprzednio
 *   area_changed      — areaM2 zmienił się (rzadko, ale bywa)
 *   rooms_changed     — rooms zmienił się
 *   agent_changed     — agentName zmienił się
 *   title_changed     — title zmienił się
 *
 * Każdy event ma:
 *   { type, date, signature, ...payload specific to type }
 */

const TRACKED_FIELDS = [
  { field: "pricePln", eventType: "price_changed" },
  { field: "areaM2", eventType: "area_changed" },
  { field: "rooms", eventType: "rooms_changed" },
  { field: "agentName", eventType: "agent_changed" },
  { field: "title", eventType: "title_changed" },
];

export function computeDiff(prevSnapshot, currSnapshot) {
  const events = [];
  const date = currSnapshot.date;
  const prevBySig = new Map((prevSnapshot?.offers ?? []).map((o) => [o.signature, o]));
  const currBySig = new Map(currSnapshot.offers.map((o) => [o.signature, o]));

  // Removed
  for (const [sig, prev] of prevBySig) {
    if (!currBySig.has(sig)) {
      // Używamy listedAt (Asari) jeśli mamy, w przeciwnym razie firstSeenAt (nasze)
      const referenceDate = prev.listedAt || prev.firstSeenAt;
      events.push({
        type: "offer_removed",
        date,
        signature: sig,
        title: prev.title,
        city: prev.city,
        category: prev.category,
        lastPricePln: prev.pricePln,
        listedAt: prev.listedAt,
        firstSeenAt: prev.firstSeenAt,
        daysOnMarket: daysBetween(referenceDate, date),
      });
    }
  }

  // Added + Changed
  for (const [sig, curr] of currBySig) {
    const prev = prevBySig.get(sig);
    if (!prev) {
      // Bootstrap: jeśli oferta istnieje w Asari dłużej niż 7 dni przed naszym
      // odkryciem, to znaczy że to jest backfill (pierwszy snapshot), nie prawdziwe "nowe".
      const detectionLag = curr.listedAt ? daysBetween(curr.listedAt, date) : 0;
      const isBootstrap = detectionLag != null && detectionLag > 7;
      events.push({
        type: "offer_added",
        date,                                    // kiedy MY to wykryliśmy
        effectiveDate: curr.listedAt || date,    // kiedy oferta naprawdę powstała
        isBootstrap,
        signature: sig,
        title: curr.title,
        city: curr.city,
        category: curr.category,
        transaction: curr.transaction,
        pricePln: curr.pricePln,
        areaM2: curr.areaM2,
        rooms: curr.rooms,
        agentName: curr.agentName,
        listedAt: curr.listedAt,
        firstSeenAt: curr.firstSeenAt,
      });
      continue;
    }
    for (const { field, eventType } of TRACKED_FIELDS) {
      if (prev[field] !== curr[field]) {
        const diff = {
          type: eventType,
          date,
          signature: sig,
          title: curr.title,
          city: curr.city,
          from: prev[field],
          to: curr[field],
        };
        if (eventType === "price_changed" && prev[field] && curr[field]) {
          diff.diff = curr[field] - prev[field];
          diff.diffPct = Math.round(((curr[field] - prev[field]) / prev[field]) * 1000) / 10;
        }
        events.push(diff);
      }
    }
  }

  return events;
}

function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = Date.parse(dateA);
  const b = Date.parse(dateB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
