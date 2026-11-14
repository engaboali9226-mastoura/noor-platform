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
