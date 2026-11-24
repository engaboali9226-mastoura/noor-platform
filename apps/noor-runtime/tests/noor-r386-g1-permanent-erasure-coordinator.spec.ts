import assert from "node:assert/strict";
import test from "node:test";

import {
  createR386G1PermanentErasureCoordinator,
  R386_G1_ERASURE_STORES,
  type R386G1ErasureBackend,
  type R386G1ErasureIntent,
  type R386G1ErasureStore,
  type R386G1FencedOwner,
} from "../src/noor-r386-g1-permanent-erasure-coordinator.js";

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUser = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const intent: R386G1ErasureIntent = Object.freeze({
  operatorSessionId: "verified-admin-session",
  targetAuthUserId: user,
  requestId: "11111111-1111-4111-8111-111111111111",
  confirmation: "ERASE_NOOR_PERMANENTLY",
});
const proof: R386G1FencedOwner = Object.freeze({
  ownerId: user,
  authUserId: user,
  accountId: "linked-noor-account-a",
  erasureId: "22222222-2222-4222-8222-222222222222",
  persistentTombstone: true,
  sessionsAndGrantsRevoked: true,
});

function rig(failAt: R386G1ErasureStore | "auth" | "finalize" | null = null) {
  const ownerRows = new Map<R386G1ErasureStore, number>(
    R386_G1_ERASURE_STORES.map(store => [store, 2] as const),
  );
  const otherRows = new Map<R386G1ErasureStore, number>(
    R386_G1_ERASURE_STORES.map(store => [store, 3] as const),
  );
  let fenceEstablished = false;
  let authPresent = true;
  let finalized = false;
  let fail = failAt;
  let authCalls = 0;
  const sequence: string[] = [];
  const backend: R386G1ErasureBackend = {
    async authorizeAndFence(request) {
      sequence.push("fence");
      assert.deepEqual(request, intent);
      fenceEstablished = true;
      return proof;
    },
    async eraseStore(fence, store) {
      assert.equal(fence, proof);
      assert.equal(fenceEstablished, true);
      assert.equal(finalized, false);
      sequence.push(store);
      if (fail === store) throw Error("contains-sensitive-account-content");
      ownerRows.set(store, 0);
    },
    async remainingRows(fence, store) {
      assert.equal(fence, proof);
      return ownerRows.get(store)!;
    },
    async hardDeleteManagedAuth(fence) {
      assert.equal(fence, proof);
      authCalls++;
      sequence.push("managed-auth-hard-delete");
      if (fail === "auth") throw Error("managed API temporarily unavailable");
      authPresent = false;
    },
    async managedAuthResiduals(fence) {
      assert.equal(fence, proof);
      return Number(authPresent);
    },
    async verifyAndFinalize(fence) {
      assert.equal(fence, proof);
      sequence.push("finalize");
      if (fail === "finalize") return false;
      if (authPresent || [...ownerRows.values()].some(count => count > 0)) return false;
      finalized = true;
      return true;
    },
  };
  return {
    run: createR386G1PermanentErasureCoordinator(backend),
    sequence,
    ownerRows,
    otherRows,
    fenceEstablished: () => fenceEstablished,
    authCalls: () => authCalls,
    finalized: () => finalized,
    retryWithoutFailure: () => { fail = null; },
  };
}

test("G1 permanent erase fences first, verifies every operational/candidate store, hard-deletes Auth last", async () => {
  const x = rig();
  const result = await x.run.erase(intent);
  assert.deepEqual(result, { status: "erased" });
  assert.deepEqual(x.sequence, [
    "fence", ...R386_G1_ERASURE_STORES, "managed-auth-hard-delete", "finalize",
  ]);
  assert.equal(x.finalized(), true);
  assert.equal(x.authCalls(), 1);
  for (const store of R386_G1_ERASURE_STORES) {
    assert.equal(x.ownerRows.get(store), 0);
    assert.equal(x.otherRows.get(store), 3);
  }
});

test("G1 partial store failure never hard-deletes Auth or lifts tombstone; retry completes", async () => {
  const x = rig("private-journal");
  await assert.rejects(x.run.erase(intent), e => {
    assert.equal((e as Error).message, "R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED");
    return true;
  });
  assert.equal(x.fenceEstablished(), true);
  assert.equal(x.finalized(), false);
  assert.equal(x.authCalls(), 0);
  assert.equal(x.ownerRows.get("private-journal"), 2);
  assert.equal(x.otherRows.get("private-journal"), 3);

  x.retryWithoutFailure();
  assert.deepEqual(await x.run.erase(intent), { status: "erased" });
  assert.equal(x.finalized(), true);
  assert.equal(x.authCalls(), 1);
});

test("G1 managed Auth API failure remains retryable and does not report success", async () => {
  const x = rig("auth");
  await assert.rejects(x.run.erase(intent), /R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED/);
  assert.equal(x.fenceEstablished(), true);
  assert.equal(x.finalized(), false);
  assert.equal(x.authCalls(), 1);
  for (const store of R386_G1_ERASURE_STORES) assert.equal(x.ownerRows.get(store), 0);
  x.retryWithoutFailure();
  assert.deepEqual(await x.run.erase(intent), { status: "erased" });
  assert.equal(x.authCalls(), 2);
});

test("G1 final independent inventory denial never acknowledges completion", async () => {
  const x = rig("finalize");
  await assert.rejects(x.run.erase(intent), /R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED/);
  assert.equal(x.finalized(), false);
  assert.equal(x.authCalls(), 1);
});

test("G1 privileged confirmation, identity mismatch and missing backends fail before deletion", async () => {
  const x = rig();
  const unconfirmed = { ...intent, confirmation: "" } as unknown as R386G1ErasureIntent;
  await assert.rejects(x.run.erase(unconfirmed), /R386_G1_ERASURE_INTENT_DENIED/);
  assert.equal(x.sequence.length, 0);
  const forgedBackend: R386G1ErasureBackend = {
    authorizeAndFence: async () => ({ ...proof, ownerId: otherUser }),
    eraseStore: async () => { throw Error("should-not-erase"); },
    remainingRows: async () => 0,
    hardDeleteManagedAuth: async () => { throw Error("should-not-delete"); },
    managedAuthResiduals: async () => 0,
    verifyAndFinalize: async () => true,
  };
  await assert.rejects(
    createR386G1PermanentErasureCoordinator(forgedBackend).erase(intent),
    /R386_G1_ERASURE_AUTHORITY_UNAVAILABLE/,
  );
  assert.throws(
    () => createR386G1PermanentErasureCoordinator({} as R386G1ErasureBackend),
    /R386_G1_ERASURE_BACKEND_UNAVAILABLE/,
  );
});
