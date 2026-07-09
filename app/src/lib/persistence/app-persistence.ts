export type AppPersistence = {
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
};

export function createLocalStoragePersistence(storage: Storage): AppPersistence {
  return {
    async getJson<T>(key: string): Promise<T | null> {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async setJson<T>(key: string, value: T): Promise<void> {
      storage.setItem(key, JSON.stringify(value));
    },
    async remove(key: string): Promise<void> {
      storage.removeItem(key);
    },
  };
}

export function getBrowserAppPersistence(): AppPersistence | null {
  if (typeof localStorage === "undefined") return null;
  return createLocalStoragePersistence(localStorage);
}
