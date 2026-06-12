/**
 * Basis-URL van de site, defensief opgeschoond: Windows-shells kunnen bij het
 * zetten van env-vars een BOM (U+FEFF) of witruimte meegeven, en `new URL()`
 * crasht daar hard op tijdens de build.
 */
export function getSiteUrl(): string {
  return (process.env.PUBLIC_SITE_URL || "https://gents.nl")
    .replace(/﻿/g, "")
    .trim()
    .replace(/\/+$/, "");
}
