#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
unset GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT

. "$(dirname "$0")/common.sh"
trap 'teardown_all' 0
trap 'exit 1' HUP INT TERM

setup_configured_hook_fixture() {
    begin_test "$1"
    setup_test_env
    # Preserve argv boundaries on Bash 3.2 without changing the candidate.
    if ! bash -uc 'values=(); set -- "${values[@]}"' 2>/dev/null; then
        shim="$NOOR_TEST_GIT_SHIM/git"
        sed 's/"${git_config\[@\]}"/${git_config[@]+"${git_config[@]}"}/g' "$shim" > "$shim.compat"
        chmod 0755 "$shim.compat"
        mv "$shim.compat" "$shim"
    fi
    install_hook_in_test_repo
    make_create_gate
    cp "$GATE_DIR/active.gate" "$WORKSPACE/expected.gate"
    cp "$TEST_REPO/.git/hooks/pre-push" "$WORKSPACE/expected.hook"
    mkdir "$WORKSPACE/guard"
    cat > "$WORKSPACE/guard/git" <<'GIT_GUARD'
#!/bin/sh
set -eu
if [ "${1-}" = push ]; then
    printf '%s\n' push >> "$NOOR_TEST_PUSH_LOG"
    exit 91
fi
if [ "$#" -eq 5 ] && [ "$1 $2 $3 $4 $5" = 'config --includes --name-only --get-regexp ^hook\.' ]; then
    if [ "${TEST_CONFIG_QUERY_ERROR-}" = yes ]; then
        exit 2
    fi
    if [ -n "${TEST_CONFIG_MATCH_ON_SCAN-}" ]; then
        scans=$(cat "$TEST_CONFIG_SCAN_FILE")
        scans=$((scans + 1))
        printf '%s\n' "$scans" > "$TEST_CONFIG_SCAN_FILE"
        [ "$scans" -ne "$TEST_CONFIG_MATCH_ON_SCAN" ] || exit 0
    fi
fi
exec "$TEST_SHIM_GIT" "$@"
GIT_GUARD
    chmod 0755 "$WORKSPACE/guard/git"
    export TEST_SHIM_GIT="$NOOR_TEST_GIT_SHIM/git"
    export TEST_CONFIG_SCAN_FILE="$WORKSPACE/scan-count"
    export TEST_HOOK_MARKER="$WORKSPACE/configured-hook-invoked"
    cat > "$WORKSPACE/fixture-hook" <<'HOOK_MARKER'
#!/bin/sh
printf '%s\n' invoked > "$TEST_HOOK_MARKER"
HOOK_MARKER
    chmod 0755 "$WORKSPACE/fixture-hook"
    fixture_command="\"$WORKSPACE/fixture-hook\""
    publisher=etc/noor-publication/scripts/publish-once.sh
    suffix=$(printf '%s' "$TEST_COMMIT_IMPL" | cut -c1-12)
    destination="refs/heads/pub/$suffix"
}

expect_denied() {
    message=$1
    shift
    if (cd "$TEST_REPO" && PATH="$WORKSPACE/guard:$PATH" "$@") > "$WORKSPACE/denial.out" 2>&1; then
        printf 'Expected denial in %s\n' "$TEST_ID" >&2
        exit 1
    fi
    if ! grep -Fq "$message" "$WORKSPACE/denial.out"; then
        cat "$WORKSPACE/denial.out" >&2
        exit 1
    fi
}

assert_no_attempt() {
    test ! -e "$NOOR_TEST_PUSH_LOG"
    test ! -e "$TEST_HOOK_MARKER"
    test ! -e "$GATE_DIR/consumed/$GATE_NONCE.gate"
    test ! -e "$GATE_DIR/state.lock"
    test -z "$(git ls-remote --refs -- "$MOCK_REMOTE" "$destination")"
    cmp -s "$WORKSPACE/expected.gate" "$GATE_DIR/active.gate"
    cmp -s "$WORKSPACE/expected.hook" "$TEST_REPO/.git/hooks/pre-push"
}

finish_without_attempt() {
    assert_no_attempt
    test ! -e "$GATE_DIR/audit.log"
    pass
    cleanup_test_env
}

expect_configured_hook_denied() {
    expect_denied 'configured Git hooks are not supported' "$publisher"
}

set_configured_hook() {
    "$@" hook.fixture.command "$fixture_command"
    "$@" hook.fixture.event pre-push
}

setup_configured_hook_fixture local
set_configured_hook git -C "$TEST_REPO" config --local
listing_help=$(git -C "$TEST_REPO" hook list -h 2>&1 || :)
case "$listing_help" in
    *'usage: git hook list '*)
        listing=$(git -C "$TEST_REPO" hook list pre-push)
        test "$listing" = "$(printf '%s\n' fixture 'hook from hookdir')"
        printf '%s\n' 'GIT_HOOK_LIST_CONFIGURED_PLUS_TRADITIONAL=PASS'
        ;;
    *) printf '%s\n' 'GIT_HOOK_LIST=UNAVAILABLE' ;;
esac
expect_configured_hook_denied
expect_denied 'configured Git hooks are not supported' "$SCRIPTS_DIR/install-hook.sh" --check
finish_without_attempt

setup_configured_hook_fixture global
set_configured_hook git config --file "$WORKSPACE/global-config"
(
    export GIT_CONFIG_GLOBAL="$WORKSPACE/global-config"
    expect_configured_hook_denied
)
finish_without_attempt

setup_configured_hook_fixture include
set_configured_hook git config --file "$WORKSPACE/include-config"
git -C "$TEST_REPO" config --local include.path "$WORKSPACE/include-config"
expect_configured_hook_denied
finish_without_attempt

