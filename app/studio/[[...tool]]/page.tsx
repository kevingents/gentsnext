import { sanityConfigured } from "@/sanity/env";
import StudioClient from "./StudioClient";

export const dynamic = "force-static";
export { metadata, viewport } from "next-sanity/studio";

function Setup() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ letterSpacing: "0.28em", textTransform: "uppercase", fontSize: 12, color: "#8B8B8B" }}>
        GENTS — Content
      </p>
      <h1 style={{ fontSize: 30, fontWeight: 300, margin: "8px 0 16px" }}>Sanity nog koppelen</h1>
      <p style={{ color: "#2C2C2C", lineHeight: 1.6 }}>
        De content-studio is gebouwd maar nog niet verbonden met een Sanity-project.
        Zo zet je hem in 5 minuten live:
      </p>
      <ol style={{ color: "#2C2C2C", lineHeight: 1.8, paddingLeft: 20 }}>
        <li>
          Maak gratis een project op <a href="https://sanity.io/manage">sanity.io/manage</a> (dataset:{" "}
          <code>production</code>).
        </li>
        <li>
          Zet in Vercel de variabelen <code>NEXT_PUBLIC_SANITY_PROJECT_ID</code> en
          <code> NEXT_PUBLIC_SANITY_DATASET=production</code>.
        </li>
        <li>
          Voeg in Sanity (Members) je marketeers toe — rol <strong>Administrator</strong> of{" "}
          <strong>Editor</strong> — en stel <code>http://localhost:3000</code> + de Vercel-URL in als CORS-origin.
        </li>
        <li>
          Draai eenmalig <code>npm run sanity:seed</code> om de huidige pagina's en landings te importeren.
        </li>
      </ol>
      <p style={{ color: "#8B8B8B", fontSize: 13, marginTop: 24 }}>
        Tot die tijd toont de website de huidige (statische) content gewoon.
      </p>
    </div>
  );
}

export default function StudioPage() {
  if (!sanityConfigured) return <Setup />;
  return <StudioClient />;
}
