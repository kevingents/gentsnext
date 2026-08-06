import { computePickDeadline, isDispatchDay, effectiveCutoffHour, isHoliday, holidaysForYear } from "@/lib/fulfillment-config";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { getStores, closingHourOnDay } from "@/lib/stores";

const S = { ...(DEFAULT_SETTINGS as unknown as Settings) };
console.log("storeCutoffHour", (S as any).storeCutoffHour, "warehouseCutoffHour", (S as any).warehouseCutoffHour,
  "storeCutoffByDay", JSON.stringify((S as any).storeCutoffByDay), "handover", (S as any).storeHandoverMinutes);

console.log("\n--- JAARGRENS: pick-deadline voor order 31-12 ---");
for (const iso of ["2026-12-31T09:00:00+01:00", "2026-12-31T22:00:00+01:00", "2027-12-24T09:00:00+01:00"]) {
  for (const b of ["99", "1"]) {
    const r = computePickDeadline(new Date(iso), b, S, new Date("2027-01-02T10:00:00+01:00"));
    console.log(iso, "filiaal", b, "->", JSON.stringify(r));
  }
}

console.log("\n--- Feestdag-lookup over de jaargrens ---");
for (const d of ["2026-12-31","2027-01-01","2027-01-02","2027-12-25","2028-01-01"]) {
  console.log(d, "NL-feestdag?", isHoliday("99", d), "BE?", isHoliday("50", d));
}

console.log("\n--- DST-dagen ---");
for (const d of ["2026-03-29","2026-10-25","2027-03-28","2027-10-31"]) {
  console.log(d, "dispatch winkel1?", isDispatchDay("1", ["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"][new Date(d+"T12:00:00Z").getUTCDay()], d, S));
}

console.log("\n--- Overdrachtsmarge: bedoeld vs berekend ---");
const stores = getStores();
for (const stad of ["Almere","Utrecht","Amsterdam"]) {
  const st = stores.find((s) => s.city === stad)!;
  for (const dag of ["donderdag","zaterdag"]) {
    const raw = st.hours[dag];
    for (const marge of [0, 15, 30, 60, 90]) {
      const got = effectiveCutoffHour(stad === "Almere" ? "1" : stad === "Utrecht" ? "18" : "15", dag, { ...S, storeHandoverMinutes: marge });
      // bedoeld = floor((sluitingsminuten - marge)/60)
      const m = String(raw).match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
      const closeMin = m ? Number(m[3])*60+Number(m[4]) : null;
      const bedoeld = closeMin == null ? null : Math.max(0, Math.min((S as any).storeCutoffByDay?.[dag] ?? (S as any).storeCutoffHour, Math.floor((closeMin - marge)/60)));
      const vlag = bedoeld != null && got !== bedoeld ? "  <== AFWIJKING" : "";
      console.log(`${stad} ${dag} "${raw}" marge=${marge} -> cutoff ${got}  (bedoeld ${bedoeld})${vlag}`);
    }
  }
}
