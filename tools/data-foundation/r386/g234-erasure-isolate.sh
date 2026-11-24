#!/usr/bin/env bash
set -euo pipefail
umask 077
export SUPABASE_TELEMETRY_DISABLED=1
export SUPABASE_SERVICES_HOSTNAME=127.0.0.1

# GitHub-hosted runner or a disposable Docker host. No linked Supabase project.
cd -- "$(git rev-parse --show-toplevel)"
docker version --format '{{.Server.Version}}'
psql --version

lab_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/noor-r386-g1-XXXXXXXX")
supabase=(npx --yes supabase@3.3.0 --workdir "$lab_dir")
cleanup() {
  local result=$?
  if [[ -f "$lab_dir/supabase/config.toml" ]]; then
    "${supabase[@]}" stop --no-backup > "$lab_dir/stop.log" 2>&1 || result=1
  fi
  rm -rf -- "$lab_dir"
  exit "$result"
}
trap cleanup EXIT

"${supabase[@]}" init
cert_dir="$lab_dir/supabase"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=127.0.0.1 \
  -addext 'subjectAltName=IP:127.0.0.1' -keyout "$cert_dir/noor-lab.key" -out "$cert_dir/noor-lab.crt" \
  > "$lab_dir/openssl.log" 2>&1
"${supabase[@]}" gen signing-key --algorithm ES256 | jq -s '.' > "$cert_dir/noor-lab-signing.json"
sed -i \
  -e '/^\[api\.tls\]$/,/^\[/s/^enabled = false/enabled = true/' \
  -e 's/^# cert_path = .*/cert_path = "\.\/noor-lab.crt"/' \
  -e 's/^# key_path = .*/key_path = "\.\/noor-lab.key"/' \
  -e 's/^# signing_keys_path = .*/signing_keys_path = "\.\/noor-lab-signing.json"/' \
  -e '/^\[auth\.mfa\.totp\]$/,/^\[/s/^\(enroll_enabled\|verify_enabled\) = false/\1 = true/' \
  "$cert_dir/config.toml"
export NODE_EXTRA_CA_CERTS="$cert_dir/noor-lab.crt"
"${supabase[@]}" start -x realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
  > "$lab_dir/start.log" 2>&1 || {
    echo 'Supabase failed to start in the disposable Docker project.' >&2
    exit 1
  }
"${supabase[@]}" status --output json > "$lab_dir/status.json"
node --import tsx tools/data-foundation/r386/g234-erasure-regression.mjs "$lab_dir/status.json"
