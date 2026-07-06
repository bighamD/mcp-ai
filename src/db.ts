import mysql, { type Pool } from "mysql2/promise";

import { loadDbConfig, type DbConfig } from "./config.js";

let pool: Pool | undefined;
let cachedConfig: DbConfig | undefined;

export function getDbConfig(): DbConfig {
  cachedConfig ??= loadDbConfig();
  return cachedConfig;
}

export function getPool(): Pool {
  if (!pool) {
    const config = getDbConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 5,
      namedPlaceholders: false,
      dateStrings: true,
    });
  }
  return pool;
}

export function resolveDatabase(database?: string): string {
  const config = getDbConfig();
  const selected = (database || config.defaultDatabase).trim();
  if (!config.allowedDatabases.includes(selected)) {
    throw new Error(
      `Database '${selected}' is not allowed. Allowed databases: ${config.allowedDatabases.join(", ")}`,
    );
  }
  return selected;
}

export function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier '${identifier}'.`);
  }
  return `\`${identifier}\``;
}

export async function queryRows<T>(
  sql: string,
  params: Array<string | number | null | undefined> = [],
): Promise<T[]> {
  const [rows] = await getPool().query(sql, params);
  return rows as T[];
}
