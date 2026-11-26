#!/bin/sh
set -eu
set -f
LC_ALL=C

# Noor Personal publication-control v3 network-outcome executor.
# Runs exactly one explicit source-to-destination git push against the
# canonical URL. Records PUSH_ATTEMPT, PUSH_SUCCEEDED, PUSH_FAILED, or
# PUSH_OUTCOME_UNVERIFIED in the audit log. Never retries a nonce.
#
# Usage:
#   publish-once.sh [--remote-url <URL>]

usage() {
    echo "Usage: publish-once.sh [--remote-url <URL>]" >&2
    exit 2
}

deny() {
    echo "publish-once: denied: $1" >&2
    exit 1
}

# SHA-256 utility with capability detection (macOS / GNU).
compute_sha256() {
    if [ "$#" -gt 0 ] && [ -n "$1" ]; then
        if command -v sha256sum >/dev/null 2>&1; then
            sha256sum "$1" | awk '{print $1}'
        elif command -v shasum >/dev/null 2>&1; then
            shasum -a 256 "$1" | awk '{print $1}'
        else
            return 127
        fi
    else
        if command -v sha256sum >/dev/null 2>&1; then
            sha256sum | awk '{print $1}'
        elif command -v shasum >/dev/null 2>&1; then
            shasum -a 256 | awk '{print $1}'
        else
            return 127
        fi
    fi
}

# Constants
CANONICAL_URL='https://github.com/engaboali9226-mastoura/noor-platform.git'
PUBLICATION_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
GATE_DIR_NAME='noor-publication-gate'
STATE_LOCK_NAME='state.lock'
ACTIVE_GATE_NAME='active.gate'
AUDIT_LOG_NAME='audit.log'
SENTINEL_URL='no_push://noor-personal-dev'
# These immutable pins belong to this reviewed version of the publisher.
EXPECTED_V6_HOOK_SHA256='879caada86842c9d55bd22eec1c5eea0991ea8a164d158f89db32f21940946ed'
EXPECTED_VERIFIER_SHA256='c95d9a549ba4a964d8938395bbbd1393d8ad5eeee53b7abe1ccfb3db0b256646'
EXPECTED_TRANSPORT_SHA256='7d34f3057be4551067ca5300ac6cc9422fedb7629929894b15dc2e3e3e8490b1'
TRANSPORT_PATH="$PUBLICATION_SCRIPT_DIR/transport.sh"
VERIFY_SCRIPT="$PUBLICATION_SCRIPT_DIR/verify-publication.sh"
HOOK_TEMPLATE="$PUBLICATION_SCRIPT_DIR/../pre-push.noor-policy-hook"

require_pinned_file() {
    [ -f "$1" ] && [ ! -L "$1" ] && [ "$(compute_sha256 "$1")" = "$2" ] ||
        deny "$3 is unavailable or differs from its pinned SHA-256"
}

require_pinned_file "$TRANSPORT_PATH" "$EXPECTED_TRANSPORT_SHA256" "publication transport"
. "$TRANSPORT_PATH"
require_default_git_config

REMOTE_URL="$CANONICAL_URL"
PROTECTED_REF='refs/heads/product/noor-personal-mvp'

while [ "$#" -gt 0 ]; do
    case "$1" in
        --remote-url)
            shift
            [ "$#" -gt 0 ] || usage
            REMOTE_URL=$1
            ;;
        *)
            usage
            ;;
    esac
    shift
done

[ "$REMOTE_URL" = "$CANONICAL_URL" ] || deny "publication requires the exact canonical repository URL"

# Resolve git paths
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || deny "not a git repository"
COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) ||
    deny "cannot resolve the common Git directory"

GATE_DIR=$COMMON_DIR/$GATE_DIR_NAME
STATE_LOCK=$GATE_DIR/$STATE_LOCK_NAME
ACTIVE_GATE=$GATE_DIR/$ACTIVE_GATE_NAME
AUDIT_LOG=$GATE_DIR/$AUDIT_LOG_NAME

# Verify persistent push URL sentinel is intact
configured_pushurl=$(git remote get-url --push --all origin 2>/dev/null && printf '.') ||
    deny "cannot resolve effective origin push URLs"
[ "$configured_pushurl" = "$(printf '%s\n.' "$SENTINEL_URL")" ] ||
    deny "persistent push URL sentinel has been altered"

# Use Git's hook resolution for the worktree root. Pin the same directory
# for the actual push so it cannot switch to an alternate resolution.
HOOK_PATH="$COMMON_DIR/hooks/pre-push"
EFFECTIVE_HOOK_PATH=$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-path hooks/pre-push) ||
    deny "cannot resolve the effective pre-push hook"
[ "$EFFECTIVE_HOOK_PATH" = "$HOOK_PATH" ] && [ -d "$COMMON_DIR/hooks" ] && [ ! -L "$COMMON_DIR/hooks" ] ||
    deny "effective pre-push hook path differs from the approved path"
