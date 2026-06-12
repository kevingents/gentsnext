import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit draait buiten Next en laadt .env.local niet zelf.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
