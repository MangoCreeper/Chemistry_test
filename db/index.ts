import { getDatabase } from "@netlify/database";
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.ts";

function connectDatabase() { return drizzle({ client: getDatabase(), schema }); }
let database: ReturnType<typeof connectDatabase> | undefined;

export function getDb() {
  database ??= connectDatabase();
  return database;
}
