#!/bin/sh
set -eu
set -f
LC_ALL=C

# Noor Personal publication-control v4 publication verifier.
# Post-push verification: confirms the remote ref matches the expected object,
# and for DELETE verifies the protected canonical ref is preserved exactly.
#
# Usage:
#   verify-publication.sh --operation <OPERATION> --destination-ref <REF>
#       [--expected-object <OBJECT>] [--expected-peeled-object <COMMIT>]
#       [--protected-ref <REF>] [--protected-canonical-object <OBJECT>]
#       [--remote-url <URL>]

usage() {
    echo "Usage: verify-publication.sh --operation <OPERATION> --destination-ref <REF> [--expected-object <OBJECT>] [--expected-peeled-object <COMMIT>] [--protected-ref <REF>] [--protected-canonical-object <OBJECT>] [--remote-url <URL>]" >&2
    exit 2
}

deny() {
    echo "verify-publication: denied: $1" >&2
    exit 1
}

# Constants
CANONICAL_URL='https://github.com/engaboali9226-mastoura/noor-platform.git'
PUBLICATION_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
. "$PUBLICATION_SCRIPT_DIR/transport.sh"
require_default_git_config

DESTINATION_REF=''
EXPECTED_OBJECT=''
EXPECTED_PEELED_OBJECT=''
CANONICAL_PROTECTED_REF='refs/heads/product/noor-personal-mvp'
PROTECTED_REF=$CANONICAL_PROTECTED_REF
PROTECTED_CANONICAL_OBJECT=''
OPERATION=''
REMOTE_URL="$CANONICAL_URL"
CHECK_MODE=0
CONFIRM=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --destination-ref)
            shift
            [ "$#" -gt 0 ] || usage
            DESTINATION_REF=$1
            ;;
        --operation)
            shift
            [ "$#" -gt 0 ] || usage
            OPERATION=$1
            ;;
        --expected-object)
            shift
            [ "$#" -gt 0 ] || usage
            EXPECTED_OBJECT=$1
            ;;
        --expected-peeled-object)
            shift
            [ "$#" -gt 0 ] || usage
            EXPECTED_PEELED_OBJECT=$1
            ;;
        --protected-ref)
            shift
            [ "$#" -gt 0 ] || usage
            PROTECTED_REF=$1
            ;;
        --protected-canonical-object)
            shift
            [ "$#" -gt 0 ] || usage
            PROTECTED_CANONICAL_OBJECT=$1
            ;;
        --remote-url)
            shift
            [ "$#" -gt 0 ] || usage
            REMOTE_URL=$1
            ;;
        --check)
            CHECK_MODE=1
            ;;
        --confirm)
            CONFIRM=1
            ;;
        *)
            usage
            ;;
    esac
    shift
done

[ "$REMOTE_URL" = "$CANONICAL_URL" ] || deny "verification requires the exact canonical repository URL"

if [ "$CHECK_MODE" -eq 1 ]; then
    [ "$CONFIRM" -eq 1 ] || deny "explicit --confirm required"
    echo "verify-publication: check mode accepted"
    exit 0
fi

[ -n "$DESTINATION_REF" ] || usage
[ -n "$OPERATION" ] || usage

# Validate inputs
git check-ref-format "$DESTINATION_REF" || deny "invalid destination ref"
if [ "$OPERATION" != "DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT" ]; then
    [ -n "$EXPECTED_OBJECT" ] || usage
    printf '%s' "$EXPECTED_OBJECT" | grep -Eq '^[0-9a-f]{40}$' || deny "invalid expected object"
fi

