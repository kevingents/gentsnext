import type { Config } from "tailwindcss";

/**
 * GENTS design-tokens — afgeleid van het brandbook v2.0.
 *
 * Kleurrollen (semantisch, niet "navy-700"): de UI gebruikt alleen deze rollen
 * zodat de huisstijl op één plek leeft.
 *   ink        #0A0A0A  hoofdtekst / knoppen (near-black i.p.v. puur zwart voor zachtere editorial uitstraling)
 *   ink-soft   #2C2C2C  secundaire tekst (brandbook donkergrijs)
 *   muted      #767676  tertiaire tekst, iconen (donker genoeg voor WCAG AA 4.5:1 op wit)
 *   line       #E6E4DF  subtiele borders/dividers
 *   canvas     #FFFFFF  pagina-achtergrond
 *   surface    #F6F5F2  sectie-achtergrond (warme off-white)
 *   navy       #1A1A2E  premium-accent (smoking/luxe lijn)
 *   gold       #C9A14A  VIP/exclusief — spaarzaam (brandbook #D4AF37, iets gedempt voor web-contrast)
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0A0A0A", soft: "#2C2C2C" },
        // #767676 haalt WCAG AA (4.5:1) op wit — voor tellingen, prijs-fineprint,
        // "In X kleuren", zoek-metadata die eerder op #8B8B8B (~3.4:1) stonden.
        muted: "#767676",
        line: "#E6E4DF",
        canvas: "#FFFFFF",
        surface: "#F6F5F2",
        navy: { DEFAULT: "#1A1A2E", soft: "#2A2A44" },
        gold: { DEFAULT: "#C9A14A", soft: "#E4D2A6" },
        // Back-office (portal-huisstijl, los van de storefront): navy/cream/slate.
        pnavy: { DEFAULT: "#0a1f33", 50: "#eef2f6", 100: "#d4dde6", 600: "#13314d", 700: "#0e2740", 800: "#0a1f33", 900: "#071521" },
        pslate: "#3a4a5a",
        pcream: "#f5f5f2",
        cream: "#f5f5f2", // lichte tekst/akcenten op de navy sidebar (portal-huisstijl)
        // Statuskleuren (functioneel, niet merk) — bewust ingetogen.
        success: "#2F6F4E",
        danger: "#9B2C2C",
      },
      fontFamily: {
        // Gevuld via next/font CSS-variabelen (zie app/layout.tsx).
        display: ["var(--font-display)", "Source Sans 3", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "Montserrat", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Editorial type-schaal.
        "display-xl": ["clamp(2.75rem, 6vw, 4.5rem)", { lineHeight: "1.02", letterSpacing: "-0.02em" }],
        "display-lg": ["clamp(2rem, 4vw, 3rem)", { lineHeight: "1.05", letterSpacing: "-0.015em" }],
        "display-md": ["clamp(1.5rem, 2.5vw, 2rem)", { lineHeight: "1.1", letterSpacing: "-0.01em" }],
      },
      letterSpacing: {
        brand: "0.28em", // voor het GENTS-woordmerk en kleine labels
      },
      spacing: {
        gutter: "clamp(1rem, 4vw, 4rem)", // horizontale paginamarge
      },
      maxWidth: {
        page: "88rem", // 1408px — brede editorial container
      },
      borderRadius: {
        // Formele uitstraling: weinig ronding.
        card: "2px",
        control: "2px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(10 10 10 / 0.04), 0 8px 24px -16px rgb(10 10 10 / 0.18)",
        portal: "0 1px 2px 0 rgb(10 31 51 / 0.04), 0 1px 3px 0 rgb(10 31 51 / 0.08)",
        drawer: "-8px 0 32px -12px rgb(10 10 10 / 0.25)",
        pop: "0 12px 40px -12px rgb(10 10 10 / 0.28)",
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
