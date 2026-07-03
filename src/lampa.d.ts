// Hand-written ambient types for the parts of the global `Lampa` API this
// plugin uses. There is no published @types/lampa — this is our own surface,
// grown lazily as modules touch more of the API.
//
// Dynamic boundaries (event payloads, Storage values, Activity data) are typed
// `any` on purpose: they're untyped runtime data from the host app, and pinning
// them down would only add casts without adding safety.
//
// Derived from yumata/lampa-source and the DeepWiki plugin-API notes.

export {}

interface LampaListener {
  follow(event: string, cb: (e: any) => void): void
}

interface LampaStorage {
  get(key: string, def?: any): any
  set(key: string, value: any): void
  listener: LampaListener
}

interface SettingsParam {
  component: string
  param: {
    name: string
    type: 'trigger' | 'input' | 'select' | 'static'
    default?: unknown
    values?: any
    placeholder?: string
  }
  field: { name: string; description?: string }
  onChange?: (value: any) => void
  onRender?: (element: any) => void
}

interface LampaGlobal {
  Storage: LampaStorage
  Noty: { show(message: string): void }
  Player: { listener: LampaListener }
  PlayerVideo?: {
    listener?: LampaListener
    video(): any
  }
  Timeline?: { listener?: LampaListener }
  Activity: { active?: () => any }
  Listener: LampaListener
  Manifest: { plugins?: unknown; app_digital?: number }
  Account?: {
    Permit?: { account?: { profile?: { id?: number | string } } }
    listener?: LampaListener
  }
  SettingsApi: {
    addComponent(opts: { component: string; name: string; icon?: string }): void
    addParam(opts: SettingsParam): void
  }
}

declare global {
  // eslint-disable-next-line no-var
  var Lampa: LampaGlobal

  interface Window {
    Lampa?: LampaGlobal
    appready?: boolean
  }
}
