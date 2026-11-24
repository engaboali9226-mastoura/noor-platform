#!/usr/bin/env bash
set -euo pipefail
umask 077
set +x
BASE=638909371e9824b27f042ba2c0594d53271d2ed5
PROD=12dca76212a8cd48f8aaf34307fb26d08902eeee
REPO=engaboali9226-mastoura/work-tracker_OS
DIR=tools/data-foundation/r386
die(){ printf '%s\n' "$1" >&2; exit 1; }
[ "$#" -eq 2 ] && [ "$1" = "--apply" ] || die 'Usage: bash r386-production-install.sh --apply APPROVED_HEAD'
cd "$(git rev-parse --show-toplevel)"
HEAD_SHA=$(git rev-parse HEAD)
[ "$2" = "$HEAD_SHA" ] || die 'Approved head mismatch'
[ -z "$(git status --porcelain)" ] || die 'Dirty worktree'
[ "$(git remote get-url origin)" = "https://github.com/$REPO.git" ] || die 'Canonical origin mismatch'
git merge-base --is-ancestor "$BASE" "$HEAD_SHA" || die 'Candidate ancestry mismatch'
PR=$(gh api "repos/$REPO/pulls/236")
jq -e --arg head "$HEAD_SHA" --arg base "$PROD" \
 '.state=="open" and .draft==true and .head.sha==$head and .base.sha==$base and .base.ref=="product/noor-personal-mvp"' \
 <<<"$PR" >/dev/null || die 'Release PR mismatch'
CHECKS=$(gh api "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100")
for name in 'Architecture Validation' 'synthetic-postgres' 'managed-supabase'; do
 jq -e --arg name "$name" '[.check_runs[]|select(.name==$name)]|length>0 and all(.[];.status=="completed" and .conclusion=="success")' \
 <<<"$CHECKS" >/dev/null || die 'Required exact-head check missing or unsuccessful'
done
APPROVAL_ID=$(printenv R386_PRODUCTION_APPROVAL_COMMENT_ID || true)
case "$APPROVAL_ID" in ''|*[!0-9]*) die 'Separate production approval required';; esac
APPROVAL=$(gh api "repos/$REPO/issues/comments/$APPROVAL_ID")
jq -e --arg head "$HEAD_SHA" '
 .author_association=="OWNER" and (.issue_url|endswith("/issues/240"))
 and (.body|split("\n")|index("R386_PRODUCTION_INSTALL_APPROVED_HEAD="+$head)!=null)
 and (.body|split("\n")|index("R386_PRODUCTION_INSTALL_PROJECT=dmveacjfozoulimlxuvk")!=null)
 ' <<<"$APPROVAL" >/dev/null || die 'Exact owner approval not verified'
CANDIDATE="$DIR/r386-hosted-install-candidate.sql"
git show "$BASE:$CANDIDATE" | cmp -s - "$CANDIDATE" || die 'Original assembly changed'
ORIGINAL_INCLUDES=$(awk '$1=="\\ir"{print $2}' "$CANDIDATE")
RELEASE_INCLUDES=$(awk '$1=="\\ir"{print $2}' "$DIR/r386-production-install.sql")
[ "$ORIGINAL_INCLUDES" = "$RELEASE_INCLUDES" ] || die 'Include list/order changed'
[ "$(printf '%s\n' "$ORIGINAL_INCLUDES"|wc -l|tr -d ' ')" = 18 ] || die 'Include count mismatch'
while IFS= read -r file; do
 case "$file" in ''|*/*|*..*) die 'Invalid include';; esac
 git show "$BASE:$DIR/$file" | cmp -s - "$DIR/$file" || die 'Pinned include changed'
done <<<"$ORIGINAL_INCLUDES"
[ -n "$(printenv PGSSLROOTCERT || true)" ] && [ -f "$PGSSLROOTCERT" ] || die 'Approved TLS CA file required'
[[ $(printenv R386_G1_WRITER_PASSWORD || true) =~ ^[0-9a-f]{64}$ ]] || die 'Writer credential missing'
[[ $(printenv R386_RUNTIME_SCHEDULER_PASSWORD || true) =~ ^[0-9a-f]{64}$ ]] || die 'Scheduler credential missing'
[ "$R386_G1_WRITER_PASSWORD" != "$R386_RUNTIME_SCHEDULER_PASSWORD" ] || die 'Credentials must differ'
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS
export PGSSLMODE=verify-full PGCONNECT_TIMEOUT=15
[ -n "$(printenv R386_PRIVATE_INSTALL_LOG || true)" ] && [ ! -e "$R386_PRIVATE_INSTALL_LOG" ] || die 'New private log path required'
case "$R386_PRIVATE_INSTALL_LOG" in /Volumes/NOOR-R386-Recovery/*) ;; *) die 'Log must be on approved encrypted volume';; esac
mount | grep -F ' on /Volumes/NOOR-R386-Recovery ' >/dev/null || die 'Encrypted volume not mounted'
psql -X --no-password -v ON_ERROR_STOP=1 \
 -h aws-0-ap-southeast-2.pooler.supabase.com -p 5432 \
 -U postgres.dmveacjfozoulimlxuvk -d postgres \
 -v "r386_release_authority=R386-PRODUCTION-dmveacjfozoulimlxuvk-$BASE" \
 -f "$DIR/r386-production-install.sql" >"$R386_PRIVATE_INSTALL_LOG" 2>&1 \
 || die 'Install not confirmed; inspect private log and reconcile read-only before retry'
grep -q 'R386_PRODUCTION_DORMANT_INSTALL_COMMITTED' "$R386_PRIVATE_INSTALL_LOG" \
 || die 'Commit uncertain; reconcile read-only'
printf '%s\n' 'R386_PRODUCTION_DORMANT_INSTALL_COMMITTED'
