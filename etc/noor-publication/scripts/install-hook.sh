#!/bin/sh
set -eu
set -f
LC_ALL=C

# Noor Personal Publication Control — exact reviewed hook installer (v6 candidate).
# Installs the canonical pre-push hook from an exact reviewed commit.
#
# Modes:
#   install-hook.sh --from-commit <COMMIT> [--dry-run]
#       Extract hook from <COMMIT>:etc/noor-publication/pre-push.noor-policy-hook
#       and install it as .git/hooks/pre-push (backing up any existing hook
#       without overwrite). Requires --confirm and APPROVED_HOOK_SHA256.
#   install-hook.sh --check
#       Verify the installed hook matches the canonical template.
#   install-hook.sh --restore <SHA256> --confirm [--dry-run]
#       Restore only a separately approved, exact content-addressed backup.
#       Requires APPROVED_HOOK_SHA256 equal to <SHA256>.
#
# The installer never writes to .git/config.

usage() {
    echo "Usage: install-hook.sh --from-commit <COMMIT> [--confirm] [--dry-run]" >&2
    echo "       install-hook.sh --check" >&2
    echo "       install-hook.sh --restore <SHA256> --confirm [--dry-run]" >&2
    exit 2
}

deny() {
    echo "install-hook: denied: $1" >&2
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
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SOURCE_REPOSITORY=''
CANONICAL_HOOK_PATH='etc/noor-publication/pre-push.noor-policy-hook'
SENTINEL_URL='no_push://noor-personal-dev'
GATE_DIR_NAME='noor-publication-gate'
BACKUP_DIR_NAME='backups'

resolve_source_repository() {
    candidate=$SCRIPT_DIR
    while [ "$candidate" != '/' ]; do
        if [ -d "$candidate/.git" ]; then
            SOURCE_REPOSITORY=$(CDPATH= cd -- "$candidate" && pwd -P)
            return 0
        fi
        candidate=$(CDPATH= cd -- "$candidate/.." && pwd -P) || return 1
    done
    return 1
}

# Parse arguments
MODE=''
FROM_COMMIT=''
RESTORE_SHA=''
CONFIRM=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --from-commit)
            [ -z "$MODE" ] || usage
            MODE='from-commit'
            shift
            [ "$#" -gt 0 ] || usage
            FROM_COMMIT=$1
            ;;
        --check)
            [ -z "$MODE" ] || usage
            MODE='check'
            ;;
        --restore)
            [ -z "$MODE" ] || usage
            MODE='restore'
            shift
            [ "$#" -gt 0 ] || usage
            RESTORE_SHA=$1
            ;;
        --confirm)
            CONFIRM=1
            ;;
        --dry-run)
            DRY_RUN=1
            ;;
        *)
            usage
            ;;
    esac
    shift
done

[ -n "$MODE" ] || usage

# Refuse unsupported config injection rather than silently ignoring it.
[ -z "${GIT_CONFIG_COUNT+x}${GIT_CONFIG_PARAMETERS+x}${GIT_CONFIG+x}" ] ||
    deny "inherited Git config override is not supported"
git config --includes --list >/dev/null 2>&1 || deny "cannot read Git configuration"
if git config --includes --name-only --get-regexp '^hook\.' >/dev/null 2>&1; then
    deny "configured Git hooks are not supported"
else
    [ "$?" -eq 1 ] || deny "cannot inspect Git hook configuration"
fi
resolve_source_repository || deny "cannot resolve source repository"

