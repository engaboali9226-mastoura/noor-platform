#!/bin/sh
# Local test fixture. Refuse every request other than the exact identity probe.
set -eu
[ "$1" = --disable ]
[ "$5" = --location ]
[ "$6" = --max-redirs ]
[ "$7" = 0 ]
[ "$8" = --proto ] && [ "$9" = '=https' ]
[ "${NOOR_TEST_IDENTITY_UNAVAILABLE-}" != 1 ] || exit 28
for argument in "$@"; do url=$argument; done
[ "$url" = 'https://api.github.com/repos/engaboali9226-mastoura/noor-platform' ]
printf '{"id":%s,"full_name":"%s","clone_url":"%s"}\n%s\n' \
    "${NOOR_TEST_REPOSITORY_ID:-1284723703}" \
    "${NOOR_TEST_REPOSITORY_NAME:-engaboali9226-mastoura/noor-platform}" \
    'https://github.com/engaboali9226-mastoura/noor-platform.git' "${NOOR_TEST_HTTP_STATUS:-200}"
