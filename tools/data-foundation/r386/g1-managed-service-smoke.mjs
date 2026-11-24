import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Capability proof for a fresh, local synthetic stack. Never point at a linked project.
const { API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const api = new URL(API_URL);
const db = new URL(DB_URL);
assert.ok(api.protocol === "http:" || api.protocol === "https:");
assert.equal(api.hostname, "127.0.0.1");
assert.equal(db.protocol, "postgresql:");
assert.equal(db.hostname, "127.0.0.1");
assert.ok(ANON_KEY && SERVICE_ROLE_KEY && ANON_KEY !== SERVICE_ROLE_KEY);

function sql(input, variables = {}) {
  const args = Object.entries(variables).flatMap(([key, value]) => ["-v", `${key}=${value}`]);
  // psql consumes SQL via stdin so it can safely expand quoted variables.
  return execFileSync("psql", ["-XqAtw", "-v", "ON_ERROR_STOP=1", ...args], {
    input, encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: db.hostname, PGPORT: db.port, PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
      PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: "disable",
    },
  }).trim();
}

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const client = key => createClient(api.href, key, options);
const service = client(SERVICE_ROLE_KEY);
const bucket = "r386-g1-smoke";
const file = "sample.txt";
const payload = "NOOR R386 synthetic Storage object";

