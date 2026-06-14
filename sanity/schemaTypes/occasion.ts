import { defineType, defineField, defineArrayMember } from "sanity";

/**
 * Gelegenheid (bruiloft, gala, zakelijk, …) — bewerkbaar in de Studio. Elke
 * gelegenheid verschijnt als kaart op /gelegenheden met een sfeerfoto en
 * shop-links. Leeg laten = de standaard uit de code wordt gebruikt.
 */
export const occasionType = defineType({
  name: "occasion",
  title: "Gelegenheid",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Titel", type: "string", validation: (r) => r.required() }),
    defineField({ name: "slug", title: "Slug", type: "slug", options: { source: "title" }, validation: (r) => r.required() }),
    defineField({ name: "eyebrow", title: "Bovenschrift", type: "string", description: "Klein label boven de titel, bv. Voor de grote dag." }),
    defineField({ name: "intro", title: "Introtekst", type: "text", rows: 3 }),
    defineField({ name: "image", title: "Sfeerfoto", type: "image", options: { hotspot: true } }),
    defineField({ name: "ctaLabel", title: "Knoptekst", type: "string", description: "Bv. Shop trouwpakken." }),
    defineField({ name: "ctaHref", title: "Knop-link", type: "string", description: "Bv. /collections/trouwen." }),
    defineField({
      name: "links",
      title: "Snelkoppelingen",
      description: "Extra links onder de kaart.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "link",
          fields: [
            defineField({ name: "label", title: "Naam", type: "string", validation: (r) => r.required() }),
            defineField({ name: "href", title: "Link", type: "string", validation: (r) => r.required() }),
          ],
          preview: { select: { title: "label", subtitle: "href" } },
        }),
      ],
    }),
    defineField({ name: "order", title: "Volgorde", type: "number", description: "Lager = eerder." }),
  ],
  preview: { select: { title: "title", subtitle: "eyebrow", media: "image" } },
});
