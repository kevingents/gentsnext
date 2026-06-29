module.exports = {
  titleSub: "Hoe de nieuwe website, kassa, handscanner, voorraad en portal samen één eigen platform vormen.",
  sections: [
    { key: "architectuur", title: "Architectuur — alles met elkaar verbonden",
      headline: "Drie eigen systemen op één centrale database — geen platform-afhankelijkheid.",
      bullets: ["Placeholder bullet één met wat tekst erin", "Placeholder bullet twee", "Placeholder bullet drie", "Placeholder bullet vier", "Placeholder bullet vijf"],
      stats: [{ value: "3", label: "eigen systemen" }, { value: "1", label: "database (Neon)" }, { value: "0", label: "platform-lock-in" }],
      connects: "De site, kassa en handscanner schrijven allemaal naar dezelfde voorraad-core." },
    { key: "voorraad", title: "Voorraadbeheer",
      headline: "Nooit meer overselllen, minder derving, volledige controle.",
      bullets: ["Placeholder bullet één", "Placeholder bullet twee", "Placeholder bullet drie", "Placeholder bullet vier"],
      stats: [{ value: "F1–F4", label: "goederenontvangst" }, { value: "AQL", label: "slimme steekproef" }],
      connects: "Voedt de beschikbaarheid op de site én de handscanner." },
  ],
  closing: {
    headline: "Eén eigen, slim platform — sneller, veiliger en minder afhankelijk.",
    pillars: [{ k: "Eigen regie", v: "Geen Shopify-lock-in; alles in eigen beheer." }, { k: "Slim", v: "AI + automatisering door de hele keten." }, { k: "Betrouwbaar", v: "Anti-oversell, idempotent, beveiligd." }],
    status: "Status: kern live op gentsnext.vercel.app · go-live = enkele env-schakelaars.",
  },
};