require_approved_hook() {
    [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ] && [ -x "$HOOK_PATH" ] ||
        deny "approved pre-push hook is missing or not executable"
    [ "$(compute_sha256 "$HOOK_PATH")" = "$EXPECTED_V6_HOOK_SHA256" ] ||
        deny "effective pre-push hook SHA-256 differs from the approved v6 hook"
}

require_approved_verifier() {
    [ -x "$VERIFY_SCRIPT" ] || deny "mandatory verifier is unavailable or not executable"
    require_pinned_file "$VERIFY_SCRIPT" "$EXPECTED_VERIFIER_SHA256" "mandatory verifier"
    require_pinned_file "$TRANSPORT_PATH" "$EXPECTED_TRANSPORT_SHA256" "publication transport"
    require_pinned_file "$HOOK_TEMPLATE" "$EXPECTED_V6_HOOK_SHA256" "verification hook template"
}

[ -d "$GATE_DIR" ] && [ ! -L "$GATE_DIR" ] || deny "publication state directory invalid"

# Acquire the common lock
if ! mkdir "$STATE_LOCK" 2>/dev/null; then
    deny "state lock is held; a concurrent operation is in progress or a previous lock was not recovered"
fi
trap 'rmdir "$STATE_LOCK" 2>/dev/null || true' 0
trap 'exit 1' HUP INT TERM

# Read active.gate parameters (must exist)
[ -f "$ACTIVE_GATE" ] && [ ! -L "$ACTIVE_GATE" ] || deny "active.gate is unavailable"
[ ! -L "$AUDIT_LOG" ] && { [ ! -e "$AUDIT_LOG" ] || [ -f "$AUDIT_LOG" ]; } ||
    deny "publication audit path is invalid"
require_approved_hook
require_approved_verifier
sh "$HOOK_PATH" --preflight-transport || deny "canonical repository identity or transport not verified"
sh "$HOOK_PATH" --check-gate || deny "active gate failed pre-push validation"

SOURCE_REF=''
DESTINATION_REF=''
OPERATION=''
SOURCE_OBJECT=''
NONCE=''

line_no=0
while IFS= read -r line || [ -n "$line" ]; do
    line_no=$((line_no + 1))
    case "$line_no" in
        3)  SOURCE_REF=${line#SOURCE_REF=} ;;
        4)  SOURCE_OBJECT=${line#SOURCE_OBJECT=} ;;
        5)  DESTINATION_REF=${line#DESTINATION_REF=} ;;
        8)  OPERATION=${line#OPERATION=} ;;
        11) NONCE=${line#NONCE=} ;;
    esac
done < "$ACTIVE_GATE"

[ -n "$SOURCE_REF" ] || deny "gate missing source ref"
[ -n "$DESTINATION_REF" ] || deny "gate missing destination ref"
[ -n "$OPERATION" ] || deny "gate missing operation"
[ -n "$SOURCE_OBJECT" ] || deny "gate missing source object"
printf '%s\n' "$NONCE" | grep -Eq '^[0-9a-f]{32}$' || deny "gate nonce format invalid"
AUTHORIZED_GATE_SHA256=$(compute_sha256 "$ACTIVE_GATE") || deny "cannot hash the active gate"
printf '%s\n' "$AUTHORIZED_GATE_SHA256" | grep -Eq '^[0-9a-f]{64}$' || deny "invalid active gate SHA-256"
CONSUMED_GATE="$GATE_DIR/consumed/$NONCE.gate"

if [ -f "$AUDIT_LOG" ]; then
    if grep -Fq "event=PUSH_ATTEMPT nonce=$NONCE " "$AUDIT_LOG"; then
        deny "nonce already attempted; reconcile remote state before issuing new authority"
    else
        [ "$?" -eq 1 ] || deny "cannot read prior publication attempts"
    fi
fi

# Capture the protected canonical remote object BEFORE the DELETE push.
# This is verification context ONLY: it is NOT gate authority and is NOT stored
# in any Gate field. It is used post-push to prove the canonical ref was
# preserved exactly across the deletion operation. Failing to snapshot (or a
# query failure) is a hard failure, never treated as "absence".
CANONICAL_PRE_PUSH_OBJECT=''
if [ "$OPERATION" = "DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT" ]; then
    snapshot=$(canonical_git ls-remote --refs -- "$CANONICAL_URL" "$PROTECTED_REF" 2>/dev/null) ||
        deny "cannot snapshot protected canonical object before delete"
    set -- $snapshot
    [ "$#" -eq 2 ] && [ "$2" = "$PROTECTED_REF" ] ||
        deny "protected canonical snapshot is missing or invalid"
    printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{40}$' || deny "protected canonical object is invalid"
    CANONICAL_PRE_PUSH_OBJECT=$1
fi

# Reserve this nonce before releasing state.lock. Any interrupted or uncertain
# attempt requires manual reconciliation, even if the gate is still active.
require_approved_hook
require_approved_verifier
sh "$HOOK_PATH" --check-configured-hooks || deny "Git hook configuration not verified before reservation"
(
    umask 077
    printf '%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ') event=PUSH_ATTEMPT nonce=$NONCE op=$OPERATION src=$SOURCE_REF dst=$DESTINATION_REF" >> "$AUDIT_LOG"
) || deny "cannot reserve publication attempt"
rmdir "$STATE_LOCK" || deny "cannot release publication lock"
trap - 0 HUP INT TERM

