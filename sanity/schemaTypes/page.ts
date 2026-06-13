import { defineType, defineField, defineArrayMember } from "sanity";

/** Algemene content-/servicepagina (service, retourneren, etiquette, juridisch, …). */
export const pageType = defineType({
  name: "page",
  title: "Pagina",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Titel", type: "string", validation: (r) => r.required() }),
    defineField({
      name: "slug",
      title: "URL (slug)",
      type: "slug",
      description: "Komt op /pages/<slug>.",
      options: { source: "title", maxLength: 96 },
      validation: (r) => r.required(),
    }),
    defineField({
      name: "body",
      title: "Inhoud",
      type: "array",
      of: [
        defineArrayMember({ type: "block" }),
        defineArrayMember({ type: "image", options: { hotspot: true } }),
      ],
    }),
    defineField({
      name: "legacyHtml",
      title: "Overgenomen HTML (oude Shopify-content)",
      type: "text",
      rows: 6,
      description:
        "Tijdelijk: gemigreerde HTML uit Shopify. Wordt getoond zolang 'Inhoud' leeg is. Vervang gerust door bewerkbare blokken hierboven.",
    }),
    defineField({ name: "seoDescription", title: "SEO-omschrijving", type: "text", rows: 2 }),
  ],
  preview: { select: { title: "title", subtitle: "slug.current" } },
});
