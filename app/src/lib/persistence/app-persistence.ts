// A small app-level persistence seam. Feature code stores JSON through this
// interface instead of reaching into localStorage directly, so a future
// session-restore feature can swap in a Tauri file/store backend without
// touching call sites. Best-effort by design: failures never throw.

export type AppPersistence = {
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T): Promise<boolean>;
  remove(key: string): Promise<void>;
};

type JsonStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * localStorage-backed persistence (the V1 implementation). Pass an explicit
 * storage for tests; defaults to `localStorage`, or a no-op when unavailable.
 */
export function createLocalStoragePersistence(
  storage: JsonStorage | null = typeof localStorage === "undefined" ? null : localStorage,
): AppPersistence {
  return {
    async getJson<T>(key: string): Promise<T | null> {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        return raw == null ? null : (JSON.parse(raw) as T);
      } catch {
        return null;
      }
    },
    async setJson<T>(key: string, value: T): Promise<boolean> {
      if (!storage) return false;
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    async remove(key: string): Promise<void> {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        // Best-effort.
      }
    },
  };
}
