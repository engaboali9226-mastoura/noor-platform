#!/bin/sh
# Local test fixture. Refuse every request other than the exact identity probe.
set -eu
[ "$1" = --disable ]
[ "$5" = --location ]
[ "$6" = --max-redirs ]
[ "$7" = 0 ]
for argument in "$@"; do url=$argument; done
[ "$url" = 'https://api.github.com/repos/engaboali9226-mastoura/noor-platform' ]
printf '%s\n' '{"id":'"${NOOR_TEST_REPOSITORY_ID:-1284723703}"',"full_name":"engaboali9226-mastoura/noor-platform","clone_url":"https://github.com/engaboali9226-mastoura/noor-platform.git"}' "${NOOR_TEST_HTTP_STATUS:-200}"
