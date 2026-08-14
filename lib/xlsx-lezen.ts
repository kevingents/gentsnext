import { inflateRawSync } from "node:zlib";

/**
 * Leest een .xlsx (of .csv) naar een raster van tekstcellen. ALLEEN LEZEN.
 *
 * Waarom zelfgebouwd en niet `xlsx` of `exceljs`: deze repo heeft acht
 * runtime-dependencies en dat is een keuze. `xlsx` van npm sleept bekende
 * adviesmeldingen mee (de gerepareerde versies staan alleen op hun eigen CDN) en
 * `exceljs` trekt een halve archiefbibliotheek binnen voor iets wat we alleen
 * hoeven te LEZEN. Een xlsx is een zip met XML erin, en `node:zlib` zit al in
 * Node — dit bestand is het hele verschil.
 *
 * Beperkingen, bewust: geen formules (we lezen de opgeslagen waarde), geen
 * datumconversie (maattabellen bevatten geen datums), geen ZIP64 (een maatblad
 * van 4 GB bestaat niet — we geven een nette fout in plaats van rommel).
 *
 * NODE-ONLY (node:zlib). Nooit importeren uit een client component.
 */

/** Rem op onzin-invoer: een maatblad is kilobytes, geen tientallen megabytes. */
const MAX_UITGEPAKT = 40 * 1024 * 1024;
const MAX_ENTRIES = 512;

export type Blad = { naam: string; rijen: string[][] };

/* ─────────────────────────── ZIP (alleen uitpakken) ─────────────────────────── */

type ZipEntry = { naam: string; methode: number; offset: number; compLen: number; rawLen: number };

/**
 * Loopt de central directory af. Die staat áchteraan, dus we zoeken het
 * "end of central directory"-blok van achter naar voren — de zip-spec staat een
 * comment van 64 kB toe achter dat blok, vandaar het zoekvenster.
 */
function leesZipIndex(buf: Buffer): ZipEntry[] {
  const EOCD = 0x06054b50;
  let eocd = -1;
  const ondergrens = Math.max(0, buf.length - 65_557);
  for (let i = buf.length - 22; i >= ondergrens; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Dit is geen geldig xlsx-bestand (geen zip-index gevonden).");

  const aantal = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || aantal === 0xffff) {
    throw new Error("Dit bestand gebruikt ZIP64; sla het opnieuw op als gewone xlsx of als csv.");
  }
  if (aantal > MAX_ENTRIES) throw new Error("Dit xlsx-bestand bevat onwaarschijnlijk veel onderdelen.");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < aantal; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const methode = buf.readUInt16LE(p + 10);
    const compLen = buf.readUInt32LE(p + 20);
    const rawLen = buf.readUInt32LE(p + 24);
    const naamLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const naam = buf.toString("utf8", p + 46, p + 46 + naamLen);
    entries.push({ naam, methode, offset, compLen, rawLen });
    p += 46 + naamLen + extraLen + commentLen;
  }
  return entries;
}

/** Pakt één onderdeel uit naar tekst. Alleen 'stored' (0) en 'deflate' (8). */
function leesEntry(buf: Buffer, e: ZipEntry): string {
  // De lokale header herhaalt de naam- en extra-lengte; de data begint erachter.
  // Die lengtes kunnen afwijken van de central directory, dus lees ze hier.
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) {
    throw new Error(`Onderdeel ${e.naam} staat niet waar de index zegt.`);
  }
  const naamLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + naamLen + extraLen;
  const data = buf.subarray(start, start + e.compLen);
  if (e.rawLen > MAX_UITGEPAKT) throw new Error(`Onderdeel ${e.naam} is te groot om te verwerken.`);
  if (e.methode === 0) return data.toString("utf8");
  if (e.methode === 8) return inflateRawSync(data, { maxOutputLength: MAX_UITGEPAKT }).toString("utf8");
  throw new Error(`Onderdeel ${e.naam} gebruikt een compressie die we niet lezen (${e.methode}).`);
}

/* ─────────────────────────── XML (net genoeg) ─────────────────────────── */

function ontsnap(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // &amp; als laatste, anders wordt "&amp;lt;" alsnog een echte <.
    .replace(/&amp;/g, "&");
}

