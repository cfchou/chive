import type { Snippet } from "svelte";

export type SettingsSection = {
  id: string;
  label: string;
  content: Snippet;
};
