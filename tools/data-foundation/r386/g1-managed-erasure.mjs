// Integration backend for the disposable managed G1 runner. The observer
// connection is the fixture administrator and must never be used in NOOR runtime.
import { randomUUID } from "node:crypto";
import { R386_G1_ERASURE_STORES } from "../../../apps/noor-runtime/dist/noor-r386-g1-permanent-erasure-coordinator.js";

const schema = "noor_r386_candidate";
const jobs = schema + ".g1_managed_erasure_job";
const tombstone = schema + ".g1_owner_erasure_tombstone";
export const G1_ERASURE_BUCKET = "r386-g1-erasure";

const ownerTables = new Map([
  ["admin-accounts", ["public.noor_admin_accounts_r271","auth_user_id","ownerId"]],
  ["task-events", ["public.task_events","user_id","ownerId"]],
  ["tasks", ["public.tasks","user_id","ownerId"]],
  ["habit-entries", ["public.habit_entries","user_id","ownerId"]],
  ["habits", ["public.habits","user_id","ownerId"]],
  ["work-teacher-state", ["public.noor_work_teacher_states_r264","user_id","ownerId"]],
  ["personal-foundation", ["public.noor_personal_foundations","user_id","ownerId"]],
  ["private-journal", ["public.noor_private_journal_entries_r221","owner_user_id","ownerId"]],
  ["candidate-analytics", [schema + ".s4_fact","owner_id","ownerId"]],
  ["candidate-delivery", [schema + ".delivery_outbox","owner_id","ownerId"]],
  ["candidate-events", [schema + ".event_history","owner_id","ownerId"]],
  ["candidate-checkpoint", [schema + ".checkpoint","owner_id","ownerId"]],
  ["candidate-receipts", [schema + ".command_receipt","owner_id","ownerId"]],
  ["candidate-enrollment", [schema + ".s3_enrollment","owner_id","ownerId"]],
  ["candidate-owner", [schema + ".owner_scope","owner_id","ownerId"]],
  ["noor-entitlement-grants", ["public.noor_entitlement_grants","account_id","accountId"]],
  ["noor-sessions", ["public.noor_sessions","account_id","accountId"]],
  ["noor-account-linkages", ["public.noor_authentication_account_linkages","user_id","ownerId"]],
]);

async function transaction(pool, work) {
  const client = await pool.connect();
  let discard = true;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    discard = false;
    return result;
  } finally {
    if (discard) await client.query("ROLLBACK").catch(() => {});
    client.release(discard);
  }
}

const escapeRegex = value => value.replace(/[.*+?^$${}()|[\]\\]/gu, "\\$&");

function redactJson(document, needles) {
  if (typeof document === "string") {
    for (const needle of needles) document = document.replace(new RegExp(escapeRegex(needle), "giu"), "[erased]");
    return document;
  }
  if (Array.isArray(document)) return document.map(value => redactJson(value, needles));
  if (document && typeof document === "object") {
    return Object.fromEntries(Object.entries(document)
      .filter(([key]) => redactJson(key, needles) === key)
      .map(([key, value]) => [key, redactJson(value, needles)]));
  }
  return document;
}

function assertApi(result, label) {
  if (result.error) throw new Error(label);
  return result.data;
}

async function lockedFence(db, ownerId) {
  await db.query("SELECT pg_advisory_xact_lock(386017,hashtext($1))", [ownerId]);
}

function needlesFor(fence, job) {
  return [fence.ownerId, fence.accountId, job.target_email].filter(Boolean);
}

async function readJob(db, fence) {
  const { rows } = await db.query(`SELECT j.* FROM ${jobs} j
    JOIN ${tombstone} t ON t.owner_id=j.target_id::text
    WHERE j.target_id=$1 AND j.erasure_id=$2 AND j.account_id=$3 AND j.completed_at IS NULL`,
  [fence.ownerId, fence.erasureId, fence.accountId]);
  if (rows.length !== 1) throw new Error("R386_G1_ERASURE_FENCE_UNAVAILABLE");
  return rows[0];
}

