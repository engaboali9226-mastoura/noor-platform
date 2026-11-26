# Sourced by the Policy-v6 publication tools.
require_default_git_config() {
    [ -z "${GIT_CONFIG+x}${GIT_CONFIG_COUNT+x}${GIT_CONFIG_PARAMETERS+x}${GIT_SSL_NO_VERIFY+x}" ] ||
        deny "inherited Git config or TLS override is not supported"
}

canonical_git() {
    GIT_ALLOW_PROTOCOL=https git -c http.followRedirects=false -c http.sslVerify=true "$@"
}

canonical_push() {
    GIT_ALLOW_PROTOCOL=https GIT_CONFIG_COUNT=3 \
        GIT_CONFIG_KEY_0=http.followRedirects GIT_CONFIG_VALUE_0=false \
        GIT_CONFIG_KEY_1=http.sslVerify GIT_CONFIG_VALUE_1=true \
        GIT_CONFIG_KEY_2=core.hooksPath GIT_CONFIG_VALUE_2="$COMMON_DIR/hooks" \
        git push -- "$CANONICAL_URL" "$1"
}

require_canonical_repository() {
    sh "$PUBLICATION_SCRIPT_DIR/../pre-push.noor-policy-hook" --preflight-transport ||
        deny "canonical repository identity or transport not verified"
}
