# Sourced by the v6 publication scripts after defining their canonical URL.
canonical_git() {
    git -c http.followRedirects=false -c "http.$CANONICAL_URL.followRedirects=false" "$@"
}

require_canonical_repository() {
    sh "$PUBLICATION_SCRIPT_DIR/../pre-push.noor-policy-hook" --check-identity ||
        deny "canonical repository identity not verified"
}
