# NOOR R386 — G1 contract preflight (READ-ONLY, 2026-11-21)

**Status: PREPARATION ONLY. G1 NOT OPEN/ACCEPTED until the approved G0 publication and gate decision.** This document records a source-level review of the pinned GitHub candidate `887078f279830bd47b52a519d8025ba892a65c16`. No new database tests, production migrations, deployment, or live backfill occurred as part of this review.

## Evidence reviewed

- `docs/noor/r386-data-foundation.md` — G0–G5 sequencing, privacy and non-destructive transition.
- `docs/noor/r386-event-contract.md` — ten known event types; earlier read-only aggregate verification of 2,216 source events; no payload export.
- `docs/noor/r386-analytics-readiness.md` — non-inferable historical dates/weights; privacy and provenance.
- `tools/data-foundation/r386/legacy-event-contract.mjs` — exact v1 event envelopes and owner-scoped validation.
- `tools/data-foundation/r386/s1-persistent-migration.sql` — private owner-scoped tables, forced RLS, constraints and erasure helpers.
- `tools/data-foundation/r386/s2-permanent-backfill.sql` — bounded copy and reconciliation functions for synthetic PostgreSQL only.
- `tools/data-foundation/r386/s3-atomic-save.sql` — isolated synthetic atomic persistence; not production wiring.
- `tools/data-foundation/r386/s4-analytics-facts.sql` — synthetic derived facts, provenance and deletion behavior.

## Confirmed contract alignment (read-only)

1. JavaScript `validIdentifier` bounds to **512 UTF-8 bytes**, rejects controls and malformed lone surrogate code units. PostgreSQL `noor_r386_candidate.valid_id`/identifier domain also bounds to **512 bytes**; the earlier document's 4096 UTF-16 mismatch is historical, not a verified current defect.
2. V1 validator recognizes ten exact event kinds and payload shapes, with owner, event version, privacy class, aggregate and source-day linkage checks. The synthetic store uses owner-scoped `(owner_id,event_id)` and `(owner_id,event_key)` uniqueness, separates immutable event history from delivery state, and revokes browser/app role access. No G1 production permission is implied.
3. S2/S3 SQL and S4 facts target an **isolated synthetic candidate**, not an authorized production migration. The authoritative operational JSONB/CAS state remains unchanged.
4. The analytics readiness audit reports 640 of 652 legacy completed instances with no explicit completion date or recovery date. These must retain unknown performance timing; neither due date, `occurredAt`, nor current definition weights can substitute for missing historical provenance. The audit reports 269 of 844 instances whose definition revision differs from the current revision; that gap is not evidence of corruption.

## Still-required explicit G1 decisions before execution

1. **Retention and late retry horizon.** Choose and approve the maximum replay period and journal/fact/receipt retention semantics; never silently expire a receipt/key while a late retry may be accepted. No duration is invented here.
2. **Deletion authority and provenance.** The authorized server command must attest permanent deletion, rather than inferring it from a missing snapshot. All personal history/facts must be erased with the associated definition/account; archive-only operations must remain distinct. Reconcile gaps before copy; never resurrect deleted content.
3. **Event contract completeness.** Review future event versions, invalid data policy and fail-closed behavior against verified source event inventory. The earlier 2,216-event validation supports v1 coverage only; do not assume the delivery outbox is a complete immutable history.
4. **Timezone and effective policy provenance.** Require trusted due-day zone, policy/version snapshot and verifiable actual completion evidence for new analytics. Unknown historic weights/dates remain null, not guessed or silently scored differently.
5. **Transaction authority and rollback.** Define the owner-bound privileged SQL role and durable HTTP request identity before linking any candidate schema to a real app runtime. Existing browser roles must not gain direct access; no production backfill or dual-write before the ordered G1–G3 gates.

## Next gate sequence

- First publish/review the S5/G0 technical evidence through the **existing approved one-use publication guard**. Do not bypass `pre-push`, `active.gate`, `no_push` or publish using an alternate connector.
- After explicit G0 closure, review and approve the G1 privacy/retention/interface decisions above; run only the missing G1-specific isolated tests.
- G2: shadow backfill parity; G3: atomic runtime integration and rollback; G4: end-to-end parity/security/performance; G5: manually authorized rollout. S6/production release remains blocked pending all applicable gates.

**Safety invariant:** no production/R219 modifications, no changes to existing NOOR authority, no GitHub push/merge, no actual R386 migration, no public disclosure of secrets or user records.
