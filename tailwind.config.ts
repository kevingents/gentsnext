import type { Config } from "tailwindcss";

/**
 * GENTS huisstijl-tokens (zelfde set als storeportal_next).
 *   navy  #0a1f33 — primair
 *   slate #3a4a5a — secundaire tekst
 *   cream #f5f5f2 — paginabackground
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
        navy: {
          DEFAULT: "#0a1f33",
          50: "#eef2f6",
          100: "#d4dde6",
          600: "#13314d",
          700: "#0e2740",
          800: "#0a1f33",
          900: "#071521",
        },
        slate: {
          DEFAULT: "#3a4a5a",
        },
        cream: {
          DEFAULT: "#f5f5f2",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(10 31 51 / 0.04), 0 1px 3px 0 rgb(10 31 51 / 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
