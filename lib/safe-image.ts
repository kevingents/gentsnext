/**
 * Beeld-URL's die next/image daadwerkelijk aankan.
 *
 * Waarom dit bestaat: de publieke pagina's renderen een beheerd beeldveld met
 * <Image src={…}>. next/image GOOIT tijdens het renderen een fout zodra de host
 * niet in `images.remotePatterns` van next.config.mjs staat, of zodra een pad
 * niet met "/" begint. Er is geen error-boundary omheen, dus één verkeerd
 * ingetikte waarde in de studio zet de hele publieke pagina op 500. Daarom hier
 * dezelfde regel als in next.config.mjs — server-side bij het opslaan én
 * client-side in de editor, zodat de beheerder het vóór het opslaan ziet.
 *
 * Let op: houd deze lijst gelijk aan `images.remotePatterns` in next.config.mjs.
 */
const REMOTE_HOSTS: RegExp[] = [
  /^cdn\.shopify\.com$/i,
  /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i,
];

export function isSafeImageSrc(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return true; // leeg = geen beeld; de site kiest zelf een terugval
  // "//host/pad" is protocol-relatief: next/image ziet dat niet als lokaal pad.
  if (v.startsWith("//")) return false;
  if (v.startsWith("/")) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && REMOTE_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Uitleg voor de beheerder — één tekst, overal dezelfde. */
export const IMAGE_HINT =
  'Beeld moet een pad in /public zijn (begint met "/") of een https-adres op cdn.shopify.com of *.public.blob.vercel-storage.com. Een ander adres laat de publieke pagina crashen.';
