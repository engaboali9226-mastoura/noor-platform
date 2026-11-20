#!/usr/bin/env bash
# R386: isolated GitHub Actions container only; no network or live credentials.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test -n "${RUNNER_TEMP:-}"
test -n "${GITHUB_RUN_ID:-}"
name="noor-r386-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
tmp=$(mktemp -d "$RUNNER_TEMP/r386.XXXXXX")
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run -d --pull always --name "$name" --network none -e POSTGRES_PASSWORD=synthetic-r386-ci-only postgres:17-alpine >/dev/null
# The image bootstraps with a socket-only temporary server; wait for a real
# SQL query over loopback TCP from the final server, not pg_isready on its socket.
ready=0
for i in $(seq 1 60); do
 if docker exec -e PGPASSWORD=synthetic-r386-ci-only "$name" psql -X -h 127.0.0.1 -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c 'SELECT 1' 2>/dev/null | grep -qx 1; then ready=1; break; fi
 sleep 1
done
if test "$ready" != 1; then docker logs "$name"; echo R386_PG17_READINESS_FAILED; exit 1; fi
echo R386_PG17_TCP_READY
sql(){ docker exec -i "$name" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }
sql -c 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
sql -1 < tools/data-foundation/r386/staging-lab-schema.sql
sql -1 < tools/data-foundation/r386/staging-lab-v2.sql
sql < tools/data-foundation/r386/staging-lab-regression.sql
sql < tools/data-foundation/r386/staging-lab-atomic.sql
sql < tools/data-foundation/r386/staging-lab-logical-receipt.sql
sql < tools/data-foundation/r386/staging-lab-split-erasure.sql
sql < tools/data-foundation/r386/staging-lab-scale.sql
sql < tools/data-foundation/r386/structural-mirror.sql
for role in anon authenticated service_role; do
 if sql -c "SET ROLE $role; SELECT * FROM noor_r386_lab.event_history" >"$tmp/role" 2>&1; then echo "R386_ROLE_ACCESS_LEAK"; exit 1; fi
 grep -q 'permission denied' "$tmp/role"
done
test "$(sql -c 'SELECT (SELECT count(*) FROM noor_r386_lab.synthetic_source)+(SELECT count(*) FROM noor_r386_lab.event_history)+(SELECT count(*) FROM noor_r386_lab.checkpoint)+(SELECT count(*) FROM noor_r386_lab.command_receipt)')" = 0
sql -c "INSERT INTO noor_r386_lab.synthetic_source VALUES('synthetic-r386-race',0,'{\"outbox\":[],\"counter\":0}')"
# Connection A commits state and holds row lock while B attempts competing revision.
sql >"$tmp/a" 2>&1 <<'SQL' &
SET application_name='r386-race-a';
BEGIN;
SELECT noor_r386_lab.commit_owner('synthetic-r386-race','request-a',0,'{"outbox":[],"counter":1}');
SELECT pg_sleep(5);
COMMIT;
SQL
pid_a=$!
observed=0
for i in $(seq 1 40); do
 if test "$(sql -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='r386-race-a' AND wait_event='PgSleep'")" = 1; then observed=1; break; fi
 sleep 0.1
done
test "$observed" = 1
sql >"$tmp/b" 2>&1 <<'SQL' &
SET application_name='r386-race-b';
SELECT noor_r386_lab.commit_owner('synthetic-r386-race','request-b',0,'{"outbox":[],"counter":2}');
SQL
pid_b=$!
blocked=0
for i in $(seq 1 30); do
 if test "$(sql -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='r386-race-b' AND wait_event_type='Lock'")" = 1; then blocked=1; break; fi
 sleep 0.1
done
wait "$pid_a" || { cat "$tmp/a"; exit 1; }
if wait "$pid_b"; then echo R386_RACE_LOST_UPDATE; exit 1; fi
test "$blocked" = 1
grep -q R386_SOURCE_REVISION_CONFLICT "$tmp/b"
# Fresh connection retries acknowledged command without mutation.
test "$(sql -c "SELECT noor_r386_lab.commit_owner('synthetic-r386-race','request-a',0,'{\"outbox\":[],\"counter\":1}')")" = 1
test "$(sql -c "SELECT revision::text||':'||(state->>'counter')||':'||(SELECT count(*) FROM noor_r386_lab.command_receipt)::text FROM noor_r386_lab.synthetic_source WHERE owner_id='synthetic-r386-race'")" = "1:1:1"
echo R386_TWO_CONNECTION_CAS_AND_REPLAY_PASS
