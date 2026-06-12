import { put } from "@vercel/blob";

/**
 * Schrijft een JSON-blob compatibel met storegents/lib/json-blob-store.js:
 * zelfde pad, public access, allowOverwrite, JSON pretty-printed, korte CDN-TTL.
 *
 * BELANGRIJK: storegents leest uit zijn EIGEN blob-store. Om daarheen te
 * schrijven moet STOREGENTS_BLOB_READ_WRITE_TOKEN gezet zijn (het
 * BLOB_READ_WRITE_TOKEN van het storegents-Vercel-project). Zonder die env
 * valt dit terug op de eigen store van dit project (alleen nuttig voor test).
 */
export async function writeJsonBlobCompat(path: string, value: unknown) {
  const token =
    process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "Geen blob-token: zet STOREGENTS_BLOB_READ_WRITE_TOKEN (token van het " +
        "storegents-project) of BLOB_READ_WRITE_TOKEN in de environment."
    );
  }
  return put(path, JSON.stringify(value, null, 2), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 30,
    token,
  });
}
