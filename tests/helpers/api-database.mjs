import { drizzle } from "drizzle-orm/pglite";
import { createDatabase } from "./postgres.mjs";

export const database = await createDatabase();
const connection = drizzle({ client: database });
export function getDb() {
  return { execute: async (query) => {
    const result = await connection.execute(query);
    return { rows: result.rows, rowCount: result.affectedRows };
  } };
}
