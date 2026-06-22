import type { MetadataRoute } from "next";

/**
 * Web app manifest — favicon/home-screen-icon, naam en kleuren voor "toevoegen aan
 * beginscherm" (PWA). Iconen verwijzen naar de auto-gegenereerde app/icon.png +
 * app/apple-icon.png (officieel GENTS-logo, zie scripts/make-favicon.mjs).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GENTS",
    short_name: "GENTS",
    description: "Premium herenmode voor elk formeel moment.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
