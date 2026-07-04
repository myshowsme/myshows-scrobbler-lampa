// Plugin-wide constants. Kept dependency-free so any module can import it.

export const VERSION = '0.0.4'
export const PLUGIN_ID = 'myshows_scrobbler'
export const SOURCE_APP = 'lampa'

// Canonical scrobble API base URL (configurable in settings for test / self-host).
export const DEFAULT_BASE_URL = 'https://myshows.me/scrobble'
export const DEFAULT_THRESHOLD = 80 // percent watched before /stop counts as watched

export const HEARTBEAT_MS = 30000 // normal progress heartbeat cadence (/pause)
export const HEARTBEAT_RETRY_MS = 10000 // shortened after a transient failure
export const DEGRADED_AFTER = 3 // consecutive errors before degraded mode
export const DEGRADED_MULT = 4 // heartbeat interval multiplier while degraded

export const STORAGE = {
  token: 'myshows_token',
  threshold: 'myshows_threshold',
  baseUrl: 'myshows_base_url',
  enabled: 'myshows_enabled',
  status: 'myshows_status', // last connection status (for the settings UI)
  notify: 'myshows_notify', // show scrobble errors on screen (Lampa.Noty)
} as const

// Card saved on playback start, used as a fallback when Activity.active() is empty.
export const LAST_CARD_KEY = 'myshows_last_card'

// Settings scoped per Lampa account profile. `def` values are storage strings
// (booleans stored as 'true'/'false' — see storableValue).
export const PROFILE_SCOPED: { name: string; def: string }[] = [
  { name: STORAGE.token, def: '' },
  { name: STORAGE.enabled, def: 'true' },
  { name: STORAGE.threshold, def: String(DEFAULT_THRESHOLD) },
  { name: STORAGE.notify, def: 'false' },
  { name: STORAGE.baseUrl, def: DEFAULT_BASE_URL },
]
