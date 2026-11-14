import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const buildDir =
  process.env.NOOR_PERSONAL_BUILD_DIR ?? "dist";

const moduleUrl =
  pathToFileURL(
    path.resolve(
      buildDir,
      "infrastructure/supabase-postgres-personal-foundation-persistence.js",
    ),
  ).href;

function createClient() {
  let row =
    null;

  function selectResult(
    filter,
  ) {
    if (
      row
      && (
        filter.user_id === undefined
        || row.user_id === filter.user_id
      )
    ) {
      return [
        structuredClone(
          row,
        ),
      ];
    }

    return [];
  }

  function builder() {
    const filter = {};

    return {
      select() {
        return this;
      },

      eq(
        key,
        value,
      ) {
        filter[key] =
          value;

        return this;
      },

      async limit() {
        return {
          error:
            null,
          data:
            selectResult(
              filter,
            ),
        };
      },

      insert(
        value,
      ) {
        return {
          async select() {
            if (row) {
              return {
                error: {
                  code:
                    "23505",
                },
                data:
                  null,
              };
            }

            row = {
              ...structuredClone(
                value,
              ),
              created_at:
                "2026-08-22T00:00:00.000Z",
              updated_at:
                value.updated_at
                ?? "2026-08-22T00:00:00.000Z",
            };

            return {
              error:
                null,
              data: [
                {
                  revision:
                    row.revision,
                },
              ],
            };
          },
        };
      },

      update(
        value,
      ) {
        const updateFilter = {};

        return {
          eq(
            key,
            expected,
          ) {
            updateFilter[key] =
              expected;

            return this;
          },

          async select() {
            if (
              !row
              || row.user_id
                !== updateFilter.user_id
              || row.revision
                !== updateFilter.revision
            ) {
              return {
                error:
                  null,
                data:
                  [],
              };
            }

            row = {
              ...row,
              ...structuredClone(
                value,
              ),
            };

            return {
              error:
                null,
              data: [
                {
                  revision:
                    row.revision,
                },
              ],
            };
          },
        };
      },
    };
  }

  return {
    client: {
      from() {
        return builder();
      },
    },

    snapshot() {
      return structuredClone(
        row,
      );
    },
  };
}

function writeDefinition(tx, title) {
  tx.saveDefinition({ id:"scope-definition", userId:"user-1", kind:"Task", revisionId:"scope-revision", title,
    state:"Active", schedule:{kind:"OneTime", localDate:"2026-08-22"}, effectiveFromDate:"2026-08-22",
    importance:"Supporting", weight:1, gatePolicy:"NonBlocking", targets:{} });
}

test(
  "operation scope loads once and commits exactly one new revision",
  async () => {
    const {
      SupabasePostgresPersonalFoundationPersistence,
    } =
      await import(moduleUrl);

    const fake =
      createClient();

    const persistence =
      new SupabasePostgresPersonalFoundationPersistence(
        fake.client,
      );

    await persistence.initialize();

    const scope =
      await persistence.openOperation(
        "user-1",
      );

    assert.equal(
      await scope.locations.getEffective(
        "user-1",
        "2026-08-22T09:00:00.000Z",
      ),
      null,
    );

    assert.equal(
      await scope.prayerPolicies.getEffective(
        "user-1",
        "2026-08-22T09:00:00.000Z",
      ),
      null,
    );

    const result =
      await scope.transaction
        .runInTransaction(
          tx => { writeDefinition(tx,"first commit"); return "committed"; },
        );

    assert.equal(
      result,
      "committed",
    );

    assert.equal(
      fake.snapshot()
        .revision,
      1,
    );

    await assert.rejects(
      () =>
        scope.transaction
          .runInTransaction(
            () =>
              "retry",
          ),
      error =>
        error?.code
          === "AdapterLifecycleViolation",
    );
  },
);

test(
  "stale operation scope fails with PersistenceConflict and does not retry",
  async () => {
    const {
      SupabasePostgresPersonalFoundationPersistence,
    } =
      await import(moduleUrl);

    const fake =
      createClient();

    const persistence =
      new SupabasePostgresPersonalFoundationPersistence(
        fake.client,
      );

    await persistence.initialize();

    await (
      await persistence.openOperation(
        "user-1",
      )
    ).transaction.runInTransaction(
      tx => writeDefinition(tx,"initial"),
    );

    const first =
      await persistence.openOperation(
        "user-1",
      );

    const stale =
      await persistence.openOperation(
        "user-1",
      );

    await first.transaction
      .runInTransaction(
        tx => writeDefinition(tx,"updated"),
      );

    assert.equal(
      fake.snapshot()
        .revision,
      2,
    );

    await assert.rejects(
      () =>
        stale.transaction
          .runInTransaction(
            tx => writeDefinition(tx,"stale attempted update"),
          ),
      error =>
        error?.code
          === "PersistenceConflict",
    );

    assert.equal(
      fake.snapshot()
        .revision,
      2,
    );
  },
);

test("an empty Foundation transaction commits no database revision", async () => {
 const {SupabasePostgresPersonalFoundationPersistence}=await import(moduleUrl);
 const fake=createClient();const persistence=new SupabasePostgresPersonalFoundationPersistence(fake.client);
 await persistence.initialize();const scope=await persistence.openOperation("user-1");
 assert.equal(await scope.transaction.runInTransaction(()=>"unchanged"),"unchanged");
 assert.equal(fake.snapshot(),null);
});

test("R334 policy and frozen day snapshot survive durable JSONB adapter reload and ownership checks",async()=>{
 const {SupabasePostgresPersonalFoundationPersistence}=await import(moduleUrl);
 const fake=createClient(), persistence=new SupabasePostgresPersonalFoundationPersistence(fake.client);
 await persistence.initialize();
 const scope=await persistence.openOperation("user-1");
 const policy={policyId:"p-r334",effectiveFromDate:"2026-08-23",weights:{fajr:30,dhuhr:30,asr:30,maghrib:30,isha:30},shares:{group:{ontime:1,late:.4},excused:{ontime:.8,late:.3},unexcused:{ontime:.5,late:.1}},legacyHabitKeys:{}};
 const day={id:"r334-day",userId:"user-1",boundary:{key:"personal-day-civil:user-1:2026-08-23",localDate:"2026-08-23",startAt:"2026-08-22T21:00:00.000Z",endAt:"2026-08-23T21:00:00.000Z"},state:"Open",version:1,createdAt:"2026-08-22T21:00:00.000Z",updatedAt:"2026-08-22T21:00:00.000Z",prayerScoreSnapshotR334:policy};
 await scope.transaction.runInTransaction(tx=>{tx.savePrayerScorePolicyR334("user-1",policy);tx.savePersonalDay(day)});
 const loaded=await persistence.openOperation("user-1");
 assert.deepEqual(loaded.snapshot.getPrayerScorePolicyR334("user-1"),policy);
 assert.deepEqual(loaded.snapshot.listPersonalDays("user-1")[0].prayerScoreSnapshotR334,policy);
 assert.throws(()=>loaded.snapshot.getPrayerScorePolicyR334("other"));
 await assert.rejects(()=>loaded.transaction.runInTransaction(tx=>tx.savePrayerScorePolicyR334("other",policy)));
 assert.equal(fake.snapshot().revision,1);
});
