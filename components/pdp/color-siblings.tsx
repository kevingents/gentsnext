import Image from "next/image";
import Link from "next/link";
import type { ColorSibling } from "@/lib/color-siblings";

export function ColorSiblings({ siblings }: { siblings: ColorSibling[] }) {
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
        {siblings.map((s) => (
          <li key={s.handle}>
            {s.isCurrent ? (
              <span
                aria-current="true"
                title={s.colorName}
                className="block h-16 w-12 overflow-hidden rounded-card border-2 border-ink"
              >
                {s.imageUrl ? <RelImage url={s.imageUrl} alt={s.colorName} /> : null}
              </span>
            ) : (
              <Link
                href={`/products/${s.handle}`}
                title={s.colorName}
                aria-label={`Bekijk in ${s.colorName}`}
                className="block h-16 w-12 overflow-hidden rounded-card border border-line transition-colors hover:border-ink"
              >
                {s.imageUrl ? <RelImage url={s.imageUrl} alt={s.colorName} /> : null}
              </Link>
            )}
          </li>
        ))}
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
