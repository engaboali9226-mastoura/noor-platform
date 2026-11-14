# R334 — prayer achievement policy preparation (not enabled)
Baseline R333: f2b55a1742c05658ab2b7818c876777ad1f78376.
## Confirmed findings
- R251 recommends 25 per named prayer habit, 12 Quran, 10 dhikr, 14 medication, 9 sleep, 8 work, 6 exercise, 5 walking, 4 language; fallback Essential 14 / Important 8 / Supporting 4 / Optional 1. Editable range 1–100, creation default 1. These are source recommendations, not evidence of any user's saved weights.
- R331 persists owner-scoped prayer mode/timing records; trusted server time blocks recording before start. R333 daily and historical weighted projections only contain Habit/Task rows; R332 separately counts prayers. The record timing is self-reported, not a religious verdict.
- R334 pure projection requires explicit immutable policy, activation date, canonical due keys from trusted day context and exact legacy definition IDs. No title-based destructive migration, no runtime wiring or new defaults.
- Integration still requires per-day persisted snapshots, authenticated settings review, explicit legacy mapping and handling of missing trusted historical context, then unified day/week/statistics and server projections. Preserve past frozen weights, session credit, excluded drink/event rows and permissions. Prayer weights must exceed other active item weights under the approved policy (not assumed from recommended values).
- Visual smoke now covers registration and reset artwork and bounds at normal mobile/desktop sizes. Actual iOS keyboard and approved visual matching remain separate human/device review; no artwork replacement.
## Release gates
No production merge or deploy until numeric base/prayer mode/timing coefficients and activation policy are approved, runtime integration and deduplication are implemented, and functional/visual CI succeeds. Synthetic coefficients in tests are not an approved scoring policy.

## Second-stage preparation
- Added owner-scoped trusted-day scoring adapter: exact start instant, matching civil date and context identity, ordered five timestamps, no fabricated missing context, no future entries.
- Added read-only in-account weight audit under existing control center: actual configured active/paused definition maxima, potential exact prayer-name aliases and stored weights. Title matching is informational only; no automatic mapping or weight changes.
- No production records inspected. The audit becomes visible only after approved code deployment. Additional functional tests are synthetic, not policy authorization.

## Unified period projection
- The pure daily/range adapter combines existing eligible execution rows with explicit prayer-day projections. Week/month/year totals use unrounded weighted points, not averages of daily percentages.
- Legacy days without a prayer policy stay unchanged. Future dates are ignored, duplicate dates fail closed, and a prayer record preceding its authoritative start is rejected.
- This is a reusable calculation layer, not an activated production view. The actual persisted policy issuance/approval and runtime integration remain gated.

## Read-model integration
- Runtime now supplies trusted server evaluation time to the owner-scoped workspace. Only an explicitly persisted valid day policy snapshot with one matching Islamic context produces a separate prayer projection.
- Frontend joins authorized prayer rows for weighted day/week/month/overall statistics, using a distinct Prayer kind and explicit mapped habit IDs. Raw execution rows continue to power mutable activities and reminders.
- Legacy accounts have no policy snapshot, so no production prayer score is enabled by these changes. Policy issuance and explicit approval remain required.

## Explicit account policy approval
- Approval is a separate authenticated CAS command; all six mode/timing entries are intentional, group/on-time is the normalized 100% reference, and the chosen base weight exceeds every active/paused ordinary item after explicitly chosen legacy mappings. Later weight changes cannot exceed the approved prayer priority.
- The next newly materialized civil day receives an immutable copy of the approved policy. Current/previous days are not rescaled. No migration or default policy is issued.
- Account controls show stored values, require manual coefficients and explicit mapping/confirmation, and send no mutation until approval. The server validates ownership and current weights again. Existing account-state revision CAS is reused.
- Approval UI is opt-in, so code may be tested without assigning real-user values.

## End-to-end release evidence planned
- Next-day integration test executes the actual EnsureToday service, verifies 0 weight before Fajr, records Fajr through the authenticated command, changes the next policy, and checks that the already materialized day retains its frozen weight.
- Durable adapter test reloads a policy and day snapshot through the account-scoped persistence boundary and rejects a foreign account. It is a synthetic adapter test, not a live production write.
- Application read model exposes prayer-aware period insights; linked habits are omitted from operational achievement cards only on dates with an effective policy, without deletion. Browser smoke checks opt-in editor defaults and viewport width.
