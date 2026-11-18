// Dev tool: prints an Argon2id PHC hash matching apps/pos/src-tauri/src/pin.rs's
// verify_pin() params (m=19456, t=3, p=1, v=0x13) — use this for any seed data
// (Postgres users.pin_hash, or local-till seed) that must verify via that Rust command.
// Usage: node scripts/gen-argon2-hash.mjs <plaintext> [<plaintext> ...]
import argon2 from "argon2";

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error("Usage: node scripts/gen-argon2-hash.mjs <plaintext> [<plaintext> ...]");
  process.exit(1);
}

for (const plaintext of inputs) {
  const hash = await argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 3,
    parallelism: 1,
    version: 0x13,
  });
  console.log(`${plaintext} -> ${hash}`);
}
