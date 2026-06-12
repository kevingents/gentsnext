import pages from "@/content/migrated-pages.json";

export type MigratedPage = { title: string; html: string };

const MAP = pages as Record<string, MigratedPage>;

export function getMigratedPage(handle: string): MigratedPage | null {
  return MAP[handle] ?? null;
}

export function migratedHandles(): string[] {
  return Object.keys(MAP);
}
