import Image from "next/image";
import Link from "next/link";

/** Unie van de twee bronnen (titel-groepering + group_data-metafield). */
export type SiblingItem = {
  handle: string;
  colorName: string;
  imageUrl: string;
  isCurrent: boolean;
  inStock?: boolean;
};

export function ColorSiblings({ siblings }: { siblings: SiblingItem[] }) {
  if (!siblings.length) return null;
  const current = siblings.find((s) => s.isCurrent);
  return (
    <div>
      <p className="font-sans text-sm">
        <span className="text-muted">Kleur: </span>
        <span className="font-medium">{current?.colorName || "Deze kleur"}</span>
        <span className="text-muted"> · {siblings.length} kleuren</span>
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {siblings.map((s) => {
          const soldOut = s.inStock === false;
          if (s.isCurrent) {
            return (
              <li key={s.handle}>
                <span
                  aria-current="true"
                  title={s.colorName}
                  className="block h-16 w-12 overflow-hidden rounded-card border-2 border-ink"
                >
                  {s.imageUrl ? <RelImage url={s.imageUrl} alt={s.colorName} /> : null}
                </span>
              </li>
            );
          }
          return (
            <li key={s.handle}>
              <Link
                href={`/products/${s.handle}`}
                title={soldOut ? `${s.colorName} — tijdelijk uitverkocht` : s.colorName}
                aria-label={`Bekijk in ${s.colorName}`}
                className={`relative block h-16 w-12 overflow-hidden rounded-card border border-line transition-colors hover:border-ink ${
                  soldOut ? "opacity-50" : ""
                }`}
              >
                {s.imageUrl ? <RelImage url={s.imageUrl} alt={s.colorName} /> : null}
                {soldOut ? (
                  <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[0.55rem] text-canvas">
                    uitverkocht
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RelImage({ url, alt }: { url: string; alt: string }) {
  return (
    <span className="relative block h-full w-full">
      <Image src={url} alt={alt} fill sizes="48px" className="object-cover" />
    </span>
  );
}
