import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse client across Next.js dev hot reloads
const globalForSql = globalThis as unknown as {
  sql?: ReturnType<typeof postgres>;
};

// Disable prepared statements because Supabase transaction pooling may route queries across pooled connections
export const sql =
  globalForSql.sql ??
  postgres(connectionString, {
    prepare: false,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForSql.sql = sql;
}