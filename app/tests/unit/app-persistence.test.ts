import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLocalStoragePersistence } from "../../src/lib/persistence/app-persistence";

describe("app persistence", () => {
  it("stores and reads JSON values by key", async () => {
    const storage = createMemoryStorage();
    const persistence = createLocalStoragePersistence(storage);

    await persistence.setJson("chive.sidebarWidths", { left: 320, right: 440 });

    assert.deepEqual(await persistence.getJson("chive.sidebarWidths"), {
      left: 320,
      right: 440,
    });
  });

  it("returns null for missing or malformed JSON values", async () => {
    const storage = createMemoryStorage();
    const persistence = createLocalStoragePersistence(storage);

    storage.setItem("broken", "{");

    assert.equal(await persistence.getJson("missing"), null);
    assert.equal(await persistence.getJson("broken"), null);
  });

  it("removes values", async () => {
    const storage = createMemoryStorage();
    const persistence = createLocalStoragePersistence(storage);

    await persistence.setJson("draft", { open: true });
    await persistence.remove("draft");

    assert.equal(await persistence.getJson("draft"), null);
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
