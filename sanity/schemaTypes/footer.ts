import { defineType, defineField, defineArrayMember } from "sanity";

/**
 * Footer — volledig bewerkbaar in de Studio (hufterproof). Pas de intro-tekst en
 * de link-kolommen aan; sleep om de volgorde te wijzigen. Leeg laten = de
 * standaard uit de code wordt gebruikt. Nieuwsbrief, juridische regel en
 * betaalmethoden blijven in de code (structureel/wettelijk).
 */
export const footerType = defineType({
  name: "footer",
  title: "Footer (onderkant site)",
  type: "document",
  fields: [
    defineField({
      name: "intro",
      title: "Intro-tekst (naast het logo)",
      type: "text",
      rows: 3,
      description: "Korte omschrijving onder het GENTS-logo. Laat leeg voor de standaardtekst.",
    }),
    defineField({
      name: "columns",
      title: "Link-kolommen",
      description: "Elke kolom is een groepje links (Shoppen, Service, …). Sleep om de volgorde te wijzigen.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "column",
          title: "Kolom",
          fields: [
            defineField({ name: "title", title: "Kop", type: "string", validation: (r) => r.required() }),
            defineField({
              name: "links",
              title: "Links",
              type: "array",
              of: [
                defineArrayMember({
                  type: "object",
                  name: "link",
                  fields: [
                    defineField({ name: "label", title: "Naam", type: "string", validation: (r) => r.required() }),
                    defineField({ name: "href", title: "Link", type: "string", description: "Bv. /categorie/pakken", validation: (r) => r.required() }),
                  ],
                  preview: { select: { title: "label", subtitle: "href" } },
                }),
              ],
            }),
          ],
          preview: { select: { title: "title" } },
        }),
      ],
    }),
  ],
  preview: { prepare: () => ({ title: "Footer (onderkant site)" }) },
});
