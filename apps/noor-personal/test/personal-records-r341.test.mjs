import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {pathToFileURL} from "node:url";

const api = await import(pathToFileURL(path.resolve(process.env.NOOR_PERSONAL_BUILD_DIR ?? "dist", "index.js")).href);
const {
  InMemoryFoundationStore,
  PersonalCommandService,
  SequenceIdGenerator,
  SupabasePostgresPersonalFoundationPersistence,
  buildPersonalWorkspace,
  parsePersonalCommand,
} = api;

const firstNow = "2026-11-16T07:00:00.000Z";

const profileCommand = (expectedUpdatedAt = null, extra = {}) => ({
  type: "set-personal-profile",
  expectedUpdatedAt,
  displayName: "أبو علي",
  avatarUrl: null,
  birthDate: "1985-05-12",
  ...extra,
});

test("profile commands accept compact JPEG avatars and reject other embedded formats",()=>{
  const avatarUrl="data:image/jpeg;base64,/9j/2Q==";
  assert.equal(parsePersonalCommand(profileCommand(null,{avatarUrl}))?.avatarUrl,avatarUrl);
  assert.equal(parsePersonalCommand(profileCommand(null,{avatarUrl:"data:image/svg+xml;base64,PHN2Zz4="})),null);
  assert.equal(parsePersonalCommand(profileCommand(null,{avatarUrl:`data:image/jpeg;base64,/9j/${"A".repeat(33000)}`})),null);
});

const eventCommand = (extra = {}) => ({
  type: "create-historical-event",
  id: "event-1",
  calendar: "gregorian",
  year: null,
  month: 2,
  day: 29,
  title: "ذكرى مهمة",
  details: "تفاصيل الحدث",
  source: "مصدر موثق",
  enabled: true,
  ...extra,
});

function workspaceSnapshot(store) {
  return {
    getPersonalProfile: userId => store.snapshot().personalProfiles?.find(item => item.userId === userId) ?? null,
    listHistoricalEvents: userId => store.snapshot().historicalEvents?.filter(item => item.userId === userId) ?? [],
    listNotificationHistory: userId => store.snapshot().notificationHistory?.filter(item => item.userId === userId) ?? [],
    listDefinitions: () => [],
    listPersonalDays: () => [],
    listDailyExecutionForUser: () => [],
  };
}

test("R341 parsers enforce exact profile, event and notification contracts", () => {
  assert.ok(parsePersonalCommand(profileCommand()));
  assert.equal(parsePersonalCommand(profileCommand(null, { unexpected: true })), null);
  assert.ok(parsePersonalCommand(eventCommand()));
  assert.equal(parsePersonalCommand(eventCommand({ day: 31 })), null);
  assert.equal(parsePersonalCommand(eventCommand({ month: 13 })), null);
  assert.ok(parsePersonalCommand({
    type: "observe-notification",
    id: "reminder:r1:2026-11-16",
    kind: "reminder",
    title: "تذكير",
    targetId: "r1",
    scheduledFor: firstNow,
  }));
  assert.ok(parsePersonalCommand({
    type: "mark-notification-read",
    notificationId: "missing",
    expectedReadAt: null,
  }));
});

