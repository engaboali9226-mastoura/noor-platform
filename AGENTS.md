# NOOR — Agent instructions

Authoritative registry: https://github.com/engaboali9226-mastoura/noor-platform/issues/253

1. Read the registry and the current release and audit issues. Confirm the exact audited SHA, actual deployed revision and applicable policy before starting.
2. For audit work, use read-only source and production inspection. No production changes, publication, deletion, secrets or user data exposure. Writing audit findings to the designated Issues is permitted only within owner authorization.
3. Respect Policy-v5 (or its formally activated successor). Do not use API writes to refs/files/commits to bypass protected publication. No automatic deployment or unauthorized data mutations.
4. Reuse prior verified evidence where applicable; document why retesting is necessary. Distinguish static analysis, isolated execution, and live read-only observations. Do not claim an unperformed test passed.
5. Report reviewer/date, SHA, file/line ranges, test method/environment, evidence, PASS/FAIL/BLOCKED/NOT_TESTED/N/A, limits, finding identifiers and next step. Classify findings by severity and confidence. Avoid duplicate issues and unsupported coverage percentages.
6. Keep independent reviews blind to unnecessary prior findings until comparison. If GitHub is unavailable, use verified source batches and return the report for authorized transcription. Record the exact resume point before the session ends.
7. Close audits only according to the registry's quality gates and explicit owner approval. Audit closure is not deployment approval. Preserve historical records.
8. For development, implement owner-approved changes only, preserve working behavior and data, run relevant regression checks and follow the protected manual deployment path. Disclose what was done, what remains and blockers.

The issue registry contains current scope and policies; do not treat a stale README as authoritative for the active SHA or release.
