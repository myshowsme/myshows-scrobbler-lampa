// Reads persisted values from Lampa.Storage. The SettingsApi params in
// settings-ui write to the same keys, so reads and the UI stay in sync.

import { DEFAULT_BASE_URL, DEFAULT_THRESHOLD, STORAGE } from './config'
import type { ConnectionStatus, SettingsReader } from './types'

export const settings: SettingsReader = {
  get token() {
    return String(Lampa.Storage.get(STORAGE.token, '') || '').trim()
  },
  get baseUrl() {
    const url = String(Lampa.Storage.get(STORAGE.baseUrl, DEFAULT_BASE_URL) || '').trim()
    return url.replace(/\/+$/, '') || DEFAULT_BASE_URL
  },
  get threshold() {
    const v = parseInt(Lampa.Storage.get(STORAGE.threshold, DEFAULT_THRESHOLD), 10)
    return isNaN(v) ? DEFAULT_THRESHOLD : v
  },
  get enabled() {
    return !!Lampa.Storage.get(STORAGE.enabled, true)
  },
  get notify() {
    return !!Lampa.Storage.get(STORAGE.notify, false)
  },
  setStatus(status: ConnectionStatus) {
    Lampa.Storage.set(STORAGE.status, status)
  },
}
