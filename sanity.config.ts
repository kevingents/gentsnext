import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./sanity/schemaTypes";
import { projectId, dataset, apiVersion } from "./sanity/env";

/**
 * GENTS Content Studio. Marketeers beheren hier pagina's en landings.
 * Rollen worden in het Sanity-project beheerd (manage.sanity.io → Members):
 * Administrator (volledig) / Viewer (alleen lezen); Editor/Contributor op het
 * Growth-plan. Draait embedded op /studio.
 */
export default defineConfig({
  name: "gents-content",
  title: "GENTS — Content",
  basePath: "/studio",
  projectId: projectId || "placeholder",
  dataset,
  plugins: [structureTool(), visionTool({ defaultApiVersion: apiVersion })],
  schema: { types: schemaTypes },
});
