export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  defaultDatabase: string;
  allowedDatabases: string[];
}

const DEFAULT_ALLOWED_DATABASES = [
  "yinghuochong_recovery_clean_20260608",
  "yinghuochong_recovery_20260608",
  "yinghuochong_local",
];

function readList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadDbConfig(): DbConfig {
  const allowedDatabases = readList(process.env.YHC_ALLOWED_DATABASES);
  const configuredAllowed = allowedDatabases.length > 0 ? allowedDatabases : DEFAULT_ALLOWED_DATABASES;
  const defaultDatabase = process.env.YHC_DEFAULT_DATABASE?.trim() || configuredAllowed[0];

  if (!configuredAllowed.includes(defaultDatabase)) {
    throw new Error(
      `YHC_DEFAULT_DATABASE must be included in YHC_ALLOWED_DATABASES. Got ${defaultDatabase}.`,
    );
  }

  return {
    host: process.env.YHC_DB_HOST || "127.0.0.1",
    port: Number(process.env.YHC_DB_PORT || "3306"),
    user: process.env.YHC_DB_USER || "root",
    password: process.env.YHC_DB_PASSWORD || "",
    defaultDatabase,
    allowedDatabases: configuredAllowed,
  };
}

