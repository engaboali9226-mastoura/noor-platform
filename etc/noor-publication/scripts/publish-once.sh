#!/bin/sh
set -eu
set -f
LC_ALL=C

# Noor Personal publication-control v3 network-outcome executor.
# Runs exactly one explicit source-to-destination git push against the
# canonical URL. Records PUSH_ATTEMPT, PUSH_SUCCEEDED, PUSH_FAILED, or
# PUSH_DENIED in the audit log. Never reactivates a consumed gate.
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

# Fail-closed check for Git URL rewrite rules (insteadOf / pushInsteadOf).
# If any configured rewrite rule could match the canonical URL, deny immediately.
# Checks local, global, and system Git config.
check_canonical_url_rewrite() {
    if [ -n "${GIT_CONFIG_COUNT-}" ]; then
        _env_index=1
        while [ "$_env_index" -le "${GIT_CONFIG_COUNT}" ]; do
            _diag_index=$_env_index
            eval "__env_key=\${GIT_CONFIG_KEY_$_env_index-}"
            eval "__env_value=\${GIT_CONFIG_VALUE_$_env_index-}"
            _env_index=$((_env_index + 1))
            [ -n "${__env_key:-}" ] || continue
            __env_key_norm=$(printf '%s' "$__env_key" | tr '[:upper:]' '[:lower:]')
            case "$__env_key_norm" in
                url.*.insteadof|url.*.pushinsteadof)
                    case "$CANONICAL_URL" in
                        "$__env_value"*)
                            echo "PUBLICATION_CONTROL_URL_REWRITE_DETECTED" >&2
                            deny "Git URL rewrite [GIT_CONFIG_KEY_${_diag_index}] targets canonical URL: $__env_key=$__env_value"
                            ;;
                    esac
                    ;;
            esac
        done
    fi

    if [ -n "${GIT_CONFIG_PARAMETERS-}" ]; then
        for _param in ${GIT_CONFIG_PARAMETERS}; do
            case "$_param" in
                *=*)
                    _param_key=${_param%%=*}
                    _param_value=${_param#*=}
                    _param_key_norm=$(printf '%s' "$_param_key" | tr '[:upper:]' '[:lower:]')
                    case "$_param_key_norm" in
                        url.*.insteadof|url.*.pushinsteadof)
                            case "$CANONICAL_URL" in
                                "$_param_value"*)
                                    echo "PUBLICATION_CONTROL_URL_REWRITE_DETECTED" >&2
                                    deny "Git URL rewrite [GIT_CONFIG_PARAMETERS] targets canonical URL: $_param_key=$_param_value"
                                    ;;
                            esac
                            ;;
                    esac
                    ;;
            esac
        done
    fi

    for _scope_args in "" "--global" "--system"; do
        set +e
        _config_output=$(git config $_scope_args --get-regexp 'url\.' 2>/dev/null)
        _rc=$?
        set -e
        [ "$_rc" -ne 0 ] && continue
        [ -z "$_config_output" ] && continue
        while IFS= read -r _line; do
            [ -n "$_line" ] || continue
            _key=$(echo "$_line" | awk '{print $1}')
            _value=$(echo "$_line" | awk '{print $2}')
            _key_norm=$(printf '%s' "$_key" | tr '[:upper:]' '[:lower:]')
            case "$_key_norm" in
                url.*.insteadof|url.*.pushinsteadof)
                    case "$CANONICAL_URL" in
                        "$_value"*)
                            echo "PUBLICATION_CONTROL_URL_REWRITE_DETECTED" >&2
                            deny "Git URL rewrite [$_scope_args] targets canonical URL: $_key=$_value"
                            ;;
                    esac
                    ;;
            esac
        done <<EOF
$_config_output
EOF
    done
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
. "$PUBLICATION_SCRIPT_DIR/transport.sh"
GATE_DIR_NAME='noor-publication-gate'
STATE_LOCK_NAME='state.lock'
ACTIVE_GATE_NAME='active.gate'
AUDIT_LOG_NAME='audit.log'
SENTINEL_URL='no_push://noor-personal-dev'
EXPECTED_V6_HOOK_SHA256='a343f7cb57825a62fadf70b4c8d1bf8d557a01186b3ce02fff3c3679ea11224e'

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

# Use the path Git resolves for the worktree root. Require the approved
# common hook and pin that directory on the actual push invocation.
HOOK_PATH="$COMMON_DIR/hooks/pre-push"
EFFECTIVE_HOOK_PATH=$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-path hooks/pre-push) ||
    deny "cannot resolve the effective pre-push hook"
[ "$EFFECTIVE_HOOK_PATH" = "$HOOK_PATH" ] && [ ! -L "$COMMON_DIR/hooks" ] ||
    deny "effective pre-push hook path differs from the approved path"
require_approved_hook() {
    [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ] && [ -x "$HOOK_PATH" ] ||
        deny "approved pre-push hook is missing or not executable"
    [ "$(compute_sha256 "$HOOK_PATH")" = "$EXPECTED_V6_HOOK_SHA256" ] ||
        deny "effective pre-push hook SHA-256 differs from the approved v6 hook"
}

