/**
 * Env-loader voor losse scripts (npm run import:* / cache:publish).
 * Next.js laadt .env.local zelf; tsx-scripts niet — vandaar deze helper.
 * Volgorde: .env.local wint van .env (zelfde semantiek als Next).
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();