const hasIdentifier = (document, param) =>
  `EXISTS(SELECT 1 FROM unnest(${param}::text[]) n WHERE strpos(lower(${document}::text),lower(n))>0)`;

async function count(db, query, params) {
  const { rows } = await db.query(query, params);
  const result = Number(rows[0]?.n);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("R386_G1_INVALID_DURABLE_COUNT");
  return result;
}

async function remaining(db, fence, job, store) {
  if (store === "storage-objects") {
    return count(db, "SELECT count(*) AS n FROM storage.objects WHERE owner_id::text=$1 OR (bucket_id=$2 AND name=ANY($3::text[]))",
      [fence.ownerId, G1_ERASURE_BUCKET, job.storage_paths]);
  }
  if (store === "admin-audit") {
    return count(db, `SELECT count(*) AS n FROM public.noor_admin_audit_r271
      WHERE actor_auth_user_id=$1 OR target_auth_user_id=$1 OR ${hasIdentifier("details", "$2")}`,
    [fence.ownerId, needlesFor(fence, job)]);
  }
  const [table, key, source] = ownerTables.get(store);
  return count(db, `SELECT count(*) AS n FROM ${table} WHERE ${key}=$1`, [fence[source]]);
}

async function managedAuthRows(db, fence, job) {
  // Include direct user keys and the captured provider session/factor keys.
  // These results are observed separately from the provider delete response.
  let result = await count(db, "SELECT count(*) AS n FROM auth.users WHERE id=$1", [fence.ownerId]);
  const keys = { user_id: [fence.ownerId], session_id: job.auth_session_ids, factor_id: job.auth_factor_ids };
  const { rows } = await db.query(`SELECT DISTINCT column_name,
      format('%I.%I',table_schema,table_name) AS relation, format('%I',column_name) AS column_sql
    FROM information_schema.columns
    WHERE table_schema='auth' AND column_name IN ('user_id','session_id','factor_id')
      AND data_type IN ('uuid','text','character varying')`);
  for (const row of rows) {
    if (keys[row.column_name].length) result += await count(db,
      `SELECT count(*) AS n FROM ${row.relation} WHERE ${row.column_sql}::text=ANY($1::text[])`, [keys[row.column_name]]);
  }
  return result;
}

async function scrubNoorAudit(db, fence, job) {
  const needles = needlesFor(fence, job);
  const { rows } = await db.query(`SELECT id, actor_auth_user_id, target_auth_user_id, details
    FROM public.noor_admin_audit_r271 WHERE actor_auth_user_id=$1 OR target_auth_user_id=$1
      OR ${hasIdentifier("details","$2")} FOR UPDATE`, [fence.ownerId, needles]);
  for (const row of rows) {
    const actor = row.actor_auth_user_id === fence.ownerId;
    const target = row.target_auth_user_id === fence.ownerId;
    await db.query(`UPDATE public.noor_admin_audit_r271
      SET actor_auth_user_id=CASE WHEN $2 THEN NULL ELSE actor_auth_user_id END,
          target_auth_user_id=CASE WHEN $3 THEN NULL ELSE target_auth_user_id END,
          actor_erased=actor_erased OR $2,target_erased=target_erased OR $3,details=$4::jsonb WHERE id=$1`,
    [row.id, actor, target, JSON.stringify(redactJson(row.details, needles))]);
  }
}

async function scrubProviderAudit(db, fence, job) {
  const needles = needlesFor(fence, job);
  const { rows } = await db.query(`SELECT id,payload FROM auth.audit_log_entries
    WHERE ${hasIdentifier("payload","$1")} FOR UPDATE`, [needles]);
  for (const row of rows) {
    const actor = row.payload?.actor_id === fence.ownerId || row.payload?.actor_username?.toLowerCase() === job.target_email?.toLowerCase();
    await db.query(`UPDATE auth.audit_log_entries
      SET payload=$2::jsonb,ip_address=CASE WHEN $3 THEN '' ELSE ip_address END WHERE id=$1`,
    [row.id, JSON.stringify(redactJson(row.payload, needles)), actor]);
  }
}