# Resolve git paths
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || deny "not a git repository"
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null) || deny "common dir unavailable"
case "$COMMON_DIR" in
    /*) ;;
    *) COMMON_DIR=$REPO_ROOT/$COMMON_DIR ;;
esac
COMMON_DIR=$(cd "$COMMON_DIR" 2>/dev/null && pwd -P) || deny "cannot canonicalize common dir"

GATE_DIR=$COMMON_DIR/$GATE_DIR_NAME
BACKUP_DIR=$GATE_DIR/$BACKUP_DIR_NAME
HOOK_PATH=$COMMON_DIR/hooks/pre-push

# Prove Git's actual hook resolution; custom paths are not supported.
if git config --get-all core.hooksPath >/dev/null 2>&1; then
    deny "custom core.hooksPath is not supported"
else
    config_rc=$?
    [ "$config_rc" -eq 1 ] || deny "cannot inspect core.hooksPath"
fi
[ -d "$COMMON_DIR/hooks" ] && [ ! -L "$COMMON_DIR/hooks" ] || deny "invalid hooks directory"
resolved_hook=$(git -C "$REPO_ROOT" rev-parse --git-path hooks/pre-push) || deny "cannot resolve effective hook"
case "$resolved_hook" in /*) ;; *) resolved_hook=$REPO_ROOT/$resolved_hook ;; esac
resolved_parent=$(CDPATH= cd -- "$(dirname -- "$resolved_hook")" && pwd -P) || deny "cannot resolve effective hooks directory"
[ "$resolved_parent/pre-push" = "$HOOK_PATH" ] || deny "effective hook path mismatch"
[ "$(basename -- "$resolved_hook")" = pre-push ] || deny "effective hook filename mismatch"
[ ! -L "$HOOK_PATH" ] || deny "symlink hook is forbidden"
if [ -e "$HOOK_PATH" ]; then
    [ -f "$HOOK_PATH" ] || deny "installed hook is not a regular file"
fi

# Ensure runtime directories exist (bootstrap); do not follow symlinks.
[ ! -L "$GATE_DIR" ] && [ ! -L "$BACKUP_DIR" ] || deny "symlink gate directory is forbidden"
mkdir -p "$GATE_DIR" "$BACKUP_DIR"
chmod 0700 "$GATE_DIR" "$BACKUP_DIR"

# Serialize installation/restoration against gate operations. A separately
# enforced operator publication freeze is also required for any cutover.
STATE_LOCK=$GATE_DIR/state.lock
TMP_HOOK=''
if [ "$MODE" != check ]; then
    mkdir "$STATE_LOCK" 2>/dev/null || deny "state lock held"
    trap '[ -z "$TMP_HOOK" ] || rm -f -- "$TMP_HOOK"; rmdir "$STATE_LOCK" 2>/dev/null || true' 0
    trap 'exit 1' HUP INT TERM
    for pending in active.gate consume.lock; do
        [ ! -e "$GATE_DIR/$pending" ] && [ ! -L "$GATE_DIR/$pending" ] || deny "pending authority or consume lock"
    done
fi

backup_installed_hook() {
    [ -e "$HOOK_PATH" ] || return 0
    [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ] || deny "invalid installed hook"
    old_sha=$(compute_sha256 "$HOOK_PATH") || deny "cannot hash installed hook"
    printf '%s\n' "$old_sha" | grep -Eq '^[0-9a-f]{64}$' || deny "invalid installed hook hash"
    backup="$BACKUP_DIR/pre-push.$old_sha"
    if [ -e "$backup" ] || [ -L "$backup" ]; then
        [ -f "$backup" ] && [ ! -L "$backup" ] || deny "invalid existing backup"
        [ "$(compute_sha256 "$backup")" = "$old_sha" ] || deny "existing backup hash mismatch"
    elif [ "$DRY_RUN" -eq 0 ]; then
        (umask 077; set -C; cat "$HOOK_PATH" > "$backup") || deny "cannot preserve existing hook"
        [ "$(compute_sha256 "$backup")" = "$old_sha" ] || deny "backup verification failed"
    fi
}

install_exact_bytes() {
    expected_sha=$1
    [ -f "$TMP_HOOK" ] && [ ! -L "$TMP_HOOK" ] || deny "invalid temporary hook"
    [ "$(compute_sha256 "$TMP_HOOK")" = "$expected_sha" ] || deny "temporary hook hash mismatch"
    backup_installed_hook
    if [ "$DRY_RUN" -eq 0 ]; then
        chmod 0755 "$TMP_HOOK" || deny "cannot make hook executable"
        mv -f -- "$TMP_HOOK" "$HOOK_PATH" || deny "cannot install exact hook"
        TMP_HOOK=''
        [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ] && [ -x "$HOOK_PATH" ] || deny "installed hook is not executable regular file"
        [ "$(compute_sha256 "$HOOK_PATH")" = "$expected_sha" ] || deny "installed hook hash mismatch"
    fi
}

# Verify persistent push URL sentinel is intact
current_pushurl=$(git remote get-url --push --all origin 2>/dev/null && printf '.') ||
    deny "cannot resolve effective origin push URLs"
[ "$current_pushurl" = "$(printf '%s\n.' "$SENTINEL_URL")" ] ||
    deny "persistent push URL must remain no_push://noor-personal-dev"

case "$MODE" in
    from-commit)
        [ "$CONFIRM" -eq 1 ] || deny "explicit --confirm required"
        [ -n "${APPROVED_HOOK_SHA256-}" ] ||
            deny "APPROVED_HOOK_SHA256 environment variable is required"

        printf '%s\n' "$FROM_COMMIT" | grep -Eq '^[0-9a-f]{40}$' ||
            deny "approved implementation commit must be a full 40-character lowercase hexadecimal object ID"

        git -C "$SOURCE_REPOSITORY" cat-file -e "$FROM_COMMIT^{commit}" 2>/dev/null ||
            deny "approved implementation commit is not a valid commit"

        object_type=$(git -C "$SOURCE_REPOSITORY" cat-file -t "$FROM_COMMIT" 2>/dev/null || true)
        [ "$object_type" = "commit" ] || deny "approved implementation commit is not a commit"

        if ! git -C "$SOURCE_REPOSITORY" diff --quiet -- etc/noor-publication docs/noor/personal-publication-control.md tests/noor-publication; then
            deny "tracked publication-control artifacts are dirty in source repository"
        fi

        if ! git -C "$SOURCE_REPOSITORY" diff --cached --quiet -- etc/noor-publication docs/noor/personal-publication-control.md tests/noor-publication; then
            deny "tracked publication-control artifacts are staged as dirty in source repository"
        fi

        TMP_HOOK=$(mktemp "$COMMON_DIR/hooks/.pre-push.tmp.XXXXXX") || deny "unable to create temporary hook file"
        chmod 0600 "$TMP_HOOK"
        if ! git -C "$SOURCE_REPOSITORY" show "$FROM_COMMIT:$CANONICAL_HOOK_PATH" > "$TMP_HOOK" 2>/dev/null; then
            rm -f "$TMP_HOOK"
            deny "cannot extract canonical hook from approved commit"
        fi

        extracted_sha=$(compute_sha256 "$TMP_HOOK")
        [ "$extracted_sha" = "$APPROVED_HOOK_SHA256" ] || {
            rm -f "$TMP_HOOK"
            deny "extracted hook does not match approval record"
        }

        head -c 2 "$TMP_HOOK" | od -An -t c | grep -q '  #' || {
            rm -f "$TMP_HOOK"
            deny "extracted hook is missing shebang"
        }
        head -n 1 "$TMP_HOOK" | grep -q '^#!.*sh' || {
            rm -f "$TMP_HOOK"
            deny "extracted hook shebang is not sh"
        }

        if [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ] && [ -x "$HOOK_PATH" ] &&
            [ "$(compute_sha256 "$HOOK_PATH")" = "$extracted_sha" ]; then
            echo "install-hook: hook already matches canonical; executable verified"
            exit 0
        fi
        install_exact_bytes "$extracted_sha"
        if [ "$DRY_RUN" -eq 1 ]; then
            echo "install-hook: dry run verified; no hook changed"
            exit 0
        fi

        echo "install-hook: hook installed successfully from commit $FROM_COMMIT"
        exit 0
        ;;

    check)
        if ! git -C "$SOURCE_REPOSITORY" diff --quiet -- etc/noor-publication docs/noor/personal-publication-control.md tests/noor-publication; then
            deny "tracked publication-control artifacts are dirty in source repository"
        fi

        if ! git -C "$SOURCE_REPOSITORY" diff --cached --quiet -- etc/noor-publication docs/noor/personal-publication-control.md tests/noor-publication; then
            deny "tracked publication-control artifacts are staged as dirty in source repository"
        fi

        TMP_HOOK="$GATE_DIR/.hook.check.$$"
        git -C "$SOURCE_REPOSITORY" show "HEAD:$CANONICAL_HOOK_PATH" > "$TMP_HOOK" 2>/dev/null ||
            deny "cannot read canonical hook from HEAD"

        canonical_sha=$(compute_sha256 "$TMP_HOOK")
        rm -f "$TMP_HOOK"

        if [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ] && [ -x "$HOOK_PATH" ]; then
            installed_sha=$(compute_sha256 "$HOOK_PATH")
        else
            deny "no pre-push hook installed"
        fi

        if [ "$installed_sha" = "$canonical_sha" ]; then
            echo "install-hook: hook hash matches canonical"
            exit 0
        else
            deny "hook hash drift detected; freeze publication and obtain exact restoration authority"
        fi
        ;;

    restore)
        [ "$CONFIRM" -eq 1 ] || deny "explicit --confirm required"

        printf '%s\n' "$RESTORE_SHA" | grep -Eq '^[0-9a-f]{64}$' || deny "exact restore SHA256 required"
        [ "${APPROVED_HOOK_SHA256-}" = "$RESTORE_SHA" ] || deny "restore hash does not match separate approval"
        approved_backup="$BACKUP_DIR/pre-push.$RESTORE_SHA"
        [ -f "$approved_backup" ] && [ ! -L "$approved_backup" ] || deny "approved backup is missing or invalid"
        [ "$(compute_sha256 "$approved_backup")" = "$RESTORE_SHA" ] || deny "approved backup bytes mismatch"
        TMP_HOOK=$(mktemp "$COMMON_DIR/hooks/.pre-push.tmp.XXXXXX") || deny "cannot create temporary hook"
        cat "$approved_backup" > "$TMP_HOOK" || deny "cannot read approved backup"
        audit_log="$GATE_DIR/audit.log"
        [ ! -L "$audit_log" ] || deny "symlink audit log is forbidden"
        if [ -e "$audit_log" ]; then
            [ -f "$audit_log" ] || deny "invalid audit log"
        fi
        if [ "$DRY_RUN" -eq 0 ]; then
            (umask 077; printf '%s event=HOOK_RESTORE_ATTEMPT approved_sha256=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RESTORE_SHA" >> "$audit_log") || deny "cannot record restore attempt"
        fi
        install_exact_bytes "$RESTORE_SHA"
        if [ "$DRY_RUN" -eq 1 ]; then
            echo "install-hook: exact restore dry run verified; no hook changed"
        else
            (umask 077; printf '%s event=HOOK_RESTORE_VERIFIED installed_sha256=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RESTORE_SHA" >> "$audit_log") || deny "restore outcome unrecorded; keep publication frozen"
            echo "install-hook: exact restore verified SHA256=$RESTORE_SHA"
        fi
        exit 0
        ;;

    *)
        usage
        ;;
esac
