/**
 * Rendert een JSON-LD structured-data blok (Product, BreadcrumbList, ...).
 * De JSON wordt in een <script>-tag geïnjecteerd, dus we escapen de tekens die
 * uit de tag kunnen breken (`</script>`) of een JS-parser kunnen verwarren:
 * < (0x3C) > (0x3E) & (0x26) en de line/paragraph separators U+2028/U+2029.
 * Zonder deze escaping is een reviewtekst met `</script>...` een stored-XSS op
 * elke pagina met JSON-LD.
 */
function safeJsonLd(data: Record<string, unknown>): string {
  const s = JSON.stringify(data);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x3c || c === 0x3e || c === 0x26 || c === 0x2028 || c === 0x2029) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else {
      out += s[i];
    }
  }
  return out;
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
