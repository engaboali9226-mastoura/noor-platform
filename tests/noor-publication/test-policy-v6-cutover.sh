#!/bin/sh
set -eu
set -f

. "$(dirname "$0")/common.sh"
trap 'teardown_all' 0
trap 'exit 1' 1 2 3 15

expected_v5_sha=1f0154b7b59e22619487b6d00f652532f7d7a55d4e1aab4067e6bf64cb676e2c
v5_fixture=${1:?Provide the approved v5 hook bytes from the pinned baseline}
[ "$(shasum -a 256 "$v5_fixture" | awk '{print $1}')" = "$expected_v5_sha" ]

expect_rejection() {
    diagnostic=$1
    shift
    if "$@" > "$WORKSPACE/cutover.out" 2>&1; then
        cat "$WORKSPACE/cutover.out" >&2
        exit 1
    fi
    grep -F "$diagnostic" "$WORKSPACE/cutover.out" >/dev/null
}

begin_test repository-identity
setup_test_env
install_hook_in_test_repo
make_create_gate
(
    cd "$TEST_REPO"
    "$HOOK_TEMPLATE" --check-identity
    NOOR_TEST_REPOSITORY_ID=1 expect_rejection 'canonical repository identity mismatch' \
        etc/noor-publication/scripts/publish-once.sh
    NOOR_TEST_HTTP_STATUS=301 expect_rejection 'did not give a direct HTTP 200' \
        etc/noor-publication/scripts/publish-once.sh
    expect_rejection 'publication requires the exact canonical repository URL' \
        etc/noor-publication/scripts/publish-once.sh --remote-url "$MOCK_REMOTE"
    expect_rejection 'verification requires the exact canonical repository URL' \
        etc/noor-publication/scripts/verify-publication.sh --remote-url "$MOCK_REMOTE"
    suffix=$(printf '%s' "$TEST_COMMIT_IMPL" | cut -c1-12)
    NOOR_TEST_REPOSITORY_ID=1 expect_rejection 'canonical repository identity mismatch' \
        etc/noor-publication/scripts/verify-publication.sh \
        --operation CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT \
        --destination-ref "refs/heads/pub/$suffix" --expected-object "$TEST_COMMIT_IMPL"
)
assert_file_exists "$GATE_DIR/active.gate"
assert_file_absent "$GATE_DIR/audit.log"
pass
cleanup_test_env

begin_test effective-hook
setup_test_env
install_hook_in_test_repo
make_create_gate
(
    cd "$TEST_REPO"
    publisher=etc/noor-publication/scripts/publish-once.sh
    git config core.hooksPath alternate
    expect_rejection 'effective pre-push hook path differs' "$publisher"
    git config --unset core.hooksPath
    mv .git/hooks/pre-push .git/hooks/saved
    expect_rejection 'missing or not executable' "$publisher"
    mv .git/hooks/saved .git/hooks/pre-push
    chmod 0644 .git/hooks/pre-push
    expect_rejection 'missing or not executable' "$publisher"
    chmod 0755 .git/hooks/pre-push
    printf '\n# wrong hash\n' >> .git/hooks/pre-push
    expect_rejection 'SHA-256 differs' "$publisher"
)
assert_file_exists "$GATE_DIR/active.gate"
assert_file_absent "$GATE_DIR/audit.log"
pass
cleanup_test_env

begin_test redirects-and-old-policy
setup_test_env
install_hook_in_test_repo
make_create_gate
suffix=$(printf '%s' "$TEST_COMMIT_IMPL" | cut -c1-12)
dest_ref="refs/heads/pub/$suffix"
(
    cd "$TEST_REPO"
    printf '%s %s %s %s\n' refs/heads/product/noor-personal-mvp "$TEST_COMMIT_IMPL" "$dest_ref" "$ZERO_OBJECT" > "$WORKSPACE/input"
    git config http.followRedirects true
    expect_rejection 'HTTPS redirects must be disabled' \
        fixture_gate_hook "$CANONICAL_URL" "$CANONICAL_URL" < "$WORKSPACE/input"
    git config http.followRedirects false
    expect_rejection 'exact canonical repository URL' \
        fixture_gate_hook "$CANONICAL_URL" \
        https://github.com/engaboali9226-mastoura/work-tracker_OS.git < "$WORKSPACE/input"
    sed 's/^HOOK_POLICY_VERSION=6$/HOOK_POLICY_VERSION=5/; $d' "$GATE_DIR/active.gate" > "$WORKSPACE/v5-gate"
    digest=$(shasum -a 256 "$WORKSPACE/v5-gate" | awk '{print $1}')
    printf 'GATE_FILE_SHA256=%s\n' "$digest" >> "$WORKSPACE/v5-gate"
    cat "$WORKSPACE/v5-gate" > "$GATE_DIR/active.gate"
    expect_rejection 'hook policy version mismatch' \
        fixture_gate_hook "$CANONICAL_URL" "$CANONICAL_URL" < "$WORKSPACE/input"
)
assert_file_exists "$GATE_DIR/active.gate"
assert_file_absent "$GATE_DIR/consumed/$GATE_NONCE.gate"
pass
cleanup_test_env

