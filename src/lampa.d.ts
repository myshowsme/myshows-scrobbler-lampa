// Hand-written ambient types for the parts of the global `Lampa` API this
// plugin uses. There is no published @types/lampa — this is our own surface,
// grown lazily as modules start touching more of the API.
//
// Derived from yumata/lampa-source and the DeepWiki plugin-API notes.

export {};

interface LampaListener<E = unknown> {
  follow(event: string, cb: (e: E) => void): void;
}

interface LampaStorage {
  get<T = unknown>(key: string, def?: T): T;
  set(key: string, value: unknown): void;
  listener: LampaListener<{ name: string; value: unknown }>;
}

interface SettingsParam {
  component: string;
  param: {
    name: string;
    type: "trigger" | "input" | "select" | "static";
    default?: unknown;
    values?: Record<string, string> | string;
    placeholder?: string;
  };
  field: { name: string; description?: string };
  onChange?: (value: unknown) => void;
  onRender?: (element: unknown) => void;
}

interface LampaGlobal {
  Storage: LampaStorage;
  Noty: { show(message: string): void };
  Player: { listener: LampaListener };
  PlayerVideo?: {
    listener?: LampaListener;
    video(): { duration?: number; videoHeight?: number } | null;
  };
  Timeline?: { listener?: LampaListener };
  Activity: { active?: () => Record<string, unknown> };
  Listener: LampaListener<{ type: string }>;
  Manifest: { plugins?: unknown; app_digital?: number };
  Account?: {
    Permit?: { account?: { profile?: { id?: number | string } } };
    listener?: LampaListener;
  };
  SettingsApi: {
    addComponent(opts: { component: string; name: string; icon?: string }): void;
    addParam(opts: SettingsParam): void;
  };
}

declare global {
  interface Window {
    Lampa?: LampaGlobal;
    appready?: boolean;
  }
  // eslint-disable-next-line no-var
  var Lampa: LampaGlobal;
}
