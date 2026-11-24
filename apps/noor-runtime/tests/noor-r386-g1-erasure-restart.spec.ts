import assert from "node:assert/strict";
import test from "node:test";
import {
  createR386G1PermanentErasureCoordinator,
  R386_G1_ERASURE_STORES,
  type R386G1ErasureBackend,
  type R386G1ErasureIntent,
  type R386G1FencedOwner,
} from "../src/noor-r386-g1-permanent-erasure-coordinator.js";

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const intent: R386G1ErasureIntent = {
  operatorSessionId: "verified-admin-session",
  targetAuthUserId: user,
  requestId: "11111111-1111-4111-8111-111111111111",
  confirmation: "ERASE_NOOR_PERMANENTLY",
};
const fence: R386G1FencedOwner = {
  ownerId: user, authUserId: user, accountId: "test-owner-a",
  erasureId: "22222222-2222-4222-8222-222222222222",
  persistentTombstone: true, sessionsAndGrantsRevoked: true,
};

function rig(mode: "lost-response" | "finalize-failure" | "normal" | "invalid-count" | "verification-failure") {
  const ownerRows = new Map(R386_G1_ERASURE_STORES.map(s => [s, 2]));
  const otherRows = new Map(R386_G1_ERASURE_STORES.map(s => [s, 3]));
  let tombstone = false, authPresent = true, hardCalls = 0, finalCalls = 0;
  let invalid = mode === "invalid-count", verifyFails = mode === "verification-failure";
  const backend: R386G1ErasureBackend = {
    async authorizeAndFence(request) {
      assert.deepEqual(request, intent); tombstone = true; return fence;
    },
    async eraseStore(f, store) { assert.equal(f, fence); assert.ok(tombstone); ownerRows.set(store, 0); },
    async remainingRows(f, store) { assert.equal(f, fence); return ownerRows.get(store)!; },
    async hardDeleteManagedAuth(f) {
      assert.equal(f, fence); assert.ok(tombstone); hardCalls++;
      assert.ok([...ownerRows.values()].every(n => n === 0));
      if (!authPresent) throw Error("already deleted");
      authPresent = false;
      if (mode === "lost-response") throw Error("transport lost after hard delete");
    },
    async managedAuthResiduals(f) {
      assert.equal(f, fence);
      if (verifyFails) throw Error("verification unavailable");
      return invalid ? -1 : Number(authPresent);
    },
    async verifyAndFinalize(f) {
      assert.equal(f, fence); finalCalls++;
      if (mode === "finalize-failure" && finalCalls === 1) return false;
      return tombstone && !authPresent && [...ownerRows.values()].every(n => n === 0);
    },
  };
  return { run: () => createR386G1PermanentErasureCoordinator(backend).erase(intent),
    hardCalls: () => hardCalls, finalCalls: () => finalCalls, tombstone: () => tombstone,
    ownerRows, otherRows, fixVerification: () => { invalid = false; verifyFails = false; } };
}

for (const mode of ["lost-response", "finalize-failure"] as const) {
  test(`G1 restart after ${mode} does not repeat a verified completed Auth delete`, async () => {
    const x = rig(mode);
    await assert.rejects(x.run(), /R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED/);
    assert.equal(x.hardCalls(), 1);
    assert.equal(x.tombstone(), true);
    assert.deepEqual(await x.run(), { status: "erased" });
    assert.equal(x.hardCalls(), 1);
    assert.ok([...x.ownerRows.values()].every(n => n === 0));
    assert.ok([...x.otherRows.values()].every(n => n === 3));
  });
}

for (const mode of ["invalid-count", "verification-failure"] as const) {
  test(`G1 ${mode} fails closed before destructive Auth call and remains retryable`, async () => {
    const x = rig(mode);
    await assert.rejects(x.run(), /R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED/);
    assert.equal(x.hardCalls(), 0);
    assert.equal(x.finalCalls(), 0);
    assert.ok(x.tombstone());
    x.fixVerification();
    assert.deepEqual(await x.run(), { status: "erased" });
    assert.equal(x.hardCalls(), 1);
  });
}

test("G1 normal erasure performs hard delete and final inventory exactly once", async () => {
  const x = rig("normal");
  assert.deepEqual(await x.run(), { status: "erased" });
  assert.equal(x.hardCalls(), 1);
  assert.equal(x.finalCalls(), 1);
});
