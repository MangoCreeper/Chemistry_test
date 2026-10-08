import { sql } from "drizzle-orm";

export function parameterizedQuery(query: string, values: (string | number | null)[]) {
  const fragments = query.split("?");
  if (fragments.length !== values.length + 1) throw new Error("数据库参数数量不匹配");
  return sql.join(fragments.flatMap((fragment, index) => index < values.length
    ? [sql.raw(fragment), sql`${values[index]}`]
    : [sql.raw(fragment)]), sql.raw(""));
}
