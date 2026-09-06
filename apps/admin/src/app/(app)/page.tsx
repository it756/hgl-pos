import { requireSessionClaims } from "../../lib/auth/session";

export default async function HomePage() {
  const claims = await requireSessionClaims();

  return (
    <main className="p-md">
      <p className="text-body-lg font-body-lg text-on-surface-variant">
        Signed in as {claims.role ?? "unknown role"}
        {claims.storeId !== null ? ` · store ${claims.storeId}` : ""}.
      </p>
    </main>
  );
}
