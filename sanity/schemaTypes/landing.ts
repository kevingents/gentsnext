import { defineType, defineField, defineArrayMember } from "sanity";

/** Storytelling-landingspagina per gelegenheid (zakelijk, trouwen, uitvaart, …). */
export const landingType = defineType({
  name: "landing",
  title: "Landingspagina",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Titel", type: "string", validation: (r) => r.required() }),
    defineField({
      name: "slug",
      title: "URL (slug)",
      type: "slug",
      description: "Komt op /pages/<slug>. Bv. zakelijk, uitvaartkleding.",
      options: { source: "title", maxLength: 96 },
      validation: (r) => r.required(),
    }),
    defineField({ name: "eyebrow", title: "Bovenkopje", type: "string" }),
    defineField({ name: "intro", title: "Introtekst", type: "text", rows: 4 }),
    defineField({
      name: "heroImage",
      title: "Hero-afbeelding",
      type: "image",
      options: { hotspot: true },
    }),
    defineField({
      name: "sections",
      title: "Secties",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "section",
          fields: [
            defineField({ name: "title", title: "Kop", type: "string" }),
            defineField({ name: "body", title: "Tekst", type: "text", rows: 4 }),
            defineField({ name: "image", title: "Afbeelding (optioneel)", type: "image", options: { hotspot: true } }),
          ],
          preview: { select: { title: "title", subtitle: "body" } },
        }),
      ],
    }),
    defineField({
      name: "shop",
      title: "Shop-links",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "link",
          fields: [
            defineField({ name: "label", title: "Label", type: "string" }),
            defineField({ name: "href", title: "Link", type: "string", description: "Bv. /collections/pakken" }),
          ],
          preview: { select: { title: "label", subtitle: "href" } },
        }),
      ],
    }),
    defineField({ name: "ctaLabel", title: "Knop-tekst", type: "string" }),
    defineField({ name: "ctaHref", title: "Knop-link", type: "string" }),
    defineField({ name: "seoDescription", title: "SEO-omschrijving", type: "text", rows: 2 }),
  ],
  preview: { select: { title: "title", subtitle: "slug.current" } },
});
