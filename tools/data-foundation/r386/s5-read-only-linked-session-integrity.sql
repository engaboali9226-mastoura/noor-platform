-- R386 S5 — LIVE METADATA/AGGREGATE SECURITY EVIDENCE, READ ONLY.
-- Run only on the authorized NOOR source with a read-only SQL connection.
-- Emits six booleans; no user/session IDs, secrets, tokens or personal data.
-- This is a RELATIONAL invariant proof, NOT an authenticated HTTP/RPC proof.
-- It does not prove JWT issuance, NOOR session creation, tenant authorization,
-- managed service restoration, or the origin of any existing NOOR session.
WITH active_noor AS (
  SELECT account_id
  FROM public.noor_sessions
  WHERE revoked_at_epoch_ms IS NULL
    AND expires_at_epoch_ms > floor(extract(epoch FROM now()) * 1000)
)
SELECT
  EXISTS (SELECT 1 FROM auth.users) AS supabase_users_present,
  EXISTS (SELECT 1 FROM auth.sessions) AS supabase_auth_sessions_present,
  EXISTS (SELECT 1 FROM public.noor_authentication_account_linkages) AS linked_accounts_present,
  NOT EXISTS (
    SELECT 1 FROM public.noor_authentication_account_linkages l
    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id)
  ) AS no_orphan_auth_account_links,
  EXISTS (SELECT 1 FROM active_noor) AS active_noor_sessions_present,
  NOT EXISTS (
    SELECT 1 FROM active_noor n
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.noor_authentication_account_linkages l
      JOIN auth.users u ON u.id = l.user_id
      WHERE l.account_id = n.account_id
    )
  ) AS all_active_noor_session_accounts_linked;
