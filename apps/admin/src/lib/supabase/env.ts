type PublicEnvName = "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

// Next.js only inlines NEXT_PUBLIC_* values into client bundles for literal
// `process.env.NAME` references; a dynamic `process.env[name]` lookup is
// undefined in the browser in production builds.
const PUBLIC_ENV: Record<PublicEnvName, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

export function requireEnv(name: PublicEnvName): string {
  const value = PUBLIC_ENV[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}