async function checked(label, operation) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.code ?? error.status ?? error.name}`);
  return data;
}

async function makeUser(label) {
  const email = `${label}-${randomUUID()}@example.invalid`;
  const password = `Synthetic-${randomUUID()}-a1!`;
  const { user } = await checked("Auth create user", service.auth.admin.createUser({ email, password, email_confirm: true }));
  return { email, password, id: user.id };
}

async function signIn(user) {
  const device = client(ANON_KEY);
  const { session } = await checked("Auth password sign-in", device.auth.signInWithPassword({
    email: user.email, password: user.password,
  }));
  assert.equal((await checked("Auth getUser", device.auth.getUser())).user.id, user.id);
  return { device, session };
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let pending = 0;
  const bytes = [];
  for (const character of secret.replace(/=+$/u, "")) {
    const digit = alphabet.indexOf(character);
    assert.ok(digit >= 0);
    pending = (pending << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((pending >>> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

assert.equal(sql("SELECT current_setting('server_version_num')::integer / 10000;"), "17");
assert.equal(sql("SELECT count(*) FROM auth.users;"), "0", "disposable Auth database required");
assert.equal(sql("SELECT count(*) FROM storage.buckets;"), "0", "disposable Storage database required");
sql(`CREATE POLICY r386_g1_smoke_own_object ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id='r386-g1-smoke' AND (storage.foldername(name))[1]=auth.uid()::text)
  WITH CHECK (bucket_id='r386-g1-smoke' AND (storage.foldername(name))[1]=auth.uid()::text);`);

const owner = await makeUser("owner");
const other = await makeUser("other");
const first = await signIn(owner);
const second = await signIn(owner);
const independent = await signIn(other);
assert.notEqual(first.session.refresh_token, second.session.refresh_token);
assert.equal(sql("SELECT count(*) FROM auth.sessions WHERE user_id=:'owner';", { owner: owner.id }), "2");

const { id: factor, totp: enrollment } = await checked("Auth MFA enroll", independent.device.auth.mfa.enroll({ factorType: "totp" }));
const { id: challenge } = await checked("Auth MFA challenge", independent.device.auth.mfa.challenge({ factorId: factor }));
const mfaStarted = Math.floor(Date.now() / 1000);
await checked("Auth MFA verify", independent.device.auth.mfa.verify({ factorId: factor, challengeId: challenge, code: totp(enrollment.secret) }));
const assurance = await checked("Auth MFA assurance", independent.device.auth.mfa.getAuthenticatorAssuranceLevel());
assert.equal(assurance.currentLevel, "aal2");
assert.ok(assurance.currentAuthenticationMethods.some(method => method.method === "totp" && method.timestamp >= mfaStarted));
console.log("R386_G1_REAL_AUTH_TWO_DEVICES_AND_MFA_PASS");

await checked("Storage create private bucket", service.storage.createBucket(bucket, { public: false }));
const ownerPath = `${owner.id}/${file}`;
const otherPath = `${other.id}/${file}`;
const ownerStorage = first.device.storage.from(bucket);
const secondStorage = second.device.storage.from(bucket);
const otherStorage = independent.device.storage.from(bucket);
const adminStorage = service.storage.from(bucket);
await checked("Storage upload by first device", ownerStorage.upload(ownerPath, payload, { contentType: "text/plain" }));
await checked("Storage upload by other owner", otherStorage.upload(otherPath, payload, { contentType: "text/plain" }));
assert.equal(await (await checked("Storage read by second device", secondStorage.download(ownerPath))).text(), payload);
assert.ok((await otherStorage.download(ownerPath)).error, "separate owner must not read the object");
assert.ok((await otherStorage.upload(`${owner.id}/denied.txt`, payload)).error, "separate owner must not write to the folder");
assert.equal(sql("SELECT count(*) FROM storage.objects WHERE bucket_id=:'bucket' AND owner_id=:'owner';", { bucket, owner: owner.id }), "1");
console.log("R386_G1_REAL_STORAGE_OWNER_ISOLATION_PASS");

await checked("Storage delete by service", adminStorage.remove([ownerPath]));
assert.ok((await adminStorage.download(ownerPath)).error, "deleted object remains reachable");
assert.equal(sql("SELECT count(*) FROM storage.objects WHERE bucket_id=:'bucket' AND owner_id=:'owner';", { bucket, owner: owner.id }), "0");

// Reproduce each catalog-verified FK independently against the provider's
// real auth.users table. These disposable fixture rows carry no audit data.
sql(`CREATE SCHEMA r386_g1_fk_smoke;
  CREATE TABLE r386_g1_fk_smoke.admin_account (auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT);
  CREATE TABLE r386_g1_fk_smoke.audit (actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    target_auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT);`);
const ids = { owner: owner.id, other: other.id };
for (const [insert, cleanup] of [
  ["INSERT INTO r386_g1_fk_smoke.admin_account VALUES (:'owner');", "DELETE FROM r386_g1_fk_smoke.admin_account;"],
  ["INSERT INTO r386_g1_fk_smoke.audit VALUES (:'owner', :'other');", "DELETE FROM r386_g1_fk_smoke.audit;"],
  ["INSERT INTO r386_g1_fk_smoke.audit VALUES (:'other', :'owner');", "DELETE FROM r386_g1_fk_smoke.audit;"],
]) {
  sql(insert, ids);
  assert.ok((await service.auth.admin.deleteUser(owner.id, false)).error, "Auth hard-delete passed a RESTRICT FK");
  assert.equal(sql("SELECT count(*) FROM auth.users WHERE id IN (:'owner', :'other');", ids), "2");
  assert.equal(sql("SELECT count(*) FROM auth.sessions WHERE user_id=:'owner';", ids), "2");
  sql(cleanup);
}
console.log("R386_G1_REAL_AUTH_RESTRICT_ALL_THREE_PASS");

await checked("Auth hard-delete", service.auth.admin.deleteUser(owner.id, false));
assert.equal(sql(`SELECT
  (SELECT count(*) FROM auth.users WHERE id=:'owner') +
  (SELECT count(*) FROM auth.identities WHERE user_id=:'owner') +
  (SELECT count(*) FROM auth.sessions WHERE user_id=:'owner') +
  (SELECT count(*) FROM auth.refresh_tokens WHERE user_id=:'owner');`, { owner: owner.id }), "0");
for (const { device, session } of [first, second]) {
  assert.ok((await device.auth.refreshSession({ refresh_token: session.refresh_token })).error);
}
assert.equal((await checked("Other Auth user still exists", independent.device.auth.getUser())).user.id, other.id);
assert.equal(await (await checked("Other Storage object is preserved", otherStorage.download(otherPath))).text(), payload);
console.log("R386_G1_REAL_AUTH_HARD_DELETE_AND_OTHER_OWNER_PRESERVED_PASS");
const remainingAuditReferences = sql(`SELECT count(*) FROM auth.audit_log_entries
  WHERE payload->>'actor_id'=:'owner' OR payload->'traits'->>'user_id'=:'owner';`, { owner: owner.id });
console.log(`R386_G1_MANAGED_AUTH_AUDIT_REFERENCES_AFTER_HARD_DELETE=${remainingAuditReferences}`);
