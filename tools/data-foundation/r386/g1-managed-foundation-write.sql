-- Disposable G1 integration fixture only. Uses the original source table and
-- preserves its insert-or-CAS contract. Does not install a shadow writer.
DO $$ BEGIN
  IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL THEN
    RAISE EXCEPTION 'R386_G1_DISPOSABLE_FIXTURE_REQUIRED';
  END IF;
END $$;

GRANT INSERT(user_id,schema_version,revision,state,updated_at), UPDATE(state,updated_at)
  ON public.noor_personal_foundations TO noor_r386_g1_guard;
CREATE POLICY g1_guard_foundation_insert ON public.noor_personal_foundations
  FOR INSERT TO noor_r386_g1_guard WITH CHECK (true);

CREATE FUNCTION noor_r386_candidate.g1_authorized_operational_save(
  p_session text, p_owner text, p_exists boolean, p_revision bigint, p_state jsonb
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $g1$
BEGIN
  IF p_exists IS NULL OR p_revision IS NULL OR p_revision NOT BETWEEN 0 AND 9007199254740990
    OR (NOT p_exists AND p_revision <> 0)
    OR jsonb_typeof(p_state) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'R386_G1_OPERATIONAL_SAVE_INVALID'; END IF;

  IF noor_r386_candidate.g1_assert_committable_noor_owner(p_session,p_owner) IS DISTINCT FROM p_owner
  THEN RAISE EXCEPTION 'R386_G1_OPERATIONAL_OWNER_DENIED'; END IF;

  IF p_exists THEN
    UPDATE public.noor_personal_foundations
      SET revision=p_revision+1,state=p_state,updated_at=clock_timestamp()
      WHERE user_id=p_owner AND schema_version=1 AND revision=p_revision;
  ELSE
    INSERT INTO public.noor_personal_foundations(user_id,schema_version,revision,state,updated_at)
      VALUES (p_owner,1,1,p_state,clock_timestamp()) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN FOUND;
END $g1$;

REVOKE ALL ON FUNCTION noor_r386_candidate.g1_authorized_operational_save(text,text,boolean,bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_authorized_operational_save(text,text,boolean,bigint,jsonb)
  OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g1_authorized_operational_save(text,text,boolean,bigint,jsonb)
  TO noor_r386_g1_writer;
