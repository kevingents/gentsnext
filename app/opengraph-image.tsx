import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default Open Graph-afbeelding voor de hele site (homepage en pages zonder eigen OG). */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0A0A0A",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", letterSpacing: "0.34em", fontSize: 28, fontWeight: 300 }}>
          GENTS
        </div>
        <div>
          <div style={{ fontSize: 28, color: "#C9C7C2", letterSpacing: "0.28em", textTransform: "uppercase" }}>
            — Suits You —
          </div>
          <div style={{ fontSize: 72, fontWeight: 300, marginTop: 12, lineHeight: 1.05, maxWidth: 900 }}>
            Perfect gekleed voor elk formeel moment
          </div>
          <div style={{ fontSize: 26, color: "#C9C7C2", marginTop: 18 }}>
            Pakken · overhemden · smoking · accessoires
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
