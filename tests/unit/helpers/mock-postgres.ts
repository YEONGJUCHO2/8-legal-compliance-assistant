import type { Sql } from "postgres";

type QueryHandler = (query: string, params: unknown[]) => Promise<unknown[]> | unknown[];

function normalizeQuery(query: string) {
  return query.replace(/\s+/g, " ").trim();
}

export function createMockSql(handlers: QueryHandler[] = []) {
  const calls: Array<{
    query: string;
    params: unknown[];
  }> = [];

  const sql = ((() => {
    throw new Error("mock sql only supports unsafe()");
  }) as unknown) as Sql;

  sql.unsafe = (async (query: string, params: unknown[] = []) => {
    const normalized = normalizeQuery(query);
    calls.push({
      query: normalized,
      params
    });

    const handler = handlers.shift();

    if (!handler) {
      return [];
    }

    return handler(normalized, params);
  }) as Sql["unsafe"];

  sql.begin = (((first: string | ((transaction: Sql) => unknown), second?: (transaction: Sql) => unknown) => {
    const callback = typeof first === "function" ? first : second;

    if (!callback) {
      throw new Error("mock sql requires a transaction callback");
    }

    return Promise.resolve(callback(sql));
  }) as unknown) as Sql["begin"];

  return {
    sql,
    calls,
    push(handler: QueryHandler) {
      handlers.push(handler);
    }
  };
}
