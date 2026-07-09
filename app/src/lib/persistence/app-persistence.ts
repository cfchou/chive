export type AppPersistence = {
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
};

export function createLocalAppPersistence(): AppPersistence {
  return {
    async getJson<T>(key: string): Promise<T | null> {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async setJson<T>(key: string, value: T): Promise<void> {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, JSON.stringify(value));
    },
    async remove(key: string): Promise<void> {
      if (typeof localStorage === "undefined") return;
      localStorage.removeItem(key);
    },
  };
}
