// Herbruikbare deck-helpers voor de GENTS MT-presentatie (visueel, diagram-first).
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");

// ── GENTS-palet (premium menswear: diep navy + champagne-goud accent) ──
const C = {
  navy: "16243F", navy2: "21345A", ink: "1E293B", slate: "667488",
  mist: "EEF2F8", card: "FFFFFF", gold: "B7935A", goldSoft: "F1E8D6",
  line: "D6DEEA", emerald: "2F8F6B", emeraldSoft: "E3F1EB",
  amber: "B7791F", amberSoft: "FBF1DD", red: "B4453C", redSoft: "FBE7E7",
  sky: "31628F", skySoft: "E5EEF6",
};

const _cache = {};
async function icon(IconComponent, color = "#B7935A", size = 240) {
  const key = (IconComponent.name || "x") + color + size;
  if (_cache[key]) return _cache[key];
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(IconComponent, { color, size: String(size) }));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return (_cache[key] = "image/png;base64," + png.toString("base64"));
}

const shadow = (opacity = 0.12, blur = 8, offset = 2, angle = 90) => ({ type: "outer", color: "16243F", blur, offset, angle, opacity });

module.exports = { C, icon, shadow };
