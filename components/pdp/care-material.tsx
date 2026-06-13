import type { CareItem, CareKey, Composition, MaterialCat } from "@/lib/care";
import { materialCategory } from "@/lib/care";

/* Standaard wasvoorschrift-symbolen als schone SVG-lijniconen (geen emoji). */
const Slash = () => <line x1="4" y1="20" x2="20" y2="4" />;
const Tub = () => <path d="M2 9c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2v2l-2 8H4L2 11Z" />;
const Square = () => <rect x="3.5" y="4.5" width="17" height="15" rx="1" />;
const Triangle = () => <path d="M12 4l9 16H3Z" />;
const Iron = () => <path d="M3 16l2-5h12l3 5Zm2-5 1-2h9" />;

function svg(children: React.ReactNode) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 shrink-0 text-ink">
      {children}
    </svg>
  );
}

function CareSymbol({ k }: { k: CareKey }) {
  switch (k) {
    case "wash30": case "wash40": case "wash60":
      return svg(<><Tub /><text x="12" y="16" textAnchor="middle" fontSize="6" fill="currentColor" stroke="none">{k === "wash60" ? "60" : k === "wash40" ? "40" : "30"}</text></>);
    case "handwash":
      return svg(<><Tub /><path d="M8 14h8" /></>);
    case "nowash":
      return svg(<><Tub /><Slash /></>);
    case "nobleach":
      return svg(<><Triangle /><Slash /></>);
    case "notumble":
      return svg(<><Square /><circle cx="12" cy="12" r="4.5" /><Slash /></>);
    case "tumblelow":
      return svg(<><Square /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></>);
    case "dryflat":
      return svg(<><Square /><line x1="7" y1="12" x2="17" y2="12" /></>);
    case "dryline":
      return svg(<><Square /><path d="M8 8v8M12 8v8M16 8v8" /></>);
    case "nowring":
      return svg(<><path d="M4 9c3-2 5 2 8 0s4 2 8 0M4 15c3-2 5 2 8 0s4 2 8 0" /><Slash /></>);
    case "noiron":
      return svg(<><Iron /><Slash /></>);
    case "ironlow":
      return svg(<><Iron /><circle cx="11" cy="13.5" r="0.6" fill="currentColor" /></>);
    case "ironmid":
      return svg(<><Iron /><circle cx="9.5" cy="13.5" r="0.6" fill="currentColor" /><circle cx="13" cy="13.5" r="0.6" fill="currentColor" /></>);
    case "dryclean":
      return svg(<><circle cx="12" cy="12" r="8.5" /><text x="12" y="15" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">P</text></>);
    default:
      return svg(<Square />);
  }
}

function MaterialSymbol({ cat }: { cat: MaterialCat }) {
  const wrap = (c: React.ReactNode) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 shrink-0 text-ink">{c}</svg>
  );
  switch (cat) {
    case "wol": return wrap(<><circle cx="12" cy="12" r="8" /><path d="M6 10c3 1 9 1 12 0M5 14c4 1 10 1 14 0M9 5c-1 4-1 10 0 14M15 5c1 4 1 10 0 14" /></>);
    case "kasjmier": return wrap(<path d="M12 5a7 7 0 1 1-5.5 11.3A4.5 4.5 0 1 1 11 8.5 2.6 2.6 0 1 1 13 13" />);
    case "katoen": return wrap(<><circle cx="12" cy="12" r="2.5" /><path d="M12 9.5V4M12 14.5V20M9.5 12H4M14.5 12H20M10 10 6 6M14 10l4-4M10 14l-4 4M14 14l4 4" /></>);
    case "zijde": return wrap(<path d="M5 7c4 0 4 4 7 4s3-4 7-4M5 13c4 0 4 4 7 4s3-4 7-4" />);
    case "linnen": return wrap(<><path d="M12 21V8" /><path d="M12 8c0-3 2-5 5-5 0 3-2 5-5 5ZM12 11c0-3-2-5-5-5 0 3 2 5 5 5Z" /></>);
    case "leer": return wrap(<path d="M5 8c2-3 4-3 7-3s5 0 7 3c1 2 0 5-2 7-1 1-1 3-3 3s-2-2-3-2-1 2-3 2-2-2-3-3c-2-2-3-5-2-7Z" />);
    case "polyester": return wrap(<path d="M12 3c4 5 6 8 6 11a6 6 0 1 1-12 0c0-3 2-6 6-11Z" />);
    case "viscose": return wrap(<><path d="M5 19C5 11 11 5 19 5c0 8-6 14-14 14Z" /><path d="M8 16c3-3 6-5 9-6" /></>);
    case "elastaan": return wrap(<><path d="M5 6c3-3 5 3 7 0s4-3 7 0M5 12c3-3 5 3 7 0s4-3 7 0M5 18c3-3 5 3 7 0s4-3 7 0" /></>);
    case "nylon": return wrap(<path d="M12 4 19 8 19 16 12 20 5 16 5 8Z" />);
    case "acryl": return wrap(<><path d="M12 3c4 5 6 8 6 11a6 6 0 1 1-12 0c0-3 2-6 6-11Z" /><path d="M9 15h6" /></>);
    default: return wrap(<><circle cx="12" cy="12" r="8" /><path d="M8 14c2-4 6-4 8 0" /></>);
  }
}

export function MaterialBlock({ composition, fallback }: { composition: Composition[]; fallback?: string }) {
  const rows = composition.length
    ? composition
    : fallback
      ? [{ pct: 100, material: fallback }]
      : [];
  if (!rows.length) return null;
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-3">
          <MaterialSymbol cat={materialCategory(r.material)} />
          <span className="font-sans text-sm text-ink">
            {composition.length ? <strong className="font-medium">{r.pct}%</strong> : null} {r.material}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CareBlock({ items, prose }: { items: CareItem[]; prose: string[] }) {
  if (!items.length && !prose.length) return null;
  return (
    <div>
      <ul className="space-y-3">
        {items.map((c) => (
          <li key={c.key} className="flex items-center gap-3">
            <CareSymbol k={c.key} />
            <span className="font-sans text-sm text-ink">{c.label}</span>
          </li>
        ))}
      </ul>
      {prose.length ? (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer list-none font-sans text-sm text-ink underline underline-offset-4">Meer informatie</summary>
          <div className="mt-3 space-y-2 font-sans text-sm leading-relaxed text-ink-soft">
            {prose.slice(0, 6).map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
