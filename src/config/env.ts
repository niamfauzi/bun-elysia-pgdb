import "dotenv/config";

type NodeEnv = "development" | "test" | "production";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function asNodeEnv(v: string): NodeEnv {
  if (v === "development" || v === "test" || v === "production") return v;
  return "development";
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: asNodeEnv(process.env.NODE_ENV ?? "development"),
  LOG_LEVEL: (process.env.LOG_LEVEL ?? "info") as
    | "fatal"
    | "error"
    | "warn"
    | "info"
    | "debug"
    | "trace",
} as const;
