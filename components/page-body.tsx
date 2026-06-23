import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Lichte, veilige Markdown-render voor content-pagina's (content:pages).
 * Géén dangerouslySetInnerHTML — alles wordt naar React-nodes geparsed, dus
 * geen HTML-injectie. Ondersteund: # / ## koppen, - lijsten, alinea's,
 * **vet** en [tekst](url)-links (alleen interne /… of https://-links).
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[2].trim();
      const safe = href.startsWith("/") || href.startsWith("https://") || href.startsWith("mailto:") || href.startsWith("tel:");
      nodes.push(safe ? <Link key={`${keyPrefix}${i}`} href={href} className="text-ink underline underline-offset-2 hover:opacity-70">{m[1]}</Link> : m[1]);
    } else if (m[3]) {
      nodes.push(<strong key={`${keyPrefix}${i}`}>{m[3]}</strong>);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function PageBody({ body }: { body: string }) {
  const blocks = String(body || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4 font-sans leading-relaxed text-ink-soft">
      {blocks.map((b, i) => {
        if (b.startsWith("### ")) return <h3 key={i} className="mt-2 font-display text-lg text-ink">{inline(b.slice(4), `${i}-`)}</h3>;
        if (b.startsWith("## ")) return <h2 key={i} className="mt-4 font-display text-xl text-ink">{inline(b.slice(3), `${i}-`)}</h2>;
        if (b.startsWith("# ")) return <h2 key={i} className="mt-4 font-display text-2xl text-ink">{inline(b.slice(2), `${i}-`)}</h2>;
        if (/^[-*] /.test(b)) {
          const lis = b.split(/\n/).filter((l) => /^[-*] /.test(l.trim())).map((l) => l.trim().replace(/^[-*] /, ""));
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lis.map((l, j) => <li key={j}>{inline(l, `${i}-${j}-`)}</li>)}
            </ul>
          );
        }
        return <p key={i}>{inline(b, `${i}-`)}</p>;
      })}
    </div>
  );
}
