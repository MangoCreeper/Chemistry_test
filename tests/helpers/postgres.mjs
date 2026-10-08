import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";

export async function createDatabase() {
  const database = new PGlite();
  const directory = new URL("../../netlify/database/migrations/", import.meta.url);
  for (const entry of readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((first, second) => first.name.localeCompare(second.name))) {
    await database.exec(readFileSync(new URL(`${entry.name}/migration.sql`, directory), "utf8"));
  }
  return database;
}
