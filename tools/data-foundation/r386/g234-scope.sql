-- R386 G2-G4 combined managed laboratory scope. NOT deployment DDL.
-- The fixture transaction marker and empty scope are required.
CREATE TABLE noor_r386_candidate.g234_scope (
 owner_id text PRIMARY KEY CHECK(owner_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
ALTER TABLE noor_r386_candidate.g234_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE noor_r386_candidate.g234_scope FORCE ROW LEVEL SECURITY;
REVOKE ALL ON noor_r386_candidate.g234_scope FROM PUBLIC,anon,authenticated,service_role;