begin_test exact-v5-rollback
setup_test_env
install_hook_in_test_repo
(
    cd "$TEST_REPO"
    backup="$GATE_DIR/backups/pre-push.$expected_v5_sha"
    printf 'older history\n' > "$GATE_DIR/consumed/history.gate"
    printf 'preserved audit\n' > "$GATE_DIR/audit.log"
    cp "$GATE_DIR/consumed/history.gate" "$WORKSPACE/expected.history"
    cp "$GATE_DIR/audit.log" "$WORKSPACE/expected.audit"
    printf 'a different backup\n' > "$GATE_DIR/backups/pre-push.zzzz"
    cp "$HOOK_TEMPLATE" "$backup"
    export APPROVED_HOOK_SHA256=$expected_v5_sha
    expect_rejection 'backup bytes differ' "$SCRIPTS_DIR/install-hook.sh" --restore --confirm
    cmp -s .git/hooks/pre-push "$HOOK_TEMPLATE"
    cp "$v5_fixture" "$backup"
    mkdir "$GATE_DIR/state.lock"
    expect_rejection 'state lock is held' "$SCRIPTS_DIR/install-hook.sh" --restore --confirm
    rmdir "$GATE_DIR/state.lock"
    umask 077
    printf 'synthetic active authority\n' > "$GATE_DIR/active.gate"
    expect_rejection 'revoke the active gate' "$SCRIPTS_DIR/install-hook.sh" --restore --confirm
    rm "$GATE_DIR/active.gate"
    "$SCRIPTS_DIR/install-hook.sh" --restore --confirm --dry-run
    cmp -s .git/hooks/pre-push "$HOOK_TEMPLATE"
    "$SCRIPTS_DIR/install-hook.sh" --restore --confirm
    test -x .git/hooks/pre-push
    cmp -s .git/hooks/pre-push "$v5_fixture"
    cmp -s "$GATE_DIR/consumed/history.gate" "$WORKSPACE/expected.history"
    cmp -s "$GATE_DIR/audit.log" "$WORKSPACE/expected.audit"
    test "$(git config --get remote.origin.pushurl)" = "$SENTINEL_URL"
)
pass
cleanup_test_env

begin_test publication-gate-binding
setup_test_env
install_hook_in_test_repo
make_create_gate
(
    cd "$TEST_REPO"
    bind_fixture_gate
    suffix=$(printf '%s' "$TEST_COMMIT_IMPL" | cut -c1-12)
    printf '%s %s %s %s\n' refs/heads/product/noor-personal-mvp "$TEST_COMMIT_IMPL" "refs/heads/pub/$suffix" "$ZERO_OBJECT" > "$WORKSPACE/input"
    cp "$GATE_DIR/active.gate" "$WORKSPACE/expected.gate"
    NOOR_PUBLICATION_GATE_NONCE='' expect_rejection 'active gate nonce differs' \
        .git/hooks/pre-push "$CANONICAL_URL" "$CANONICAL_URL" < "$WORKSPACE/input"
    NOOR_PUBLICATION_GATE_NONCE=00000000000000000000000000000000 \
        expect_rejection 'active gate nonce differs' \
        .git/hooks/pre-push "$CANONICAL_URL" "$CANONICAL_URL" < "$WORKSPACE/input"
    NOOR_PUBLICATION_GATE_SHA256=0000000000000000000000000000000000000000000000000000000000000000 \
        expect_rejection 'active gate SHA-256 differs' \
        .git/hooks/pre-push "$CANONICAL_URL" "$CANONICAL_URL" < "$WORKSPACE/input"
    cmp -s "$WORKSPACE/expected.gate" "$GATE_DIR/active.gate"
    test ! -e "$GATE_DIR/consumed/$GATE_NONCE.gate"
    test ! -e "$GATE_DIR/audit.log"
)
run_publish_once_with_candidate_hook "$WORKSPACE/gate-binding.out"
assert_exit 0 "$PUBLISH_ONCE_EXIT" "publisher passes the correct gate binding to the hook"
assert_file_exists "$GATE_DIR/consumed/$GATE_NONCE.gate"
cmp -s "$WORKSPACE/expected.gate" "$GATE_DIR/consumed/$GATE_NONCE.gate"
pass
cleanup_test_env

