// The only part tied to Lampa internals. Normalizes card + season/episode +
// progress and drives the session controller.
//
// Progress: Timeline 'update' is the source of truth (it's the one signal every
// player emits, including external and native-TV ones). PlayerVideo 'timeupdate'
// just adds finer heartbeats for the built-in player.
// Card: Lampa.Activity.active(), falling back to the card saved on play.
// Season/episode: from the play data, or parsed off the title.

import { LAST_CARD_KEY } from './config'
import { log } from './log'
import { normalizeCard, normalizeLang, readEpisode } from './player-parse'
import type { ScrobbleItem, SessionController } from './types'
import { mapResolution } from './utils'

interface PlaybackContext {
  hash: unknown
  raw: Record<string, any>
}

export function createPlayerAdapter(session: SessionController): { init(): void } {
  let lastPercent = 0
  let lastDuration = 0
  let lastAudioLang: string | undefined
  let activeContext: PlaybackContext | null = null

  function readVideoEl(): { duration?: number; videoHeight?: number } | null {
    try {
      return (Lampa.PlayerVideo && Lampa.PlayerVideo.video && Lampa.PlayerVideo.video()) || null
    } catch {
      return null
    }
  }

  function readCard() {
    let src: Record<string, any> | null = null
    try {
      const a = (Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()) || {}
      src = a.card_data || a.card || a.movie || null
    } catch {
      /* noop */
    }
    if (!src) {
      try {
        src = Lampa.Storage.get(LAST_CARD_KEY, null)
      } catch {
        /* noop */
      }
    }
    return normalizeCard(src)
  }

  function buildItem(percent: number): ScrobbleItem {
    const card = readCard()
    const ep = readEpisode(activeContext && activeContext.raw)
    // Treat as an episode only when we actually have an episode number.
    const asEpisode = ep.episode != null
    const v = readVideoEl()
    const duration = (v && v.duration) || lastDuration || 0
    return {
      card,
      season: asEpisode ? (ep.season != null ? ep.season : 1) : undefined,
      episode: asEpisode ? ep.episode : undefined,
      episodeTitle: ep.episodeTitle,
      percent,
      runtimeMinutes: duration > 0 ? Math.round(duration / 60) : undefined,
      resolution: mapResolution(v && v.videoHeight),
      audioLanguage: lastAudioLang || undefined,
    }
  }

  function init(): void {
    // Open a session. 'start' fires for the built-in player, 'external' for
    // external ones (Android/webOS/etc); only one fires per playback.
    function onPlaybackBegin(data: Record<string, any>): void {
      try {
        data = data || {}
        const card =
          data.card ||
          (Lampa.Activity.active &&
            Lampa.Activity.active() &&
            (Lampa.Activity.active().card || Lampa.Activity.active().movie))
        if (card) {
          Lampa.Storage.set(LAST_CARD_KEY, card)
        }

        const hash = data.timeline && data.timeline.hash
        const resume =
          data.timeline && typeof data.timeline.percent === 'number' ? data.timeline.percent : 0

        activeContext = { hash, raw: data }
        lastPercent = resume

        const item = buildItem(resume)
        log('player begin', item)
        session.play(item)
      } catch (e) {
        log('begin handler error', e)
      }
    }

    Lampa.Player.listener.follow('start', onPlaybackBegin)
    Lampa.Player.listener.follow('external', onPlaybackBegin)

    // Extra heartbeats for the built-in player: 'timeupdate' fires every tick
    // with { duration, current }; the /pause throttle caps the rate.
    if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
      Lampa.PlayerVideo.listener.follow('timeupdate', function (e: Record<string, any>) {
        try {
          if (!e || !e.duration || e.current == null) {
            return
          }
          lastDuration = e.duration
          const percent = (e.current / e.duration) * 100
          lastPercent = percent
          if (activeContext) {
            session.progress(buildItem(percent))
          }
        } catch (err) {
          log('timeupdate error', err)
        }
      })

      // Audio tracks: remember the selected track's language.
      Lampa.PlayerVideo.listener.follow('tracks', function (e: Record<string, any>) {
        try {
          const tracks = e && e.tracks
          if (!tracks || !tracks.length) {
            return
          }
          for (let i = 0; i < tracks.length; i++) {
            if (tracks[i] && (tracks[i].selected || tracks[i].enabled)) {
              lastAudioLang = normalizeLang(tracks[i].language || tracks[i].lang)
              return
            }
          }
        } catch (err) {
          log('tracks handler error', err)
        }
      })
    } else {
      log('WARN: Lampa.PlayerVideo.listener missing — progress may be sparse')
    }

    // Source of truth for progress. Timeline 'update' carries the same percent
    // Lampa uses for resume, and it's the only signal external players give us
    // (once, on return). Matched to the session by hash.
    if (Lampa.Timeline && Lampa.Timeline.listener) {
      Lampa.Timeline.listener.follow('update', function (e: Record<string, any>) {
        try {
          const road = e && e.data && e.data.road
          const hash = e && e.data && e.data.hash
          if (!road || typeof road.percent !== 'number') {
            return
          }
          // no session, or a tick for a different file
          if (!activeContext) {
            return
          }
          if (activeContext.hash && hash && activeContext.hash !== hash) {
            return
          }
          lastPercent = road.percent
          session.progress(buildItem(road.percent))
        } catch (err) {
          log('timeline update error', err)
        }
      })
    }

    Lampa.Player.listener.follow('destroy', function () {
      try {
        session.finish(buildItem(lastPercent))
      } catch (e) {
        log('destroy handler error', e)
      }
      activeContext = null
    })
  }

  return { init }
}
