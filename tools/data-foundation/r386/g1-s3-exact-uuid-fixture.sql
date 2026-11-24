-- R386 G1 CI-only test compatibility: the checked-in S3 engine is explicitly
-- restricted to synthetic-r386-s3-* owner IDs, while real NOOR UserId is UUID.
-- Allow TWO exact fictional UUID owners solely inside the caller's BEGIN/ROLLBACK.
-- Never include this in runtime or production migrations.
DO $g1_uuid_scope$
DECLARE baseline text; ddl text; c_name text;
BEGIN
 IF current_user <> 'postgres' OR txid_current_if_assigned() IS NULL
    OR to_regclass('noor_r386_candidate.s3_enrollment') IS NULL
 THEN RAISE EXCEPTION 'R386_G1_UUID_FIXTURE_OUTSIDE_DISPOSABLE_TRANSACTION'; END IF;

 SELECT conname INTO c_name FROM pg_constraint
 WHERE conrelid='noor_r386_candidate.s3_enrollment'::regclass
 AND contype='c' AND pg_get_constraintdef(oid) LIKE '%synthetic-r386-s3-%';
 IF c_name IS NULL THEN RAISE EXCEPTION 'R386_G1_UUID_CHECK_NOT_PINNED'; END IF;
 EXECUTE format('ALTER TABLE noor_r386_candidate.s3_enrollment DROP CONSTRAINT %I',c_name);
 ALTER TABLE noor_r386_candidate.s3_enrollment
 ADD CONSTRAINT g1_uuid_fixture_exact_two_only
 CHECK (owner_id ~ '^synthetic-r386-s3-[a-z0-9-]+$'
  OR owner_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));

 SELECT pg_get_functiondef(
 'noor_r386_candidate.s3_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])'::regprocedure
 ) INTO ddl;
 IF ddl IS NULL OR position('^synthetic-r386-s3-[a-z0-9-]+$' IN ddl)=0
 THEN RAISE EXCEPTION 'R386_G1_S3_INPUT_GUARD_CHANGED'; END IF;
 ddl:=replace(ddl,'^synthetic-r386-s3-[a-z0-9-]+$',
 '^(synthetic-r386-s3-[a-z0-9-]+|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb)$');
 EXECUTE ddl;
 RAISE NOTICE 'R386_G1_EXACT_UUID_S3_SCOPE_ROLLBACK_ONLY_PASS';
END $g1_uuid_scope$;