begin_test exact-origin-sentinel
setup_test_env
install_hook_in_test_repo
make_create_gate
(
    cd "$TEST_REPO"
    git config --add remote.origin.pushurl "$SENTINEL_URL"
    expect_rejection 'persistent push URL sentinel has been altered' \
        etc/noor-publication/scripts/publish-once.sh
    expect_rejection 'persistent push URL sentinel has been altered' \
        fixture_gate_hook "$CANONICAL_URL" "$CANONICAL_URL" < /dev/null
    expect_rejection 'persistent push URL must remain' "$SCRIPTS_DIR/install-hook.sh" --check
)
assert_file_exists "$GATE_DIR/active.gate"
assert_file_absent "$GATE_DIR/consumed/$GATE_NONCE.gate"
assert_file_absent "$GATE_DIR/audit.log"
pass
cleanup_test_env

begin_test archived-nonce-reservation
setup_test_env
install_hook_in_test_repo
make_create_gate
(
    cd "$TEST_REPO"
    suffix=$(printf '%s' "$TEST_COMMIT_IMPL" | cut -c1-12)
    dst="refs/heads/pub/$suffix"
    printf '%s %s %s %s\n' refs/heads/product/noor-personal-mvp "$TEST_COMMIT_IMPL" "$dst" "$ZERO_OBJECT" > "$WORKSPACE/input"
    cp "$GATE_DIR/active.gate" "$WORKSPACE/expected.gate"
    for history in consumed revoked; do
        archive="$GATE_DIR/$history/$GATE_NONCE.gate"
        printf 'synthetic archive record %s\n' "$history" > "$archive"
        cp "$archive" "$WORKSPACE/expected.$history"
        expect_rejection "nonce already $history" \
            fixture_gate_hook "$CANONICAL_URL" "$CANONICAL_URL" < "$WORKSPACE/input"
        cmp -s "$WORKSPACE/expected.gate" "$GATE_DIR/active.gate"
        rm "$GATE_DIR/active.gate"
        expect_rejection "nonce already $history" etc/noor-publication/scripts/generate-gate.sh \
            --operation CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT \
            --source-ref refs/heads/product/noor-personal-mvp --source-object "$TEST_COMMIT_IMPL" \
            --destination-ref "$dst" --required-remote-object "$ZERO_OBJECT" --nonce "$GATE_NONCE"
        test ! -e "$GATE_DIR/active.gate"
        cmp -s "$WORKSPACE/expected.$history" "$archive"
        rm "$archive"
        cp "$WORKSPACE/expected.gate" "$GATE_DIR/active.gate"
        chmod 0600 "$GATE_DIR/active.gate"
    done
)
assert_file_absent "$GATE_DIR/audit.log"
pass
cleanup_test_env

begin_test matching-verifier-toolset
setup_test_env
install_hook_in_test_repo
make_create_gate
target_verifier="$TEST_REPO/etc/noor-publication/scripts/verify-publication.sh"
printf '%s\n' '#!/bin/sh' 'exit 81' > "$target_verifier"
chmod 0755 "$target_verifier"
NOOR_TEST_PUBLISHER_SCRIPT="$SCRIPTS_DIR/publish-once.sh" \
    run_publish_once_with_candidate_hook "$WORKSPACE/matching-verifier.out"
assert_exit 0 "$PUBLISH_ONCE_EXIT" "publisher uses the verifier from its own toolset"
grep -F 'publication verified and completed successfully' "$WORKSPACE/matching-verifier.out"
pass
cleanup_test_env

[ "$PASS_COUNT" -eq 8 ] && [ "$FAIL_COUNT" -eq 0 ]
