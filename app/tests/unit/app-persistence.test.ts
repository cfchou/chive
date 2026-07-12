import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createLocalStoragePersistence } from "../../src/lib/persistence/app-persistence";

function mockStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    _map: map,
  };
}

describe("createLocalStoragePersistence", () => {
  it("round-trips JSON values", async () => {
    const store = mockStorage();
    const p = createLocalStoragePersistence(store);
    await p.setJson("widths", { left: 320, right: 0 });
    assert.deepEqual(await p.getJson<{ left: number; right: number }>("widths"), { left: 320, right: 0 });
  });

  it("returns null for a missing key", async () => {
    const p = createLocalStoragePersistence(mockStorage());
    assert.equal(await p.getJson("nope"), null);
  });

  it("returns null instead of throwing on malformed JSON", async () => {
    const store = mockStorage();
    store.setItem("bad", "{not json");
    const p = createLocalStoragePersistence(store);
    assert.equal(await p.getJson("bad"), null);
  });

  it("removes a stored key", async () => {
    const store = mockStorage();
    const p = createLocalStoragePersistence(store);
    await p.setJson("k", 1);
    await p.remove("k");
    assert.equal(await p.getJson("k"), null);
  });

  it("is a no-op (never throws) when no storage is available", async () => {
    const p = createLocalStoragePersistence(null);
    await p.setJson("k", 1);
    assert.equal(await p.getJson("k"), null);
    await p.remove("k");
  });
});