# Acquire the common lock
if ! mkdir "$STATE_LOCK" 2>/dev/null; then
    deny "state lock is held; a concurrent operation is in progress or a previous lock was not recovered"
fi
trap 'rmdir "$STATE_LOCK" 2>/dev/null || true' 0 1 2 3 15

# Read active.gate parameters (must exist)
[ -f "$ACTIVE_GATE" ] && [ ! -L "$ACTIVE_GATE" ] || deny "active.gate is unavailable"

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

# Fail-closed: reject any Git URL rewrite rule that could redirect canonical URL
check_canonical_url_rewrite

require_approved_hook
sh "$HOOK_PATH" --check-identity || deny "canonical repository identity not verified"

# Release the lock (so the hook can acquire it during git push)
rmdir "$STATE_LOCK" 2>/dev/null || true
trap - 0 1 2 3 15

# Record push attempt
audit_line="$(date -u '+%Y-%m-%dT%H:%M:%SZ') event=PUSH_ATTEMPT nonce=$NONCE op=$OPERATION src=$SOURCE_REF dst=$DESTINATION_REF"
echo "$audit_line" >> "$AUDIT_LOG"
chmod 0600 "$AUDIT_LOG" 2>/dev/null || true

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

# Pass the locked snapshot to the hook so any later gate replacement is rejected.
require_approved_hook
export NOOR_PUBLICATION_GATE_NONCE="$NONCE"
export NOOR_PUBLICATION_GATE_SHA256="$AUTHORIZED_GATE_SHA256"
# Execute exactly one explicit source-to-destination push
# For deletion, use the delete refspec; for others, use source:destination
if [ "$OPERATION" = "DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT" ]; then
    set +e
    canonical_git -c "core.hooksPath=$COMMON_DIR/hooks" push "$REMOTE_URL" ":$DESTINATION_REF" 2>"$GATE_DIR/.push.err.$$"
    push_exit=$?
    set -e
else
    set +e
    canonical_git -c "core.hooksPath=$COMMON_DIR/hooks" push "$REMOTE_URL" "$SOURCE_REF:$DESTINATION_REF" 2>"$GATE_DIR/.push.err.$$"
    push_exit=$?
    set -e
fi
unset NOOR_PUBLICATION_GATE_NONCE NOOR_PUBLICATION_GATE_SHA256
detail=$(head -n 1 "$GATE_DIR/.push.err.$$" 2>/dev/null || echo "")
rm -f "$GATE_DIR/.push.err.$$"

# Re-acquire the common lock
if ! mkdir "$STATE_LOCK" 2>/dev/null; then
    # Lock was left by the hook or another process. Fail-closed.
    echo "publish-once: lock held after push; cannot finalize audit record" >&2
    exit 1
fi
trap 'rmdir "$STATE_LOCK" 2>/dev/null || true' 0 1 2 3 15

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
    rmdir "$STATE_LOCK" 2>/dev/null || true
    trap - 0 1 2 3 15
    # Run verify-publication.sh
    verify_script="$PUBLICATION_SCRIPT_DIR/verify-publication.sh"
    if [ ! -f "$verify_script" ] || [ -L "$verify_script" ] || [ ! -x "$verify_script" ]; then
        echo "publish-once: mandatory verifier is unavailable; publication outcome is unverified. Gate remains consumed; do not retry automatically." >&2
        exit 1
    fi

    set +e
    case "$OPERATION" in
        CREATE_ANNOTATED_TAG_EXACT_OBJECT)
            "$verify_script" --operation "$OPERATION" --destination-ref "$DESTINATION_REF" --expected-object "$SOURCE_OBJECT" --expected-peeled-object "$(git rev-parse "$SOURCE_OBJECT^{}" 2>/dev/null || echo '')" --remote-url "$REMOTE_URL"
            verify_exit=$?
            ;;
        CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT|UPDATE_NON_PROTECTED_BRANCH_FAST_FORWARD)
            "$verify_script" --operation "$OPERATION" --destination-ref "$DESTINATION_REF" --expected-object "$SOURCE_OBJECT" --remote-url "$REMOTE_URL"
            verify_exit=$?
            ;;
        DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT)
            # Pass the exact pre-push canonical snapshot captured before the
            # deletion push. The verifier independently re-observes the canonical
            # ref AFTER the push and requires exact equality, proving preservation
            # across the deletion. This value is verification context only and is
            # not gate authority.
            [ -n "$CANONICAL_PRE_PUSH_OBJECT" ] || deny "missing pre-push canonical snapshot"
            "$verify_script" --operation "$OPERATION" --destination-ref "$DESTINATION_REF" --remote-url "$REMOTE_URL" --protected-ref "$PROTECTED_REF" --protected-canonical-object "$CANONICAL_PRE_PUSH_OBJECT"
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
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') event=$outcome nonce=$NONCE exit_code=$push_exit detail=$detail" >> "$AUDIT_LOG"
    echo "publish-once: push failed (exit $push_exit)" >&2
    echo "Gate state: consumed. Generate a new gate to retry." >&2
    exit 1
fi