setup_configured_hook_fixture conditional-include
set_configured_hook git config --file "$WORKSPACE/conditional-config"
git -C "$TEST_REPO" config --local "includeIf.gitdir:$TEST_REPO/.git.path" "$WORKSPACE/conditional-config"
expect_configured_hook_denied
finish_without_attempt

setup_configured_hook_fixture worktree
git -C "$TEST_REPO" config extensions.worktreeConfig true
set_configured_hook git -C "$TEST_REPO" config --worktree
expect_configured_hook_denied
finish_without_attempt

setup_configured_hook_fixture conservative-namespace
git -C "$TEST_REPO" config Hook.MiXeD.Command "$fixture_command"
expect_configured_hook_denied
git -C "$TEST_REPO" config hook.MiXeD.event pre-commit
git -C "$TEST_REPO" config hook.MiXeD.enabled false
expect_configured_hook_denied
finish_without_attempt

setup_configured_hook_fixture command-injection
expect_denied 'inherited Git config' env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=hook.fixture.command \
    "GIT_CONFIG_VALUE_0=$fixture_command" "$publisher"
expect_denied 'inherited Git config' env "GIT_CONFIG_PARAMETERS='hook.fixture.event'='pre-push'" "$publisher"
finish_without_attempt

setup_configured_hook_fixture inspection-error
expect_denied 'cannot inspect Git configuration' env TEST_CONFIG_QUERY_ERROR=yes "$publisher"
expect_denied 'cannot inspect Git hook configuration' env TEST_CONFIG_QUERY_ERROR=yes \
    "$SCRIPTS_DIR/install-hook.sh" --check
printf '[invalid section\n' > "$WORKSPACE/malformed-config"
git -C "$TEST_REPO" config include.path "$WORKSPACE/malformed-config"
expect_denied 'cannot read Git configuration' "$SCRIPTS_DIR/install-hook.sh" --check
finish_without_attempt

setup_configured_hook_fixture shared-preflight
set_configured_hook git -C "$TEST_REPO" config --local
expect_denied 'configured Git hooks are not supported' "$HOOK_TEMPLATE" --preflight-transport
expect_denied 'configured Git hooks are not supported' "$HOOK_TEMPLATE" "$CANONICAL_URL" "$CANONICAL_URL" < /dev/null
expect_denied 'configured Git hooks are not supported' "$SCRIPTS_DIR/verify-publication.sh" \
    --operation CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT --destination-ref "$destination" --expected-object "$TEST_COMMIT_IMPL"
mv "$GATE_DIR/active.gate" "$WORKSPACE/saved-gate"
expect_denied 'configured Git hooks are not supported' "$SCRIPTS_DIR/generate-gate.sh" \
    --operation CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT --source-ref refs/heads/product/noor-personal-mvp \
    --source-object "$TEST_COMMIT_IMPL" --destination-ref "$destination" --required-remote-object "$ZERO_OBJECT"
test ! -e "$GATE_DIR/active.gate"
mv "$WORKSPACE/saved-gate" "$GATE_DIR/active.gate"
finish_without_attempt

setup_configured_hook_fixture pre-reservation-recheck
printf '0\n' > "$TEST_CONFIG_SCAN_FILE"
expect_denied 'not verified before reservation' env TEST_CONFIG_MATCH_ON_SCAN=2 "$publisher"
test "$(cat "$TEST_CONFIG_SCAN_FILE")" = 2
finish_without_attempt

setup_configured_hook_fixture pre-push-recheck
printf '0\n' > "$TEST_CONFIG_SCAN_FILE"
expect_denied 'not verified after reservation' env TEST_CONFIG_MATCH_ON_SCAN=3 "$publisher"
test "$(cat "$TEST_CONFIG_SCAN_FILE")" = 3
test "$(grep -Fc "event=PUSH_ATTEMPT nonce=$GATE_NONCE " "$GATE_DIR/audit.log")" = 1
expect_denied 'nonce already attempted' "$publisher"
test "$(grep -Fc "event=PUSH_ATTEMPT nonce=$GATE_NONCE " "$GATE_DIR/audit.log")" = 1
assert_no_attempt
pass
cleanup_test_env

setup_configured_hook_fixture clean-publication
git -C "$TEST_REPO" config --local fixture.unrelated enabled
case "$listing_help" in
    *'usage: git hook list '*)
        test "$(git -C "$TEST_REPO" hook list pre-push)" = 'hook from hookdir'
        printf '%s\n' 'GIT_HOOK_LIST_SOLE_TRADITIONAL=PASS'
        ;;
esac
run_publish_once_with_candidate_hook "$WORKSPACE/clean.out"
if [ "$PUBLISH_ONCE_EXIT" -ne 0 ]; then
    cat "$WORKSPACE/clean.out" >&2
    exit 1
fi
test "$(wc -l < "$NOOR_TEST_PUSH_LOG" | tr -d ' ')" = 1
test ! -e "$TEST_HOOK_MARKER"
test ! -e "$GATE_DIR/active.gate"
cmp -s "$WORKSPACE/expected.gate" "$GATE_DIR/consumed/$GATE_NONCE.gate"
remote_has_ref "$destination" "$TEST_COMMIT_IMPL"
grep -Fq 'publication verified and completed successfully' "$WORKSPACE/clean.out"
pass
cleanup_test_env

printf 'Configured-hook test groups passed: %s/%s\n' "$PASS_COUNT" "$TOTAL_TEST_COUNT"
test "$PASS_COUNT" -eq 12
test "$FAIL_COUNT" -eq 0
