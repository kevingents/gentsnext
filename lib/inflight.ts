/**
 * Mini single-flight: dedupliceert gelijktijdige aanroepen van een trage fetch
 * (bv. een Vercel Blob `list()`-call voor een config). Zolang er één in-flight is,
 * krijgen alle gelijktijdige bellers diezelfde promise — i.p.v. dat ze elk hun
 * eigen list() afvuren bij een koude cache. Per-instance (module-scope).
 */
export function singleflight<T>() {
  let p: Promise<T> | null = null;
  return (fn: () => Promise<T>): Promise<T> => {
    if (p) return p;
    p = fn().finally(() => { p = null; });
    return p;
  };
}
