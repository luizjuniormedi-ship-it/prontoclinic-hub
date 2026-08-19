import process from "node:process";
import { loadEnv } from "vite";

const expectedOrigin = process.argv[2] || null;
const env = loadEnv("production", process.cwd(), "");

function requireHttps(name, value) {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  return url.origin;
}

const supabaseOrigin = requireHttps("VITE_SUPABASE_URL", env.VITE_SUPABASE_URL);
if (expectedOrigin && supabaseOrigin !== expectedOrigin) {
  throw new Error("VITE_SUPABASE_URL must equal the canonical production origin");
}

if (env.VITE_APP_URL) {
  const appOrigin = requireHttps("VITE_APP_URL", env.VITE_APP_URL);
  if (expectedOrigin && appOrigin !== expectedOrigin) {
    throw new Error("VITE_APP_URL must equal the canonical production origin");
  }
}

console.log("Production frontend environment is HTTPS-only.");
