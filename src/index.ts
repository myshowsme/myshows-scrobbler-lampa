// Entry point. Wires the modules together and runs the Lampa bootstrap
// (singleton guard + appready wait). All the logic lives in the imported
// modules; this file is just composition + host event wiring.

import { PLUGIN_ID, STORAGE, VERSION } from './config'
import { log } from './log'
import { createPlayerAdapter } from './player-adapter'
import {
  adoptBaseSettings,
  ensureProfileKeys,
  mirrorToProfile,
  profileId,
  syncProfileToBase,
} from './profiles'
import { createScrobbleClient } from './scrobble-client'
import { createSessionController } from './session-controller'
import { settings } from './settings'
import { createSettingsUi } from './settings-ui'

declare global {
  interface Window {
    myshows_scrobbler_ready?: boolean
  }
}

function main(): void {
  log('script loaded, version', VERSION)

  const client = createScrobbleClient(settings)
  const session = createSessionController({
    settings,
    client,
    now: () => Date.now(),
    showNoty: (message) => Lampa.Noty.show(message),
    log,
  })
  const adapter = createPlayerAdapter(session)
  const ui = createSettingsUi({ settings, client })

  // Several events can announce the same switch (and some fire before the
  // account object is updated) — resync only when the id actually changed.
  let lastSyncedProfile: string | null = null

  function onProfileChanged(): void {
    const pid = profileId()
    if (pid === lastSyncedProfile) return
    log('profile switch, id', pid || '(none)')
    lastSyncedProfile = pid
    // The previous profile's session must not be closed with the new token.
    session.abort()
    adoptBaseSettings()
    ensureProfileKeys()
    syncProfileToBase()
    settings.setStatus('')
    ui.checkToken(false)
  }

  function start(): void {
    // Register in the plugin manifest (shows up in the app's plugin list).
    try {
      Lampa.Manifest.plugins = {
        type: 'video',
        version: VERSION,
        name: 'MyShows Scrobbler',
        description: 'Отправляет прогресс просмотра в MyShows',
        component: PLUGIN_ID,
      }
    } catch {
      /* noop */
    }

    // Load the active profile's values before the settings UI registers.
    lastSyncedProfile = profileId()
    adoptBaseSettings()
    ensureProfileKeys()
    syncProfileToBase()

    ui.register()
    adapter.init()

    // Keep the settings "Состояние" row in sync when the stored status changes
    // (token check, scrobble error/recovery) while the screen is open, and
    // mirror settings edits to the active profile's keys.
    try {
      Lampa.Storage.listener.follow('change', function (e) {
        if (!e || !e.name) return
        if (e.name === STORAGE.status) return ui.refreshStatusRow(e.value)
        mirrorToProfile(e.name, e.value)
      })
    } catch {
      /* noop */
    }

    // Re-scope settings when the user switches the Lampa account profile.
    // 'profile_select' lives on the Account module's own listener (not the
    // global one) and fires right at selection with account.profile already
    // updated; 'state:changed' favorite/profile arrives later, after the
    // bookmarks resync. onProfileChanged dedupes by profile id.
    try {
      if (Lampa.Account && Lampa.Account.listener) {
        Lampa.Account.listener.follow('profile_select', onProfileChanged)
      }
      Lampa.Listener.follow('state:changed', function (e) {
        if (e && e.target === 'favorite' && e.reason === 'profile') onProfileChanged()
      })
    } catch {
      /* noop */
    }

    // Validate the token on launch (best effort, silent; just updates status).
    ui.checkToken(false)

    log('plugin ready, version', VERSION)
  }

  // Run once the app core is ready (the readiness pattern every plugin uses).
  function boot(): void {
    if (window.appready) start()
    else {
      Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') start()
      })
    }
  }

  if (window.Lampa) {
    boot()
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.Lampa) boot()
    })
  }
}

// Guard against double-load (Lampa may evaluate a plugin more than once).
if (!window.myshows_scrobbler_ready) {
  window.myshows_scrobbler_ready = true
  main()
}
