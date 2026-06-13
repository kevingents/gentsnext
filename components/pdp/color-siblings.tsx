import Link from "next/link";
import { colorSwatch } from "@/lib/colors";

/** Unie van de twee bronnen (titel-groepering + group_data-metafield). */
export type SiblingItem = {
  handle: string;
  colorName: string;
  imageUrl: string;
  isCurrent: boolean;
  inStock?: boolean;
};

/**
 * Kleurkeuze als RECHTE BALK (geen rondje) — elke kleur een segment, klikbaar
 * naar dat product. Huidige kleur gemarkeerd, uitverkochte kleuren gedimd.
 */
export function ColorSiblings({ siblings }: { siblings: SiblingItem[] }) {
  if (!siblings.length) return null;
  const current = siblings.find((s) => s.isCurrent);

  return (
    <div>
      <p className="font-sans text-sm">
        <span className="text-muted">Kleur: </span>
        <span className="font-medium">{current?.colorName || "Deze kleur"}</span>
        {siblings.length > 1 ? <span className="text-muted"> · {siblings.length} beschikbaar</span> : null}
      </p>

      <div className="mt-2 flex h-9 w-full overflow-hidden rounded-card border border-line">
        {siblings.map((s) => {
          const sw = colorSwatch(s.colorName);
          const soldOut = s.inStock === false;
          const style = { background: sw.gradient ?? sw.hex };
          if (s.isCurrent) {
            return (
              <span
                key={s.handle}
                title={s.colorName}
                aria-current="true"
                className="relative flex-1 ring-2 ring-ink ring-inset"
                style={style}
              />
            );
          }
          return (
            <Link
              key={s.handle}
              href={`/products/${s.handle}`}
              title={soldOut ? `${s.colorName} — uitverkocht` : s.colorName}
              aria-label={`Bekijk in ${s.colorName}`}
              className={`relative flex-1 transition-opacity hover:opacity-80 ${soldOut ? "opacity-40" : ""}`}
              style={style}
            >
              {soldOut ? <span className="absolute inset-0 flex items-center justify-center text-[0.6rem] text-canvas/90">✕</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
