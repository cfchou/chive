import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createLocalAppPersistence } from "../../src/lib/persistence/app-persistence";

// Provide a minimal localStorage mock for Node.js test environment.
before(() => {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
});

describe("AppPersistence (localStorage)", () => {
  it("setJson then getJson round-trips the value", async () => {
    const store = createLocalAppPersistence();
    await store.setJson("test-key", { name: "alice", count: 42 });
    const result = await store.getJson<{ name: string; count: number }>("test-key");
    assert.deepEqual(result, { name: "alice", count: 42 });
    await store.remove("test-key");
  });

  it("getJson returns null for a missing key", async () => {
    const store = createLocalAppPersistence();
    const result = await store.getJson("nonexistent-key-12345");
    assert.equal(result, null);
  });

  it("remove deletes a previously-set key", async () => {
    const store = createLocalAppPersistence();
    await store.setJson("remove-test", { data: 1 });
    await store.remove("remove-test");
    const result = await store.getJson("remove-test");
    assert.equal(result, null);
  });

  it("remove on a missing key does not throw", async () => {
    const store = createLocalAppPersistence();
    await assert.doesNotReject(() => store.remove("never-set"));
  });

  it("setJson overwrites a previous value", async () => {
    const store = createLocalAppPersistence();
    await store.setJson("overwrite-test", { version: 1 });
    await store.setJson("overwrite-test", { version: 2 });
    const result = await store.getJson<{ version: number }>("overwrite-test");
    assert.equal(result?.version, 2);
    await store.remove("overwrite-test");
  });
});
