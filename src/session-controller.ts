// State machine + resilience. No Lampa here: driven by play/progress/finish
// from the player adapter; talks only to the payload builder + injected client.
// Everything Lampa-specific (Noty, clock) is injected, so the whole thing is
// unit-testable with fakes.

import { DEGRADED_AFTER, DEGRADED_MULT, HEARTBEAT_MS, HEARTBEAT_RETRY_MS } from './config'
import { buildPayload } from './payload-builder'
import { clampPercent } from './utils'
import type {
  ScrobbleClient,
  ScrobbleError,
  ScrobbleItem,
  SessionController,
  SettingsReader,
} from './types'

export interface SessionDeps {
  settings: SettingsReader
  client: ScrobbleClient
  now: () => number
  showNoty: (message: string) => void
  log: (...args: unknown[]) => void
}

interface Session {
  signature: string
  item: ScrobbleItem
  started: boolean
  stopped: boolean
  errors: number
  intervalMs: number
  lastBeat: number
  notified?: Record<string, boolean>
}

function isAuthError(err: unknown): err is ScrobbleError {
  const status = (err as ScrobbleError | null)?.status
  return status === 401 || status === 403
}

function signatureOf(item: ScrobbleItem): string {
  const card = item.card || {}
  return [card.tmdb || card.imdb || card.title, item.season, item.episode].join('|')
}

export function createSessionController(deps: SessionDeps): SessionController {
  const { settings, client, now, showNoty, log } = deps
  let current: Session | null = null

  function active(): boolean {
    return settings.enabled && !!settings.token
  }

  // Show a Noty at most once per session per key, so a flaky network can't spam
  // the screen on every heartbeat. Suppressed when on-screen errors are off.
  function notifyOnce(key: string, message: string): void {
    if (!current) return
    if (!settings.notify) return
    current.notified = current.notified || {}
    if (current.notified[key]) return
    current.notified[key] = true
    try {
      showNoty(message)
    } catch {
      /* noop */
    }
  }

  function onError(err: unknown): void {
    if (!current) return
    // 401/403 means the token is invalid: stop scrobbling this session.
    if (isAuthError(err)) {
      log('auth error, disabling session', err)
      settings.setStatus('invalid')
      current.stopped = true // suppress further sends this session
      notifyOnce('auth', 'MyShows: токен недействителен — скробблинг остановлен')
      return
    }
    current.errors += 1
    settings.setStatus('error')
    if (current.errors >= DEGRADED_AFTER) {
      // Degraded: slow the heartbeat ×4, keep trying.
      current.intervalMs = HEARTBEAT_MS * DEGRADED_MULT
      log('degraded mode: heartbeat ->', current.intervalMs, 'ms')
      notifyOnce('degraded', 'MyShows: проблемы со связью, отправка замедлена')
    } else {
      // Transient: nudge the next heartbeat to come a bit earlier.
      current.intervalMs = HEARTBEAT_RETRY_MS
    }
  }

  function onSuccess(): void {
    if (!current) return
    current.errors = 0
    current.intervalMs = HEARTBEAT_MS
    // Clear the degraded warning latch so a fresh wave of failures warns again
    // (the auth latch stays; that session is already stopped).
    if (current.notified) current.notified.degraded = false
    settings.setStatus('ok')
  }

  // /stop is terminal: best-effort with one immediate re-send on failure.
  function stop(item: ScrobbleItem): void {
    if (!current || current.stopped) return
    current.stopped = true
    log('stop', current.signature, clampPercent(item.percent) + '%')
    const payload = buildPayload(item)
    client.stop(payload).then(onSuccess, function (err: unknown) {
      if (isAuthError(err)) return onError(err)
      // one immediate retry, then give up
      client.stop(payload).then(onSuccess, onError)
    })
  }

  const controller: SessionController = {
    // Called by the player adapter when playback begins.
    play(item) {
      if (!active()) return
      const sig = signatureOf(item)
      if (current && current.signature === sig) return // dedup
      if (current && !current.stopped) controller.finish(current.item) // close previous

      current = {
        signature: sig,
        item,
        started: true,
        stopped: false,
        errors: 0,
        intervalMs: HEARTBEAT_MS,
        lastBeat: 0,
      }
      log('start', sig)
      client.start(buildPayload(item)).then(onSuccess, onError)
    },

    // Called repeatedly with the latest percent (timeline ticks / polling).
    progress(item) {
      if (!active() || !current || current.stopped) return
      current.item = item // keep latest percent for finish()

      const nowMs = now()
      const percent = clampPercent(item.percent)

      // Threshold reached: send /stop once.
      if (percent >= settings.threshold) {
        stop(item)
        return
      }

      // Otherwise throttle the /pause heartbeat.
      if (nowMs - current.lastBeat >= current.intervalMs) {
        current.lastBeat = nowMs
        client.pause(buildPayload(item)).then(onSuccess, onError)
      }
    },

    // Called by the player adapter when the player is destroyed / ends.
    finish(item) {
      if (!active() || !current) {
        current = null
        return
      }
      const used = item || current.item
      if (!current.stopped && clampPercent(used.percent) >= settings.threshold) {
        stop(used)
      }
      current = null
    },

    // Drop the session without sending anything (profile switch: the new
    // profile's token must not close the previous profile's session).
    abort() {
      current = null
    },
  }

  return controller
}
