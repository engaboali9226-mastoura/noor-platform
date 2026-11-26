> Policy-v6 identity and cutover hardening CANDIDATE, NOT INSTALLED. Proposed canonical URL: https://github.com/engaboali9226-mastoura/noor-platform.git. Gate schema remains 3; new authority requires hook policy 6. Candidate hook SHA256: a343f7cb57825a62fadf70b4c8d1bf8d557a01186b3ce02fff3c3679ea11224e. The historical v5 specification below is retained as evidence; do not use it as v6 live authority. Independent review, exact approved publication with v5, rename and verified installation are required.

# Policy-v6 proposed operational specification

Status: candidate only; Policy-v5 remains installed until authorized cutover.

- Exact canonical URL after cutover: `https://github.com/engaboali9226-mastoura/noor-platform.git`.
- Gate schema: 3. Hook policy: 6. Prior policy 5 gates must not be reused.
- Hook SHA256: `a343f7cb57825a62fadf70b4c8d1bf8d557a01186b3ce02fff3c3679ea11224e`.
- Stable repository ID: 1284723703; protected ref and server ruleset 20030660 unchanged.
- All four existing operations, exact allowlist, sentinel, and protected refs remain in force. Every v6 attempt binds its nonce and the SHA-256 of the full gate file before release of the state lock. The installed hook checks that binding under the lock before consumption. Consumed and revoked nonces remain reserved. The effective origin push URL list must contain exactly the sentinel. No alias or URL rewrite authority.
- v6 remote checks and publication use the exact HTTPS URL with HTTP redirects disabled. Repository identity checks require a direct GitHub API response matching the numeric ID, full name and clone URL. A failed identity lookup blocks the operation. The installer and publisher require Git with absolute hook path resolution. Identity verification also uses curl and jq.
- The published hook SHA-256 must match the hook Git actually resolves and will execute. The verification result is separate from the pre-push consumption record.

### Bootstrap and cutover

1. Independently review and authorize the exact candidate. Publish the candidate through the protected PR and required CI using the complete, clean v5 worktree at its accepted revision. Run the v5 publisher from that worktree, which must also contain the matching v5 verifier. The v6 publisher resolves its verifier relative to its own approved tool directory. Record the merged commit, the active v5 hook SHA-256 and the accepted v6 hook SHA-256. Keep Render auto-deploy disabled. Keep the R282 link change out of a live Render deployment until the new repository name resolves to the expected ID.
2. Before rename, establish a publication freeze with enforceable write restrictions for all human and automation credentials that can push, including older clones. Account for pushes in flight, other worktrees and external writers. Under the freeze reconcile and revoke active gates, verify no state locks are in use, and preserve consumed and revoked gates and audit logs. If control of any writer or either repository name is uncertain, stop during the freeze.
3. Confirm destination name eligibility in GitHub, record repository ID, protected and default refs, effective rules and Render configuration and live revision. After authorized rename, verify the new name resolves directly to the recorded ID and compare the refs, effective rules and integrations with those recorded values. GitHub may continue serving the old name by redirect. Retire its write authority and do not reuse the old name. Leave legacy Pages repositories outside this change.
4. Install from the independently reviewed commit and approved v6 hash in every authorized publication workspace. Verify the effective executable hook, the sentinel on every workspace, and rejection of old gates with isolated fixtures. Keep the freeze in place if any check fails. Resume only after GitHub and Render readback, review of all writers, and explicit authorization for freshly issued v6 gates. Record the resulting GitHub and Render identities and release status.

### Rollback during the publication freeze

1. On identity, ruleset, integration or hook verification failure, keep write access frozen. Reconcile any in-flight operations and audit records. Revoke current active gates under the state lock. Preserve consumed and revoked gates and logs without reuse.
2. If the rename took place, restore the original name only under separate authorization and only to the recorded repository ID. Reconcile the effective ruleset, refs and Render backing configuration and confirm the previously recorded live revision. If the old identity cannot be restored and verified, stay frozen.
3. Restore v5 from the approved baseline commit `01fb7b7618691d747e829b4930d5e7a902a2fa4d` or its exact hash-named backup. Both installation methods require the approved v5 SHA-256 `1f0154b7b59e22619487b6d00f652532f7d7a55d4e1aab4067e6bf64cb676e2c` with explicit confirmation. Verify the installed executable bytes, the sentinel and effective hook path in every authorized workspace. Resume using a complete clean worktree from the accepted v5 revision with its matching publisher and verifier. Preserve the merged candidate history and all gate records.
4. Resume v5 writes only after direct identity, server rules, refs, effective hook, Render and writer checks are recorded and a new v5 delegation is approved. If any condition is missing, maintain the freeze. The R386 installer stays outside this operation.

### Isolated verification

Use the publication-control suite and `tests/noor-publication/test-policy-v6-cutover.sh` with the hook bytes extracted from the pinned v5 baseline. The cutover regression uses local Git fixtures and a mocked GitHub identity response. Verify the direct GitHub identity and Render integration separately during the authorized freeze before any live authority is granted.

## Historical Policy-v5 specification (not v6 authority)

