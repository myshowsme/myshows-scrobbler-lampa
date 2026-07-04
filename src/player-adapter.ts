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
import {
  normalizeCard,
  normalizeLang,
  normalizePlaylist,
  playlistIndexOf,
  readEpisode,
} from './player-parse'
import type { PlaylistEntry } from './player-parse'
import { settings } from './settings'
import type { ScrobbleItem, SessionController } from './types'
import { clampPercent, mapResolution } from './utils'

interface PlaybackContext {
  hash: unknown
  raw: Record<string, any>
  /** playback happens in an external player ('external' event) */
  external: boolean
  /** normalized playlist handed to the external player (empty otherwise) */
  playlist: PlaylistEntry[]
  /** index of the launched episode in `playlist`, -1 when unknown */
  launchIndex: number
  /** playlist indexes already marked this session (dedup) */
  marked: Record<number, boolean>
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

  // Return from an external player. Lampa reports a timecode per finished
  // episode (earlier playlist items are set to 100%), but some player
  // integrations deliver only the last played one. Cover both: mark the range
  // from the launched episode FORWARD to the reported one — everything before
  // it was passed inside the player, the reported one counts by its actual
  // percent. On a backward jump (or unknown launch position) nothing in
  // between can be assumed watched, so only the reported episode counts.
  // The launched episode already owns the open session, so it is driven
  // through progress() (heartbeats keep flowing, /stop closes the /start)
  // instead of a second /start via markEpisode. Sequential, deduped per
  // session. Returns true when the tick belonged to the playlist.
  function onExternalTimeline(hash: string, percent: number): boolean {
    if (!activeContext) {
      return false
    }
    const ctx = activeContext
    let idx = -1
    for (let i = 0; i < ctx.playlist.length; i++) {
      if (ctx.playlist[i]!.hash === hash) {
        idx = i
        break
      }
    }
    if (idx < 0) {
      return false // not a playlist hash: the legacy single-file filter decides
    }

    let from = ctx.launchIndex
    if (from < 0 || from > idx) {
      from = idx
    }

    const queue: { entry: PlaylistEntry; percent: number }[] = []
    for (let j = from; j <= idx; j++) {
      const pct = j === idx ? percent : 100
      if (ctx.marked[j]) {
        continue
      }
      if (j === ctx.launchIndex) {
        lastPercent = pct
        session.progress(buildItem(pct))
        if (clampPercent(pct) >= settings.threshold) {
          ctx.marked[j] = true
        }
        continue
      }
      if (clampPercent(pct) < settings.threshold) {
        continue
      }
      ctx.marked[j] = true
      queue.push({ entry: ctx.playlist[j]!, percent: pct })
    }
    if (!queue.length) {
      return true
    }

    log('external return: marking', queue.length, 'episode(s)')
    const step = (): void => {
      const next = queue.shift()
      if (!next) {
        return
      }
      const item = buildItem(next.percent)
      item.season = next.entry.season
      item.episode = next.entry.episode
      item.episodeTitle = next.entry.title
      session.markEpisode(item, step)
    }
    step()
    return true
  }

  function init(): void {
    // Open a session. 'start' fires for the built-in player, 'external' for
    // external ones (Android/webOS/etc); only one fires per playback.
    function onPlaybackBegin(data: Record<string, any>, external: boolean): void {
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

        activeContext = { hash, raw: data, external, playlist: [], launchIndex: -1, marked: {} }
        lastPercent = resume

        const item = buildItem(resume)

        if (external) {
          activeContext.playlist = normalizePlaylist(data.playlist, item.card || {}, (source) =>
            Lampa.Utils.hash(source),
          )
          activeContext.launchIndex = playlistIndexOf(activeContext.playlist, hash, data)
        }

        log('player begin', item)
        session.play(item)
      } catch (e) {
        log('begin handler error', e)
      }
    }

    Lampa.Player.listener.follow('start', function (data: Record<string, any>) {
      onPlaybackBegin(data, false)
    })
    Lampa.Player.listener.follow('external', function (data: Record<string, any>) {
      onPlaybackBegin(data, true)
    })

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
          // External session with a playlist: episodes are matched to the
          // playlist by hash. A hash the playlist doesn't know falls through
          // to the legacy single-file filter below.
          if (activeContext.external && activeContext.playlist.length) {
            if (onExternalTimeline(String(hash), road.percent)) {
              return
            }
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
