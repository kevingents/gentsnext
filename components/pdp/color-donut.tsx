import Link from "next/link";
import { colorSwatch } from "@/lib/colors";
import type { SiblingItem } from "@/components/pdp/color-siblings";

/**
 * "Beschikbare kleuren"-donut (Mr Marvis-stijl, eigen GENTS-twist). Elk segment
 * is een kleurvariant; klik = naar dat product. Het huidige product is gemarkeerd.
 */
export function ColorDonut({ siblings }: { siblings: SiblingItem[] }) {
  if (siblings.length < 3) return null;
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 100;
  const rInner = 62;
  const n = siblings.length;
  const gap = 2; // graden tussen segmenten

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label={`${n} beschikbare kleuren`}>
        {siblings.map((s, i) => {
          const start = (i / n) * 360 + gap / 2;
          const end = ((i + 1) / n) * 360 - gap / 2;
          const sw = colorSwatch(s.colorName);
          const path = donutSegment(cx, cy, rInner, rOuter, start, end);
          return (
            <Link key={s.handle} href={`/products/${s.handle}`} aria-label={`Bekijk in ${s.colorName}`}>
              <path
                d={path}
                fill={sw.hex}
                stroke={s.isCurrent ? "var(--color-ink, #0A0A0A)" : "#ffffff"}
                strokeWidth={s.isCurrent ? 3 : 1.5}
                className="transition-opacity hover:opacity-80"
              >
                <title>{s.colorName}</title>
              </path>
            </Link>
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-ink font-sans" style={{ fontSize: 13, fontWeight: 500 }}>
          Beschikbare
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-ink font-sans" style={{ fontSize: 13, fontWeight: 500 }}>
          kleuren
        </text>
      </svg>
      <p className="mt-1 font-sans text-xs text-muted">{n} kleuren · klik om te wisselen</p>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSegment(cx: number, cy: number, rInner: number, rOuter: number, startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, startDeg);
  const o2 = polar(cx, cy, rOuter, endDeg);
  const i2 = polar(cx, cy, rInner, endDeg);
  const i1 = polar(cx, cy, rInner, startDeg);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i1.x} ${i1.y}`,
    "Z",
  ].join(" ");
}
