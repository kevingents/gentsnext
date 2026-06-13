import { defineType, defineField, defineArrayMember } from "sanity";

/**
 * Hoofdmenu — volledig bewerkbaar in de Studio (hufterproof). Sleep onderdelen,
 * kolommen en links om de volgorde te wijzigen. Leeg laten = de standaard uit
 * de code wordt gebruikt.
 */
export const navigationType = defineType({
  name: "navigation",
  title: "Menu (bovenbalk)",
  type: "document",
  fields: [
    defineField({
      name: "items",
      title: "Menu-onderdelen",
      description: "De groepen in de bovenbalk (Nieuw, Kleding, …). Sleep om de volgorde te wijzigen.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "menuItem",
          title: "Onderdeel",
          fields: [
            defineField({ name: "label", title: "Naam", type: "string", validation: (r) => r.required() }),
            defineField({
              name: "href",
              title: "Directe link (optioneel)",
              type: "string",
              description: "Vul een link in voor een gewone knop (bv. /collections/sale). Laat leeg als dit onderdeel een uitklapmenu met kolommen toont.",
            }),
            defineField({
              name: "columns",
              title: "Kolommen (uitklapmenu)",
              description: "Elke kolom is een groepje links. Laat leeg voor een directe knop.",
              type: "array",
              of: [
                defineArrayMember({
                  type: "object",
                  name: "column",
                  title: "Kolom",
                  fields: [
                    defineField({ name: "title", title: "Kop", type: "string", description: "Bv. Pakken & colberts." }),
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
                            defineField({ name: "href", title: "Link", type: "string", description: "Bv. /collections/pakken", validation: (r) => r.required() }),
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
            defineField({
              name: "feature",
              title: "Sfeerfoto (optioneel)",
              description: "Een foto-tegel rechts in het uitklapmenu.",
              type: "object",
              fields: [
                defineField({ name: "image", title: "Afbeelding", type: "image", options: { hotspot: true } }),
                defineField({ name: "caption", title: "Bovenschrift", type: "string", description: "Klein label, bv. Net binnen." }),
                defineField({ name: "label", title: "Titel", type: "string", description: "Grote tekst, bv. Nieuwe collectie." }),
                defineField({ name: "href", title: "Link", type: "string" }),
              ],
            }),
          ],
          preview: { select: { title: "label", subtitle: "href" } },
        }),
      ],
    }),
  ],
  preview: { prepare: () => ({ title: "Hoofdmenu (bovenbalk)" }) },
});
