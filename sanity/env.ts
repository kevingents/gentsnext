export const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "";
export const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
export const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-10-01";

/** Of Sanity geconfigureerd is. Zo niet → de site valt terug op statische content. */
export const sanityConfigured = Boolean(projectId);
