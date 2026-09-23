// Creates an admin account SQL statement without the web setup flow.
// Usage: npm run admin:hash -- <email> <name> <password>
// Then:  npx wrangler d1 execute DB --remote --command "<printed SQL>"
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 12) {
  console.error("Usage: npm run admin:hash -- <email> <name> <password (12+ chars)>");
  process.exit(1);
}
const iterations = 100_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
const stored = `pbkdf2_sha256$${iterations}$${salt.toString("hex")}$${hash.toString("hex")}`;
const now = Date.now();
const esc = (value) => value.replace(/'/g, "''");
console.log(
  `INSERT INTO admins (id, email, name, password_hash, role, created_at, updated_at) VALUES ('${randomUUID()}', '${esc(email.toLowerCase())}', '${esc(name)}', '${stored}', 'owner', ${now}, ${now});`,
);
