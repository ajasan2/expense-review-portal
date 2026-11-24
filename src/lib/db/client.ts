import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Disable prepared statements because Supabase transaction pooling may route queries across pooled connections
export const sql = postgres(connectionString, { prepare: false });