export function createManagedIsolateErasureBackend({ observer, admin }) {
  const storage = admin.storage.from(G1_ERASURE_BUCKET);
  return {
    async authorizeAndFence(intent) {
      return transaction(observer, async db => {
        // The NOOR session must be the live AAL2 session that performed TOTP.
        // The five-minute bound is specific to this synthetic policy exercise.
        const { rows } = await db.query(`SELECT s.originating_auth_session_id, a.auth_user_id
          FROM public.noor_sessions s
          JOIN public.noor_admin_accounts_r271 a ON a.account_id=s.account_id
          JOIN public.noor_authentication_account_linkages l ON l.account_id=s.account_id AND l.user_id=a.auth_user_id
          JOIN auth.users u ON u.id=a.auth_user_id AND u.deleted_at IS NULL
          JOIN auth.sessions p ON p.id=s.originating_auth_session_id AND p.user_id=u.id
          JOIN auth.mfa_factors f ON f.id=p.factor_id AND f.user_id=u.id
          JOIN auth.mfa_amr_claims m ON m.session_id=p.id AND m.authentication_method='totp'
          WHERE s.id=$1 AND s.revoked_at_epoch_ms IS NULL AND s.created_at_epoch_ms<=extract(epoch from clock_timestamp())*1000
            AND s.expires_at_epoch_ms>extract(epoch from clock_timestamp())*1000
            AND a.enabled AND a.role='super_admin' AND a.auth_user_id<>$2
            AND p.aal::text='aal2' AND f.status::text='verified' AND f.factor_type::text='totp'
            AND m.updated_at BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()
          FOR SHARE OF s,a,l,u,p,f,m`, [intent.operatorSessionId, intent.targetAuthUserId]);
        if (rows.length !== 1) throw new Error("R386_G1_RECENT_OPERATOR_MFA_REQUIRED");
        await db.query(`SELECT ${schema}.g1_assert_live_managed_auth_session($1,$2)`,
          [rows[0].originating_auth_session_id, rows[0].auth_user_id]);
        const target = intent.targetAuthUserId;
        await lockedFence(db, target);
        let { rows: [job] } = await db.query(`SELECT * FROM ${jobs} WHERE target_id=$1 FOR UPDATE`, [target]);
        if (!job) {
          const { rows: targetRows } = await db.query(`SELECT DISTINCT l.account_id,u.email
            FROM public.noor_authentication_account_linkages l JOIN auth.users u ON u.id=l.user_id
            WHERE u.id=$1 AND l.subject=u.id::text`, [target]);
          if (targetRows.length !== 1 || !targetRows[0].email?.endsWith("@example.invalid")) {
            throw new Error("R386_G1_SYNTHETIC_TARGET_REQUIRED");
          }
          const { account_id, email } = targetRows[0];
          const { rows: objects } = await db.query("SELECT bucket_id,name FROM storage.objects WHERE owner_id::text=$1", [target]);
          if (objects.some(row => row.bucket_id !== G1_ERASURE_BUCKET || !row.name.startsWith(target + "/"))) {
            throw new Error("R386_G1_UNKNOWN_STORAGE_SCOPE");
          }
          await db.query(`INSERT INTO ${tombstone}(owner_id) VALUES($1) ON CONFLICT DO NOTHING`, [target]);
          ({ rows: [job] } = await db.query(`INSERT INTO ${jobs}(target_id,erasure_id,account_id,target_email,storage_paths,auth_session_ids,auth_factor_ids)
            VALUES($1,$2,$3,$4,$5,ARRAY(SELECT id FROM auth.sessions WHERE user_id=$1),
              ARRAY(SELECT id FROM auth.mfa_factors WHERE user_id=$1)) RETURNING *`, [target, randomUUID(), account_id, email, objects.map(row => row.name)]));
          const revoked = Date.now();
          await db.query("UPDATE public.noor_sessions SET revoked_at_epoch_ms=$1 WHERE account_id=$2 AND revoked_at_epoch_ms IS NULL", [revoked, account_id]);
          await db.query("UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=$1 WHERE account_id=$2 AND revoked_at_epoch_ms IS NULL", [revoked, account_id]);
          await db.query("UPDATE public.noor_admin_accounts_r271 SET enabled=false WHERE auth_user_id=$1", [target]);
        }
        const fence = { ownerId: target, authUserId: target, accountId: job.account_id, erasureId: job.erasure_id,
          persistentTombstone: true, sessionsAndGrantsRevoked: true };
        await readJob(db, fence);
        return fence;
      });
    },
    async eraseStore(fence, store) {
      const job = await readJob(observer, fence);
      if (store === "storage-objects") {
        const { rows } = await observer.query("SELECT name FROM storage.objects WHERE bucket_id=$1 AND name=ANY($2::text[])",
          [G1_ERASURE_BUCKET, job.storage_paths]);
        if (rows.length) assertApi(await storage.remove(rows.map(row => row.name)), "R386_G1_STORAGE_DELETE_FAILED");
        return;
      }
      if (store === "admin-audit") {
        await transaction(observer, async db => { await lockedFence(db, fence.ownerId); await scrubNoorAudit(db, fence, job); });
        return;
      }
      const [table,key,source] = ownerTables.get(store);
      // Delivery and immutable history have a reciprocal FK. Delete history
      // in this step so PostgreSQL cascades to delivery in one transaction.
      if (store === "candidate-delivery") {
        await observer.query(`DELETE FROM ${schema}.event_history WHERE owner_id=$1`, [fence.ownerId]);
        return;
      }
      await observer.query(`DELETE FROM ${table} WHERE ${key}=$1`, [fence[source]]);
    },
    async remainingRows(fence, store) {
      return remaining(observer, fence, await readJob(observer, fence), store);
    },
    async hardDeleteManagedAuth(fence) {
      await readJob(observer, fence);
      assertApi(await admin.auth.admin.deleteUser(fence.authUserId, false), "R386_G1_AUTH_DELETE_FAILED");
    },
    async managedAuthResiduals(fence) {
      return managedAuthRows(observer, fence, await readJob(observer, fence));
    },
    async verifyAndFinalize(fence) {
      const job = await readJob(observer, fence);
      const entries = await Promise.all(job.storage_paths.map(path => storage.download(path)));
      if (entries.some(result => !result.error || !["404","not_found","NoSuchKey"].includes(String(result.error.statusCode ?? result.error.code)))) {
        return false;
      }
      await transaction(observer, async db => {
        await lockedFence(db, fence.ownerId);
        await scrubProviderAudit(db, fence, job);
        for (const store of R386_G1_ERASURE_STORES) {
          if (await remaining(db, fence, job, store) !== 0) throw new Error("R386_G1_FINAL_DATABASE_RESIDUAL");
        }
        if (await managedAuthRows(db, fence, job) !== 0 || await count(db,
          `SELECT count(*) AS n FROM auth.audit_log_entries WHERE ${hasIdentifier("payload","$1")}`,
          [needlesFor(fence, job)]) !== 0) throw new Error("R386_G1_FINAL_AUTH_RESIDUAL");
        await db.query(`UPDATE ${jobs} SET database_verified_at=COALESCE(database_verified_at,clock_timestamp())
          WHERE target_id=$1 AND erasure_id=$2`, [fence.ownerId, fence.erasureId]);
      });
      // This fixture cannot attest managed external log drains or backup expiry.
      // Keep the durable job pending without claiming completed erasure.
      return false;
    },
  };
}