test("R341 profile, historical events and notification history are owner-scoped and CAS protected", async () => {
  let now = firstNow;
  const store = new InMemoryFoundationStore();
  const service = new PersonalCommandService({
    clock: {now: () => now},
    idGenerator: new SequenceIdGenerator(),
    transaction: store,
  });

  await service.execute("u", profileCommand());
  let profile = store.snapshot().personalProfiles?.find(item => item.userId === "u");
  assert.equal(profile?.displayName, "أبو علي");
  await assert.rejects(() => service.execute("u", profileCommand(null, {displayName: "تعديل متزامن"})));

  await service.execute("u", eventCommand());
  let event = store.snapshot().historicalEvents?.find(item => item.id === "event-1");
  assert.equal(event?.day, 29);
  now = "2026-11-16T07:05:00.000Z";
  await service.execute("u", {
    type: "update-historical-event",
    eventId: "event-1",
    expectedUpdatedAt: event.updatedAt,
    calendar: "gregorian",
    year: 2024,
    month: 2,
    day: 29,
    title: "ذكرى محدثة",
    details: "تفاصيل محدثة",
    source: "مصدر محدث",
    enabled: false,
  });
  event = store.snapshot().historicalEvents?.find(item => item.id === "event-1");
  assert.equal(event?.title, "ذكرى محدثة");
  assert.equal(event?.enabled, false);
  await assert.rejects(() => service.execute("u", {
    type: "update-historical-event",
    eventId: "event-1",
    expectedUpdatedAt: firstNow,
    calendar: "gregorian",
    year: 2024,
    month: 2,
    day: 29,
    title: "تصادم",
    details: "",
    source: "",
    enabled: true,
  }));

  await service.execute("u", {
    type: "observe-notification",
    id: "reminder:r1:2026-11-16",
    kind: "reminder",
    title: "تذكير",
    targetId: "r1",
    scheduledFor: firstNow,
  });
  await service.execute("u", {
    type: "observe-notification",
    id: "reminder:r1:2026-11-16",
    kind: "reminder",
    title: "تذكير",
    targetId: "r1",
    scheduledFor: firstNow,
  });
  let notification = store.snapshot().notificationHistory?.[0];
  assert.equal(store.snapshot().notificationHistory?.length, 1);
  await service.execute("u", {
    type: "mark-notification-read",
    notificationId: notification.id,
    expectedReadAt: null,
  });
  notification = store.snapshot().notificationHistory?.[0];
  assert.equal(notification.readAt, now);

  await service.execute("other", profileCommand());
  const uWorkspace = buildPersonalWorkspace("u", workspaceSnapshot(store));
  const otherWorkspace = buildPersonalWorkspace("other", workspaceSnapshot(store));
  assert.equal(uWorkspace.profile.userId, "u");
  assert.equal(uWorkspace.historicalEvents.length, 1);
  assert.equal(uWorkspace.notificationHistory.length, 1);
  assert.equal(otherWorkspace.historicalEvents.length, 0);
  assert.equal(otherWorkspace.notificationHistory.length, 0);
  await service.execute("u", {
    type: "delete-historical-event",
    eventId: "event-1",
    expectedUpdatedAt: event.updatedAt,
  });
  assert.equal(store.snapshot().historicalEvents?.length, 0);
});

function persistenceFixture() {
  let row = {
    user_id: "u",
    schema_version: 1,
    revision: 1,
    state: {
      locations: [],
      prayerPolicies: [],
      personalDays: [],
      islamicContexts: [],
      definitions: [],
      dailyExecution: [],
      outbox: [],
    },
  };
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {limit: async () => ({data: [structuredClone(row)], error: null})};
            },
          };
        },
        update(value) {
          const filters = {};
          const query = {
            eq(key, value) {
              filters[key] = value;
              return query;
            },
            async select() {
              if (filters.user_id !== row.user_id || filters.revision !== row.revision) return {data: [], error: null};
              row = {...row, ...structuredClone(value)};
              return {data: [{revision: row.revision}], error: null};
            },
          };
          return query;
        },
      };
    },
  };
  return {client, read: () => structuredClone(row)};
}

test("R341 records survive a fresh JSONB persistence adapter", async () => {
  const fixture = persistenceFixture();
  const adapter = new SupabasePostgresPersonalFoundationPersistence(fixture.client);
  await adapter.initialize();
  const execute = async command => {
    const scope = await adapter.openOperation("u");
    const service = new PersonalCommandService({
      clock: {now: () => firstNow},
      idGenerator: new SequenceIdGenerator(),
      transaction: scope.transaction,
    });
    await service.execute("u", command);
  };
  await execute(profileCommand());
  await execute(eventCommand({year: 2020, month: 1, day: 1}));
  await execute({
    type: "observe-notification",
    id: "appointment:a1:2026-11-16T10:00:00.000Z",
    kind: "appointment",
    title: "موعد",
    targetId: "a1",
    scheduledFor: "2026-11-16T10:00:00.000Z",
  });

  const fresh = new SupabasePostgresPersonalFoundationPersistence(fixture.client);
  await fresh.initialize();
  const reloaded = await fresh.openOperation("u");
  assert.equal(reloaded.snapshot.getPersonalProfile("u").displayName, "أبو علي");
  assert.equal(reloaded.snapshot.listHistoricalEvents("u")[0].title, "ذكرى مهمة");
  assert.equal(reloaded.snapshot.listNotificationHistory("u")[0].kind, "appointment");
  assert.throws(() => reloaded.snapshot.getPersonalProfile("other"));
  assert.deepEqual(fixture.read().state.personalProfile.userId, "u");
});