/**
 * De gedeelde-tekstentabel. Excel zet elke tekstcel hier één keer neer en
 * verwijst er met een index naar. Rijke tekst (opmaak middenin een cel) staat
 * als meerdere <t>-stukken binnen één <si> — die horen aan elkaar geplakt,
 * anders leest "Colberts (Standaard)" als "Colberts (".
 */
function leesSharedStrings(xml: string): string[] {
  const uit: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let tekst = "";
    for (const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) tekst += t[1];
    uit.push(ontsnap(tekst));
  }
  return uit;
}

/** "BC" → 28. Kolomletters zijn base-26 zonder nul. */
function kolomIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/**
 * Eén werkblad naar rijen. Cellen die Excel niet opslaat (leeg) ontbreken in de
 * XML, dus we plaatsen op kolomindex en vullen de gaten — anders schuift een
 * lege cel de hele rij een kolom op en belandt de borstmaat onder taille.
 */
function leesBlad(xml: string, shared: string[]): string[][] {
  const rijen: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rij: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] || "";
      const inhoud = cm[2] || "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] || "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || "";
      let waarde = "";
      if (type === "inlineStr") {
        for (const t of inhoud.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) waarde += t[1];
        waarde = ontsnap(waarde);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inhoud)?.[1] ?? "";
        waarde = type === "s" ? (shared[Number(v)] ?? "") : ontsnap(v);
      }
      const idx = ref ? kolomIndex(ref) : rij.length;
      while (rij.length < idx) rij.push("");
      rij[idx] = waarde.trim();
    }
    rijen.push(rij);
  }
  return rijen;
}

/** Bladnamen in tabblad-volgorde, zodat we kunnen zeggen wélk blad we lazen. */
function leesBladnamen(xml: string): string[] {
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\/?>/g)].map((m) => ontsnap(m[1]));
}

/* ─────────────────────────── Ingang ─────────────────────────── */

/** Alle werkbladen uit een xlsx, in tabblad-volgorde. */
export function leesXlsx(bytes: ArrayBuffer | Buffer | Uint8Array): Blad[] {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as ArrayBuffer);
  const entries = leesZipIndex(buf);
  const pak = (naam: string) => {
    const e = entries.find((x) => x.naam === naam);
    return e ? leesEntry(buf, e) : "";
  };

  const shared = leesSharedStrings(pak("xl/sharedStrings.xml"));
  const namen = leesBladnamen(pak("xl/workbook.xml"));

  // Op bestandsnummer sorteren, niet op zip-volgorde: sheet10 mag niet vóór
  // sheet2 komen te staan en zips garanderen geen ordening.
  const bladen = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.naam))
    .sort((a, b) => Number(a.naam.match(/(\d+)/)![1]) - Number(b.naam.match(/(\d+)/)![1]));
  if (!bladen.length) throw new Error("Dit xlsx-bestand bevat geen werkblad.");

  return bladen.map((e, i) => ({
    naam: namen[i] || `Blad ${i + 1}`,
    rijen: leesBlad(leesEntry(buf, e), shared),
  }));
}

/**
 * Csv naar rijen — voor wie liever "opslaan als csv" doet. Puntkomma én komma
 * als scheidingsteken: Excel op een Nederlandse Windows exporteert puntkomma's,
 * en dat is precies wat hier gebeurt.
 */
export function leesCsv(tekst: string): string[][] {
  const schoon = tekst.replace(/^﻿/, "");
  const eersteRegel = schoon.split(/\r?\n/, 1)[0] || "";
  const scheider = (eersteRegel.match(/;/g)?.length ?? 0) > (eersteRegel.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rijen: string[][] = [];
  let rij: string[] = [];
  let cel = "";
  let inQuote = false;
  for (let i = 0; i < schoon.length; i++) {
    const ch = schoon[i];
    if (inQuote) {
      if (ch === '"') {
        if (schoon[i + 1] === '"') { cel += '"'; i++; }
        else inQuote = false;
      } else cel += ch;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === scheider) { rij.push(cel.trim()); cel = ""; continue; }
    if (ch === "\n") { rij.push(cel.trim()); rijen.push(rij); rij = []; cel = ""; continue; }
    if (ch === "\r") continue;
    cel += ch;
  }
  if (cel || rij.length) { rij.push(cel.trim()); rijen.push(rij); }
  return rijen.filter((r) => r.some((c) => c !== ""));
}
