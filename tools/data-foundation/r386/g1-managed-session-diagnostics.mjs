// Disposable managed-isolate diagnostics. Never emit request/response data or secrets.
const knownRelations = ["noor_sessions", "noor_authentication_account_linkages", "g1_owner_erasure_tombstone", "refresh_tokens", "sessions", "users", "auth", "noor_r386_candidate", "public"];
const knownColumns = ["originating_auth_session_id", "not_after", "session_id", "revoked", "deleted_at", "account_id", "user_id", "id"];
const knownGuardErrors = new Set([
  "R386_G1_MANAGED_SESSION_DENIED", "R386_G1_MANAGED_LINKAGE_DENIED", "R386_G1_ERASED_OWNER_DENIED", "R386_G1_AUTH_USER_DENIED", "R386_G1_MANAGED_BINDING_IMMUTABLE",
]);
export function safeSessionFailure(error) {
  const code = typeof error?.code === "string" && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/u.test(error.code) ? error.code : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : "";
  const guard = knownGuardErrors.has(message) ? message : "NONE";
  const category = code === "42501" ? "PRIVILEGE_OR_RLS" : code === "PGRST204" || code === "PGRST205" ? "SCHEMA_CACHE" : code === "23502" ? "NOT_NULL" : code === "P0001" ? "GUARD_EXCEPTION" : "OTHER";
  // Only predefined catalog names from canonical permission/schema messages; no dynamic text.
  const relation = /permission denied for (?:table|schema|relation) (\w+)/u.exec(message)?.[1];
  const column = /(?:column ["']?|find the ')[a-z_]+/u.exec(message)?.[0];
  const columnName = column?.replace(/^(?:column ["']?|find the ')/u, "");
  return { code, category, guard, relation: knownRelations.includes(relation) ? relation : "NONE", column: knownColumns.includes(columnName) ? columnName : "NONE" };
}
export function createSessionInsertTrace({ origin, fetcher, emit }) {
  let attempts = 0;
  let outcome = "NOT_OBSERVED";
  const fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
    const target = url.origin === origin && url.pathname === "/rest/v1/noor_sessions" && method === "POST";
    if (!target) return fetcher(input, init);
    attempts++;
    let bound = "UNKNOWN";
    if (typeof init?.body === "string") {
      try { const body = JSON.parse(init.body); bound = Object.hasOwn(body, "originating_auth_session_id") && typeof body.originating_auth_session_id === "string" ? "YES" : "NO"; } catch { /* never log body */ }
    }
    try {
      const response = await fetcher(input, init);
      outcome = response.ok ? "HTTP_OK" : "HTTP_ERROR";
      const info = response.ok ? {} : safeSessionFailure(await response.clone().json().catch(() => null));
      emit({ attempt: attempts, bound, httpStatus: response.status, outcome, ...info });
      return response;
    } catch (error) {
      outcome = "TRANSPORT_ERROR";
      emit({ attempt: attempts, bound, outcome });
      throw error;
    }
  };
  return { fetch, snapshot: () => ({ attempts, outcome }) };
}