export NOOR_PUBLICATION_GATE_NONCE="$NONCE"
export NOOR_PUBLICATION_GATE_SHA256="$AUTHORIZED_GATE_SHA256"
case "$OPERATION" in
    DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT) refspec=":$DESTINATION_REF" ;;
    *) refspec="$SOURCE_REF:$DESTINATION_REF" ;;
esac
push_exit=0
# A denial here leaves the reserved nonce unavailable for retry.
sh "$HOOK_PATH" --check-configured-hooks ||
    deny "Git hook configuration not verified after reservation; reconcile before issuing new authority"
canonical_push "$refspec" 2>/dev/null || push_exit=$?
unset NOOR_PUBLICATION_GATE_NONCE NOOR_PUBLICATION_GATE_SHA256

# Re-acquire the common lock
if ! mkdir "$STATE_LOCK" 2>/dev/null; then
    # Lock was left by the hook or another process. Fail-closed.
    echo "publish-once: lock held after push; cannot finalize audit record" >&2
    exit 1
fi
trap 'rmdir "$STATE_LOCK" 2>/dev/null || true' 0
trap 'exit 1' HUP INT TERM

# Require the exact gate read before the attempt to be in the consumed log.
if [ ! -f "$CONSUMED_GATE" ] || [ -L "$CONSUMED_GATE" ] ||
    [ "$(compute_sha256 "$CONSUMED_GATE")" != "$AUTHORIZED_GATE_SHA256" ]; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') event=PUSH_OUTCOME_UNVERIFIED nonce=$NONCE op=$OPERATION exit_code=$push_exit" >> "$AUDIT_LOG"
    deny "exact gate consumption was not verified; reconcile remote state before any retry"
fi

if [ "$push_exit" -eq 0 ]; then
    outcome="PUSH_SUCCEEDED"
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') event=$outcome nonce=$NONCE exit_code=0" >> "$AUDIT_LOG"
    echo "publish-once: push accepted by remote; mandatory verification is running..."
    # Release lock before running publication verifier
    rmdir "$STATE_LOCK" || deny "cannot release publication lock; outcome requires reconciliation"
    trap - 0 HUP INT TERM
    (require_approved_verifier) ||
        deny "publication outcome is unverified; reconcile remote state before requesting new authority"

    set +e
    case "$OPERATION" in
        CREATE_ANNOTATED_TAG_EXACT_OBJECT)
            "$VERIFY_SCRIPT" --operation "$OPERATION" --destination-ref "$DESTINATION_REF" --expected-object "$SOURCE_OBJECT" --expected-peeled-object "$(git rev-parse "$SOURCE_OBJECT^{}" 2>/dev/null || echo '')" --remote-url "$REMOTE_URL"
            verify_exit=$?
            ;;
        CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT|UPDATE_NON_PROTECTED_BRANCH_FAST_FORWARD)
            "$VERIFY_SCRIPT" --operation "$OPERATION" --destination-ref "$DESTINATION_REF" --expected-object "$SOURCE_OBJECT" --remote-url "$REMOTE_URL"
            verify_exit=$?
            ;;
        DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT)
            # Pass the exact pre-push canonical snapshot captured before the
            # deletion push. The verifier independently re-observes the canonical
            # ref AFTER the push and requires exact equality, proving preservation
            # across the deletion. This value is verification context only and is
            # not gate authority.
            [ -n "$CANONICAL_PRE_PUSH_OBJECT" ] || deny "missing pre-push canonical snapshot"
            "$VERIFY_SCRIPT" --operation "$OPERATION" --destination-ref "$DESTINATION_REF" --remote-url "$REMOTE_URL" --protected-ref "$PROTECTED_REF" --protected-canonical-object "$CANONICAL_PRE_PUSH_OBJECT"
            verify_exit=$?
            ;;
        *)
            set -e
            deny "unknown operation"
            ;;
    esac
    set -e

    if [ "$verify_exit" -ne 0 ]; then
        echo "publish-once: mandatory verification failed; publication outcome is unverified. Gate remains consumed; do not retry automatically." >&2
        exit 1
    fi

    echo "publish-once: publication verified and completed successfully."
    exit 0
else
    outcome="PUSH_FAILED"
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') event=$outcome nonce=$NONCE exit_code=$push_exit" >> "$AUDIT_LOG"
    echo "publish-once: push failed (exit $push_exit); gate consumed, reconcile remote state before requesting new authority" >&2
    exit 1
fi
