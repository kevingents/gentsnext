import { defineType, defineField, defineArrayMember } from "sanity";

/**
 * "Shop the look" — gecureerde outfit met een modelfoto en klikbare hotspots.
 * Elke hotspot wijst (via product-handle) naar een product in de catalogus.
 */
export const lookType = defineType({
  name: "look",
  title: "Shop the look",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Titel", type: "string", validation: (r) => r.required() }),
    defineField({
      name: "slug",
      title: "URL (slug)",
      type: "slug",
      description: "Komt op /looks/<slug>.",
      options: { source: "title", maxLength: 96 },
      validation: (r) => r.required(),
    }),
    defineField({ name: "occasion", title: "Gelegenheid", type: "string", description: "Bv. Bruiloft, Zakelijk, Gala." }),
    defineField({ name: "subtitle", title: "Ondertitel", type: "text", rows: 2 }),
    defineField({
      name: "image",
      title: "Modelfoto (met hotspots)",
      type: "image",
      options: { hotspot: true },
      validation: (r) => r.required(),
    }),
    defineField({
      name: "gallery",
      title: "Sfeerbeelden (extra)",
      description: "Extra foto's voor meer sfeer — detail, andere hoek, lifestyle. Verschijnen onder de hoofdfoto.",
      type: "array",
      of: [defineArrayMember({ type: "image", options: { hotspot: true } })],
    }),
    defineField({
      name: "order",
      title: "Volgorde",
      type: "number",
      description: "Lager = eerder in het overzicht.",
      initialValue: 100,
    }),
    defineField({
      name: "hotspots",
      title: "Hotspots",
      description: "Plaats stippen op de foto en koppel een product.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "hotspot",
          fields: [
            defineField({ name: "label", title: "Label", type: "string", description: "Bv. Colbert, Pantalon." }),
            defineField({
              name: "handle",
              title: "Product-handle",
              type: "string",
              description: "Het laatste deel van de product-URL (/products/<handle>).",
              validation: (r) => r.required(),
            }),
            defineField({ name: "x", title: "X-positie (%)", type: "number", validation: (r) => r.min(0).max(100), initialValue: 50 }),
            defineField({ name: "y", title: "Y-positie (%)", type: "number", validation: (r) => r.min(0).max(100), initialValue: 50 }),
          ],
          preview: { select: { title: "label", subtitle: "handle" } },
        }),
      ],
    }),
  ],
  preview: { select: { title: "title", subtitle: "occasion", media: "image" } },
});