# Noor Personal Publication-Control Policy

## Schema Version

- **Gate Schema Version:** `3`
- **Hook Policy Version:** `5`

## Canonical Protected Ref

- `refs/heads/product/noor-personal-mvp`

## Publication Namespace

- `refs/heads/pub/<12-lowercase-hex>`

## Legacy Non-Publication Delete Allowlist

Hook Policy v5 preserves the existing `refs/heads/pub/<12-lowercase-hex>`
publication namespace and does not authorize general deletion of non-publication
branches.

`DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT` may additionally target only one of
the following exact legacy ref/object pairs:

- `refs/heads/codex/noor-ci-workspace-integration` -> `9427b2574488a3a3b3144d7da63332cdabb9d0aa`
- `refs/heads/codex/platform-app-catalog-foundation` -> `3097814d5f2195c35d3308ff96c90abd149c1bd9`
- `refs/heads/codex/platform-application-composition-foundation` -> `68fa2995c5be8193a269edc45117d1adc6f6dcba`
- `refs/heads/agents/workspace-package-entrypoint-contract-repair` -> `7ab046ac2fe8fa89c4c1031bfead41dfa7aa4b6d`

The ref and `REQUIRED_REMOTE_OBJECT` must match the same allowlisted pair
exactly. Wildcard authorization for `codex/*`, `agents/*`, or arbitrary
`refs/heads/*` is forbidden. Remote drift remains fail-closed.

## Supported Operations

- `CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT`
- `UPDATE_NON_PROTECTED_BRANCH_FAST_FORWARD`
- `CREATE_ANNOTATED_TAG_EXACT_OBJECT`
- `DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT`

## Installation Model

The canonical pre-push hook is installed from an exact reviewed commit via
`install-hook.sh --from-commit <COMMIT>`. The installer:

1. Extracts the hook template using `git show <COMMIT>:etc/noor-publication/pre-push.noor-policy-hook`.
2. Verifies the extracted SHA-256 against the independently approved review record.
3. Refuses dirty tracked publication-control artifacts.
4. Backs up the existing hook without overwrite.
5. Is idempotent.
6. Never changes the persistent push URL (`no_push://noor-personal-dev`).

The canonical hook enforces fail-closed remote identity: only the exact
canonical repository URL grants publication authority. No `url.*.insteadOf`
mapping, local path, alias, or config-controlled replacement is treated as
equivalent to the canonical repository URL. Implementation capability to issue
a delete refspec does not, by itself, authorize any live deletion.

## Canonical Hook Template SHA-256

```
1f0154b7b59e22619487b6d00f652532f7d7a55d4e1aab4067e6bf64cb676e2c
```

## Design Candidate SHA-256

```
262d1a1a28113f69e7b247ae494519ee5fde6c566e0f75f4d1c42792c75e08fb
```

## Accepted Design Decision

`PUBLICATION_CONTROL_DESIGN_CORRECTED`

## Historical Accepted Review Decision — Policy-v4 Baseline

`PUBLICATION_CONTROL_CANDIDATE_ACCEPTED`

This decision records acceptance of the previously reviewed Policy-v4 baseline only.
It does not constitute acceptance of the current Policy-v5 candidate. The Policy-v5
candidate requires a fresh independent adversarial re-review after the current local repair.

## Raw Ruleset-Evidence Hashes

- Ruleset JSON (`noor-ruleset-20030660-20260808.json`):
  `34c92dcf80a80605eb9dd68d34aa123ca6f880b65c631fe1e6103d70f530c0f4`
- Effective-rules JSON (`noor-effective-rules-product-noor-personal-mvp-20260808.json`):
  `0d848c6e29398e6edea74620d596c2faaafc56c26a3e195dc3f2a58c8c92f285`
- Evidence manifest (`noor-publication-control-evidence-20260808-SHA256SUMS.txt`):
  `684a40fd6bccc4e7a23e96bc7ac631c852c8116ec316be53dc567e08cd6f9188`

## Migration Notes

- v1 hook (SHA `4c6f4814fb1ad65558cac9d0d2304046b5429a849c47973c73c762cf4f4e9ddd`) is backed up to `backups/pre-push.4c6f4814…` at bootstrap.
- v1 consumed gate (`consumed/dc14eb36845a7d8fa3ae242fcfda7ac3.gate`) is preserved and untouched.
- Active authority requires `SCHEMA_VERSION=3` and `HOOK_POLICY_VERSION=5` for all four operations.
- Historical consumed v2/p3 gates remain immutable historical evidence only; they are not reusable active authority.
- Deletion semantics: SOURCE_REF=(delete), SOURCE_OBJECT=0000..., REQUIRED_REMOTE_OBJECT=<exact nonzero>, remote drift is fail-closed.
- Protected branch (product/noor-personal-mvp) deletion is always rejected.
- DELETE verification requires remote query success, exact destination absence, and exact protected-canonical preservation. The canonical pre-push snapshot is captured before the push as verification context only (not authority) and the post-delete canonical must equal the pre-delete snapshot exactly.
- No implementation commit SHA is recorded because no implementation commit exists yet.