case "$OPERATION" in
    CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT|UPDATE_NON_PROTECTED_BRANCH_FAST_FORWARD)
        case "$DESTINATION_REF" in refs/tags/*) deny "tag destination requires tag operation" ;; esac
        ;;
    CREATE_ANNOTATED_TAG_EXACT_OBJECT)
        case "$DESTINATION_REF" in refs/tags/*) ;; *) deny "tag operation destination is not a tag ref" ;; esac
        [ -n "$EXPECTED_OBJECT" ] || usage
        printf '%s' "$EXPECTED_PEELED_OBJECT" | grep -Eq '^[0-9a-f]{40}$' || deny "invalid expected peeled object"
        ;;
    DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT)
        case "$DESTINATION_REF" in refs/heads/*) ;; *) deny "delete operation destination is not a branch ref" ;; esac
        [ "$PROTECTED_REF" = "$CANONICAL_PROTECTED_REF" ] || deny "verification requires the canonical protected ref"
        [ -n "$PROTECTED_CANONICAL_OBJECT" ] || deny "required protected canonical object missing"
        printf '%s' "$PROTECTED_CANONICAL_OBJECT" | grep -Eq '^[0-9a-f]{40}$' || deny "invalid protected canonical object"
        ;;
    *)
        deny "unknown operation"
        ;;
esac

# Verify repository identity and then remote state.
require_canonical_repository
set +e
remote_line=$(canonical_git ls-remote --refs -- "$REMOTE_URL" "$DESTINATION_REF" 2>/dev/null)
remote_rc=$?
set -e
[ "$remote_rc" -eq 0 ] || deny "remote verification failed"

case "$OPERATION" in
    CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT|UPDATE_NON_PROTECTED_BRANCH_FAST_FORWARD)
        [ -n "$remote_line" ] || deny "destination ref not found on remote"
        set -- $remote_line
        [ "$#" -eq 2 ] || deny "remote state malformed"
        [ "$1" = "$EXPECTED_OBJECT" ] || deny "remote object does not match expected"
        [ "$2" = "$DESTINATION_REF" ] || deny "remote ref does not match expected"
        ;;
    CREATE_ANNOTATED_TAG_EXACT_OBJECT)
        [ -n "$remote_line" ] || deny "destination ref not found on remote"
        set -- $remote_line
        [ "$#" -eq 2 ] || deny "remote state malformed"
        [ "$1" = "$EXPECTED_OBJECT" ] || deny "remote object does not match expected"
        [ "$2" = "$DESTINATION_REF" ] || deny "remote ref does not match expected"
        set +e
        peeled_line=$(canonical_git ls-remote -- "$REMOTE_URL" "$DESTINATION_REF^{}" 2>/dev/null)
        peeled_rc=$?
        set -e
        [ "$peeled_rc" -eq 0 ] || deny "remote peeled verification failed"
        [ -n "$peeled_line" ] || deny "remote peeled tag ref not found"
        set -- $peeled_line
        [ "$#" -eq 2 ] || deny "remote peeled state malformed"
        [ "$1" = "$EXPECTED_PEELED_OBJECT" ] || deny "remote peeled object does not match expected"
        [ "$2" = "$DESTINATION_REF^{}" ] || deny "remote peeled ref does not match expected"
        ;;
    DELETE_NON_PROTECTED_BRANCH_EXACT_OBJECT)
        [ -z "$remote_line" ] || deny "destination ref still exists on remote after deletion"
        set +e
        protected_line=$(canonical_git ls-remote --refs -- "$REMOTE_URL" "$PROTECTED_REF" 2>/dev/null)
        protected_rc=$?
        set -e
        [ "$protected_rc" -eq 0 ] || deny "remote protected canonical verification failed"
        [ -n "$protected_line" ] || deny "protected canonical ref not found on remote"
        set -- $protected_line
        [ "$#" -eq 2 ] || deny "protected remote state malformed"
        [ "$1" = "$PROTECTED_CANONICAL_OBJECT" ] || deny "protected canonical ref changed after delete authorization"
        [ "$2" = "$PROTECTED_REF" ] || deny "protected canonical ref does not match expected"
        ;;
esac

echo "verify-publication: publication verified ($DESTINATION_REF)"
exit 0
