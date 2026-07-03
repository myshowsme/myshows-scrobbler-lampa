// Per-profile settings. When Lampa account profiles are in use, every
// user-facing setting is scoped to the active profile under
// '<key>_profile_<id>'; a profile seen for the first time starts from the
// defaults. The base key stays the live buffer the SettingsApi UI binds to: on
// profile switch the profile values are copied to the base keys, and UI edits
// are mirrored back to the profile keys. Without profiles the base key is the
// storage itself and behavior is unchanged.

import { PROFILE_SCOPED, STORAGE } from './config'
import { log } from './log'
import { storableValue } from './utils'

let profileSyncing = false // guard: our own sync writes must not re-mirror

export function profileId(): string {
  try {
    const acc = Lampa.Account && Lampa.Account.Permit && Lampa.Account.Permit.account
    if (acc && acc.profile && acc.profile.id) return String(acc.profile.id)
  } catch {
    /* noop */
  }
  return ''
}

function profileKey(base: string): string {
  const pid = profileId()
  return pid ? base + '_profile_' + pid : base
}

// Adoption of pre-profile settings. If no profile has ever owned any keys (no
// '<token>_profile_*' in storage) but device-wide base values exist — this is
// an install from before the per-profile scheme. The first profile to show up
// adopts those values, so existing users keep their token and scrobbling
// silently. Once any profile keys exist, the base keys always belong to the
// last active profile and are never adopted again — profiles stay isolated,
// nothing leaks between them.
export function adoptBaseSettings(): void {
  const pid = profileId()
  if (!pid) return
  if (window.localStorage.getItem(profileKey(STORAGE.token)) !== null) return
  if (window.localStorage.getItem(STORAGE.token) === null) return
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key && key.indexOf(STORAGE.token + '_profile_') === 0) return
  }
  log('adopting pre-profile settings for profile', pid)
  PROFILE_SCOPED.forEach(function (k) {
    Lampa.Storage.set(profileKey(k.name), storableValue(Lampa.Storage.get(k.name, k.def)))
  })
}

// First time a profile is seen: materialize its keys with the defaults —
// profiles are isolated, nothing leaks from the previous profile.
export function ensureProfileKeys(): void {
  PROFILE_SCOPED.forEach(function (k) {
    const key = profileKey(k.name)
    if (key !== k.name && window.localStorage.getItem(key) === null) {
      Lampa.Storage.set(key, k.def)
    }
  })
}

// Profile values -> base keys (what settings and the settings UI read).
export function syncProfileToBase(): void {
  profileSyncing = true
  PROFILE_SCOPED.forEach(function (k) {
    Lampa.Storage.set(k.name, storableValue(Lampa.Storage.get(profileKey(k.name), k.def)))
  })
  profileSyncing = false
}

// A base key edited in the settings UI -> copy to the profile key.
export function mirrorToProfile(name: string, value: unknown): void {
  if (profileSyncing) return
  for (const entry of PROFILE_SCOPED) {
    if (entry.name === name) {
      const key = profileKey(name)
      if (key !== name) Lampa.Storage.set(key, storableValue(value))
      return
    }
  }
}
