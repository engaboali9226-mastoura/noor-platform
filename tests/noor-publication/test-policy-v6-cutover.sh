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
    if ! grep -F "$diagnostic" "$WORKSPACE/cutover.out" >/dev/null; then
        printf "Expected diagnostic: %s\n" "$diagnostic" >&2
        cat "$WORKSPACE/cutover.out" >&2
        exit 1
    fi
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
    NOOR_TEST_IDENTITY_UNAVAILABLE=1 expect_rejection 'canonical repository identity is unavailable' \
        etc/noor-publication/scripts/publish-once.sh
    NOOR_TEST_REPOSITORY_NAME=engaboali9226-mastoura/work-tracker_OS \
        expect_rejection 'canonical repository identity mismatch' \
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
    mv .git/hooks/pre-push .git/hooks/saved
    ln -s saved .git/hooks/pre-push
    expect_rejection 'effective pre-push hook path differs' "$publisher"
    rm .git/hooks/pre-push
    mv .git/hooks/saved .git/hooks/pre-push
    git config core.hooksPath "$TEST_REPO/.git/hooks"
    expect_rejection 'custom core.hooksPath' "$publisher"
    git config --unset core.hooksPath
    printf '\n# wrong hash\n' >> .git/hooks/pre-push
    expect_rejection 'SHA-256 differs' "$publisher"
    cp "$HOOK_TEMPLATE" .git/hooks/pre-push

    verifier=etc/noor-publication/scripts/verify-publication.sh
    printf '\n# wrong verifier hash\n' >> "$verifier"
    expect_rejection 'mandatory verifier is unavailable or differs' "$publisher"
    cp "$SCRIPTS_DIR/verify-publication.sh" "$verifier"
    chmod 0644 "$verifier"
    expect_rejection 'mandatory verifier is unavailable or not executable' "$publisher"
)
assert_file_absent "$NOOR_TEST_PUSH_LOG"
assert_eq "" "$(git ls-remote --refs -- "$MOCK_REMOTE" "refs/heads/pub/*")"
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
    expect_rejection 'hook policy version mismatch' etc/noor-publication/scripts/publish-once.sh
    expect_rejection 'hook policy version mismatch' \
        fixture_gate_hook "$CANONICAL_URL" "$CANONICAL_URL" < "$WORKSPACE/input"
)
assert_file_exists "$GATE_DIR/active.gate"
assert_file_absent "$GATE_DIR/consumed/$GATE_NONCE.gate"
assert_file_absent "$NOOR_TEST_PUSH_LOG"
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
    expect_rejection 'approved backup bytes mismatch' "$SCRIPTS_DIR/install-hook.sh" --restore "$expected_v5_sha" --confirm
    cmp -s .git/hooks/pre-push "$HOOK_TEMPLATE"
    cp "$v5_fixture" "$backup"
    mkdir "$GATE_DIR/state.lock"
    expect_rejection 'state lock held' "$SCRIPTS_DIR/install-hook.sh" --restore "$expected_v5_sha" --confirm
    rmdir "$GATE_DIR/state.lock"
    umask 077
    printf 'synthetic active authority\n' > "$GATE_DIR/active.gate"
    expect_rejection 'pending authority or consume lock' "$SCRIPTS_DIR/install-hook.sh" --restore "$expected_v5_sha" --confirm
    rm "$GATE_DIR/active.gate"
    "$SCRIPTS_DIR/install-hook.sh" --restore "$expected_v5_sha" --confirm --dry-run
    cmp -s .git/hooks/pre-push "$HOOK_TEMPLATE"
    "$SCRIPTS_DIR/install-hook.sh" --restore "$expected_v5_sha" --confirm
    test -x .git/hooks/pre-push
    cmp -s .git/hooks/pre-push "$v5_fixture"
    cmp -s "$GATE_DIR/consumed/history.gate" "$WORKSPACE/expected.history"
    head -n 1 "$GATE_DIR/audit.log" | cmp -s - "$WORKSPACE/expected.audit"
    grep -F "event=HOOK_RESTORE_VERIFIED installed_sha256=$expected_v5_sha" "$GATE_DIR/audit.log" >/dev/null
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

begin_test transport-config-rejection
setup_test_env
install_hook_in_test_repo
make_create_gate
(
    cd "$TEST_REPO"
    publisher=etc/noor-publication/scripts/publish-once.sh
    generator=etc/noor-publication/scripts/generate-gate.sh
    verifier=etc/noor-publication/scripts/verify-publication.sh
    suffix=$(printf '%s' "$TEST_COMMIT_IMPL" | cut -c1-12)
    dst="refs/heads/pub/$suffix"
    git config --file "$WORKSPACE/transport.ini" "http.$CANONICAL_URL.followRedirects" true
    git config include.path "$WORKSPACE/transport.ini"
    expect_rejection 'URL-scoped HTTP configuration is not supported' "$publisher"
    mv "$GATE_DIR/active.gate" "$WORKSPACE/fixture-gate"
    expect_rejection 'URL-scoped HTTP configuration is not supported' "$generator" \
        --operation CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT \
        --source-ref refs/heads/product/noor-personal-mvp --source-object "$TEST_COMMIT_IMPL" \
        --destination-ref "$dst" --required-remote-object "$ZERO_OBJECT"
    test ! -e "$GATE_DIR/active.gate"
    mv "$WORKSPACE/fixture-gate" "$GATE_DIR/active.gate"
    expect_rejection 'URL-scoped HTTP configuration is not supported' "$verifier" \
        --operation CREATE_NON_PROTECTED_BRANCH_EXACT_OBJECT \
        --destination-ref "$dst" --expected-object "$TEST_COMMIT_IMPL"
    expect_rejection 'URL-scoped HTTP configuration is not supported' \
        fixture_gate_hook "$CANONICAL_URL" "$CANONICAL_URL" < /dev/null
    git config --unset include.path
    git config url.https://example.invalid/.insteadOf "$CANONICAL_URL"
    expect_rejection 'Git URL rewrite' "$publisher"
    git config --unset url.https://example.invalid/.insteadOf
    git config url.https://example.invalid/.pushInsteadOf "$CANONICAL_URL"
    expect_rejection 'Git URL rewrite' "$publisher"
    git config --unset url.https://example.invalid/.pushInsteadOf
    git config "remote.$CANONICAL_URL.url" "$MOCK_REMOTE"
    expect_rejection 'canonical URL used as configured remote name' "$publisher"
    git config --unset "remote.$CANONICAL_URL.url"
    GIT_CONFIG_COUNT=0 expect_rejection 'inherited Git config' "$publisher"
    GIT_CONFIG_PARAMETERS="'core.hooksPath'='alternate'" expect_rejection 'inherited Git config' "$publisher"
    GIT_SSL_NO_VERIFY=1 expect_rejection 'TLS override is not supported' "$publisher"
    git config http.sslVerify false
    expect_rejection 'HTTPS certificate verification must stay enabled' "$publisher"
)
assert_file_exists "$GATE_DIR/active.gate"
assert_file_absent "$GATE_DIR/audit.log"
assert_file_absent "$NOOR_TEST_PUSH_LOG"
assert_eq "" "$(git ls-remote --refs -- "$MOCK_REMOTE" "refs/heads/pub/*")"
pass
cleanup_test_env

begin_test uncertain-push-no-retry
setup_test_env
install_hook_in_test_repo
make_create_gate
cp "$GATE_DIR/active.gate" "$WORKSPACE/expected.gate"
NOOR_TEST_PUSH_UNAVAILABLE=1 run_publish_once_with_candidate_hook "$WORKSPACE/uncertain.out"
assert_exit 1 "$PUBLISH_ONCE_EXIT" "unverified outcome fails closed"
grep -F "event=PUSH_OUTCOME_UNVERIFIED nonce=$GATE_NONCE" "$GATE_DIR/audit.log" >/dev/null
run_publish_once_with_candidate_hook "$WORKSPACE/no-retry.out"
assert_exit 1 "$PUBLISH_ONCE_EXIT" "uncertain nonce cannot be attempted again"
grep -F 'nonce already attempted; reconcile remote state' "$WORKSPACE/no-retry.out" >/dev/null
assert_eq 1 "$(wc -l < "$NOOR_TEST_PUSH_LOG" | tr -d ' ')"
cmp -s "$WORKSPACE/expected.gate" "$GATE_DIR/active.gate"
assert_file_absent "$GATE_DIR/consumed/$GATE_NONCE.gate"
assert_eq "" "$(git ls-remote --refs -- "$MOCK_REMOTE" "refs/heads/pub/*")"
pass
cleanup_test_env

[ "$PASS_COUNT" -eq 10 ] && [ "$FAIL_COUNT" -eq 0 ]
