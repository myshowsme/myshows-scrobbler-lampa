/*!
 * MyShows scrobbler plugin for Lampa.
 *
 * Watches the Lampa player and reports progress to the MyShows scrobble API
 * (/start, /pause, /stop, /check) with a Bearer token. Content matching is
 * done on the MyShows side.
 *
 * Layout (single IIFE):
 *   playerAdapter     the only part tied to Lampa internals
 *   payloadBuilder    card -> request DTO
 *   scrobbleClient    fetch to the API
 *   sessionController dedup, heartbeat, threshold, degraded mode
 *   settings          SettingsApi UI + Storage
 */
;(function () {
  'use strict'

  // Guard against double-load (Lampa may evaluate a plugin more than once).
  if (window.myshows_scrobbler_ready) return
  window.myshows_scrobbler_ready = true

  // ── Constants ────────────────────────────────────────────────────────────

  var VERSION = '0.0.1' // bump on every change so the console confirms which build is live
  var PLUGIN_ID = 'myshows_scrobbler'
  var SOURCE_APP = 'lampa'

  // Canonical scrobble API base URL (matches DEFAULT_MYSHOWS_URL in src/config.ts).
  // Left configurable in settings for testing / self-host.
  var DEFAULT_BASE_URL = 'https://myshows.me/scrobble'
  var DEFAULT_THRESHOLD = 80 // percent watched before /stop counts as watched

  var HEARTBEAT_MS = 30000 // normal progress heartbeat cadence (/pause)
  var HEARTBEAT_RETRY_MS = 10000 // shortened after a transient failure
  var DEGRADED_AFTER = 3 // consecutive errors before degraded mode
  var DEGRADED_MULT = 4 // heartbeat interval multiplier while degraded

  var STORAGE = {
    token: 'myshows_token',
    threshold: 'myshows_threshold',
    baseUrl: 'myshows_base_url',
    enabled: 'myshows_enabled',
    status: 'myshows_status', // last connection status (for the settings UI)
    notify: 'myshows_notify', // show scrobble errors on screen (Lampa.Noty)
  }

  function log() {
    try {
      var args = ['[MyShows]'].concat([].slice.call(arguments))
      console.log.apply(console, args)
    } catch (e) {
      /* noop */
    }
  }

  log('script loaded, version', VERSION)

  // ── settings ───────────────────────────────────────────────────────────
  // Reads persisted values from Lampa.Storage. The SettingsApi params below
  // write to the same keys, so reads and the UI stay in sync.

  var Settings = {
    get token() {
      return String(Lampa.Storage.get(STORAGE.token, '') || '').trim()
    },
    get baseUrl() {
      var url = String(Lampa.Storage.get(STORAGE.baseUrl, DEFAULT_BASE_URL) || '').trim()
      return url.replace(/\/+$/, '') || DEFAULT_BASE_URL
    },
    get threshold() {
      var v = parseInt(Lampa.Storage.get(STORAGE.threshold, DEFAULT_THRESHOLD), 10)
      return isNaN(v) ? DEFAULT_THRESHOLD : v
    },
    get enabled() {
      return !!Lampa.Storage.get(STORAGE.enabled, true)
    },
    setStatus: function (status) {
      // status: 'ok' | 'invalid' | 'error' | ''
      Lampa.Storage.set(STORAGE.status, status)
    },
  }

  // ── scrobbleClient ───────────────────────────────────────────────────────
  // Thin fetch wrapper. No retry here; resilience lives in sessionController
  // (the heartbeat supersedes losses). Resolves on 2xx, rejects with
  // { status, message } otherwise.

  var scrobbleClient = {
    _request: function (method, path, body) {
      var token = Settings.token
      if (!token) return Promise.reject({ status: 0, message: 'no token' })

      var headers = { Authorization: 'Bearer ' + token }
      var opts = { method: method, headers: headers }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        opts.body = JSON.stringify(body)
      }

      return fetch(Settings.baseUrl + path, opts).then(function (res) {
        if (res.ok)
          return res.json().catch(function () {
            return {}
          })
        return res.text().then(function (text) {
          throw { status: res.status, message: text || 'HTTP ' + res.status }
        })
      })
    },
    start: function (payload) {
      return this._request('POST', '/start', payload)
    },
    pause: function (payload) {
      return this._request('POST', '/pause', payload)
    },
    stop: function (payload) {
      return this._request('POST', '/stop', payload)
    },
    check: function () {
      return this._request('GET', '/check')
    },
  }

  // ── payloadBuilder ─────────────────────────────────────────────────────
  // Pure: { card, season, episode, percent } -> ScrobbleRequest DTO.
  // `card` is a normalized TMDB-ish object from playerAdapter.

  function isEpisode(item) {
    return item.season != null && item.episode != null
  }

  function commonIds(card) {
    var ids = {}
    if (card.tmdb != null) ids.tmdb = String(card.tmdb)
    if (card.imdb) ids.imdb = String(card.imdb)
    if (card.tvdb != null) ids.tvdb = String(card.tvdb)
    if (card.kinopoisk != null && !isNaN(Number(card.kinopoisk)))
      ids.kinopoisk = Number(card.kinopoisk)
    return ids
  }

  function mapResolution(h) {
    if (!h) return undefined
    if (h >= 2000) return 'uhd_4k'
    if (h >= 1000) return 'hd_1080p'
    if (h >= 700) return 'hd_720p'
    if (h >= 560) return 'sd_576p'
    if (h >= 460) return 'sd_480p'
    return undefined
  }

  function buildMetadata(item) {
    var m = {}
    if (item.resolution) m.resolution = item.resolution
    if (item.audioLanguage) m.audio_language = item.audioLanguage
    return Object.keys(m).length ? m : undefined
  }

  function buildPayload(item) {
    var card = item.card || {}
    var meta = buildMetadata(item)
    var base = {
      source_app: SOURCE_APP,
      progress: clampPercent(item.percent),
    }

    if (isEpisode(item)) {
      return Object.assign(base, {
        show: assignDefined(
          { ids: commonIds(card) },
          {
            title: card.title,
            original_title: card.original_title,
            year: card.year,
            content_rating: card.contentRating,
          },
        ),
        episode: assignDefined(
          {},
          {
            season: item.season,
            number: item.episode,
            title: item.episodeTitle,
            runtime: item.runtimeMinutes,
            metadata: meta,
          },
        ),
      })
    }

    return Object.assign(base, {
      movie: assignDefined(
        { ids: commonIds(card) },
        {
          title: card.title,
          original_title: card.original_title,
          year: card.year,
          content_rating: card.contentRating,
          runtime: item.runtimeMinutes,
          metadata: meta,
        },
      ),
    })
  }

  function assignDefined(target, fields) {
    Object.keys(fields).forEach(function (k) {
      var v = fields[k]
      if (v !== undefined && v !== null && v !== '') target[k] = v
    })
    return target
  }

  function clampPercent(p) {
    var n = Number(p) || 0
    if (n < 0) return 0
    if (n > 100) return 100
    return Math.round(n * 10) / 10
  }

  // ── sessionController ──────────────────────────────────────────────────
  // State machine + resilience. No Lampa here: driven by play/progress/finish
  // from playerAdapter; talks only to payloadBuilder + client.

  var sessionController = (function () {
    var current = null // { signature, item, started, stopped, errors, intervalMs }

    function signatureOf(item) {
      var card = item.card || {}
      return [card.tmdb || card.imdb || card.title, item.season, item.episode].join('|')
    }

    function active() {
      return Settings.enabled && !!Settings.token
    }

    // Show a Noty at most once per session per key, so a flaky network can't
    // spam the screen on every heartbeat. Suppressed when the user turned
    // on-screen error notifications off.
    function notifyOnce(key, message) {
      if (!current) return
      if (!Lampa.Storage.get(STORAGE.notify, false)) return
      current.notified = current.notified || {}
      if (current.notified[key]) return
      current.notified[key] = true
      try {
        Lampa.Noty.show(message)
      } catch (e) {
        /* noop */
      }
    }

    function onError(err) {
      if (!current) return
      // 401/403 means the token is invalid: stop scrobbling this session.
      if (err && (err.status === 401 || err.status === 403)) {
        log('auth error, disabling session', err)
        Settings.setStatus('invalid')
        current.stopped = true // suppress further sends this session
        notifyOnce('auth', 'MyShows: токен недействителен — скробблинг остановлен')
        return
      }
      current.errors += 1
      Settings.setStatus('error')
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

    function onSuccess() {
      if (!current) return
      current.errors = 0
      current.intervalMs = HEARTBEAT_MS
      // Clear the degraded warning latch so a fresh wave of failures warns
      // again (the auth latch stays; that session is already stopped).
      if (current.notified) current.notified.degraded = false
      Settings.setStatus('ok')
    }

    return {
      // Called by playerAdapter when playback begins.
      play: function (item) {
        if (!active()) return
        var sig = signatureOf(item)
        if (current && current.signature === sig) return // dedup
        if (current && !current.stopped) this.finish(current.item) // close previous

        current = {
          signature: sig,
          item: item,
          started: true,
          stopped: false,
          errors: 0,
          intervalMs: HEARTBEAT_MS,
          lastBeat: 0,
        }
        log('start', sig)
        scrobbleClient.start(buildPayload(item)).then(onSuccess, onError)
      },

      // Called repeatedly with the latest percent (timeline ticks / polling).
      progress: function (item) {
        if (!active() || !current || current.stopped) return
        current.item = item // keep latest percent for finish()

        var now = Date.now()
        var percent = clampPercent(item.percent)

        // Threshold reached: send /stop once.
        if (percent >= Settings.threshold) {
          this._stop(item)
          return
        }

        // Otherwise throttle the /pause heartbeat.
        if (now - current.lastBeat >= current.intervalMs) {
          current.lastBeat = now
          scrobbleClient.pause(buildPayload(item)).then(onSuccess, onError)
        }
      },

      // Called by playerAdapter when the player is destroyed / ends.
      finish: function (item) {
        if (!active() || !current) {
          current = null
          return
        }
        var used = item || current.item
        if (!current.stopped && clampPercent(used.percent) >= Settings.threshold) {
          this._stop(used)
        }
        current = null
      },

      // /stop is terminal: best-effort with one immediate re-send on failure.
      _stop: function (item) {
        if (!current || current.stopped) return
        current.stopped = true
        log('stop', current.signature, clampPercent(item.percent) + '%')
        var payload = buildPayload(item)
        scrobbleClient.stop(payload).then(onSuccess, function (err) {
          if (err && (err.status === 401 || err.status === 403)) return onError(err)
          // one immediate retry, then give up
          scrobbleClient.stop(payload).then(onSuccess, onError)
        })
      },
    }
  })()

  // ── playerAdapter ──────────────────────────────────────────────────────
  // The only part tied to Lampa internals. Normalizes card + season/episode +
  // progress and drives sessionController.
  //
  // Progress: Timeline 'update' is the source of truth (it's the one signal
  // every player emits, including external and native-TV ones). PlayerVideo
  // 'timeupdate' just adds finer heartbeats for the built-in player.
  // Card: Lampa.Activity.active(), falling back to the card saved on play.
  // Season/episode: from the play data, or parsed off the title.

  var LAST_CARD_KEY = 'myshows_last_card'

  var playerAdapter = (function () {
    var lastPercent = 0
    var lastDuration = 0
    var lastAudioLang = undefined
    var activeContext = null // { hash, raw } captured on start/external

    function firstDefined() {
      for (var i = 0; i < arguments.length; i++) {
        if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]
      }
      return undefined
    }

    function toNum(v) {
      if (v === undefined || v === null || v === '') return undefined
      var n = parseInt(v, 10)
      return isNaN(n) ? undefined : n
    }

    function readVideoEl() {
      try {
        return (Lampa.PlayerVideo && Lampa.PlayerVideo.video && Lampa.PlayerVideo.video()) || null
      } catch (e) {
        return null
      }
    }

    function normalizeLang(code) {
      if (!code) return undefined
      var c = String(code).toLowerCase().slice(0, 3)
      var map = {
        rus: 'ru',
        eng: 'en',
        ukr: 'uk',
        jpn: 'ja',
        deu: 'de',
        ger: 'de',
        fra: 'fr',
        fre: 'fr',
        spa: 'es',
        ita: 'it',
      }
      if (map[c]) return map[c]
      return c.slice(0, 2)
    }

    // Pick an age certification from TMDB content_ratings (TV) or release_dates
    // (movie). Prefer RU, then US, then the first non-empty.
    function extractContentRating(src) {
      try {
        var cr = src.content_ratings && src.content_ratings.results
        if (cr && cr.length) {
          var byc = {}
          cr.forEach(function (r) {
            if (r && r.rating) byc[r.iso_3166_1] = r.rating
          })
          var tv =
            byc.RU ||
            byc.US ||
            (
              cr.find(function (r) {
                return r && r.rating
              }) || {}
            ).rating
          if (tv) return tv
        }
        var rd = src.release_dates && src.release_dates.results
        if (rd && rd.length) {
          var pick =
            rd.find(function (r) {
              return r.iso_3166_1 === 'RU'
            }) ||
            rd.find(function (r) {
              return r.iso_3166_1 === 'US'
            }) ||
            rd[0]
          var cert =
            pick &&
            pick.release_dates &&
            (
              pick.release_dates.find(function (d) {
                return d.certification
              }) || {}
            ).certification
          if (cert) return cert
        }
      } catch (e) {
        /* noop */
      }
      return undefined
    }

    function readCard() {
      var src = null
      try {
        var a = (Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()) || {}
        src = a.card_data || a.card || a.movie || null
      } catch (e) {
        /* noop */
      }
      if (!src) {
        try {
          src = Lampa.Storage.get(LAST_CARD_KEY, null)
        } catch (e) {
          /* noop */
        }
      }
      if (!src) return {}

      var ext = src.external_ids || {}
      var date = src.release_date || src.first_air_date || ''
      return {
        tmdb: src.id != null ? src.id : src.tmdb,
        imdb: src.imdb_id || src.imdb || (src.ids && src.ids.imdb),
        tvdb: ext.tvdb_id != null ? ext.tvdb_id : src.tvdb_id,
        kinopoisk: src.kinopoisk_id || src.kp_id,
        title: src.title || src.name,
        original_title: src.original_title || src.original_name,
        year: date ? parseInt(String(date).slice(0, 4), 10) : undefined,
        // number_of_seasons is how Lampa tells a series from a movie.
        isSeries: !!(src.number_of_seasons || src.seasons),
        contentRating: extractContentRating(src),
      }
    }

    // Some Lampa builds don't expose season_number/episode_number on the play
    // item; the numbers are baked into the episode title (e.g. "S1 / Серия 1").
    // Parse them out as a fallback.
    function parseFromTitle(title) {
      var out = {}
      if (!title) return out
      var ms = title.match(/\bS(?:eason)?\s*(\d+)/i) || title.match(/сезон\s*(\d+)/i)
      if (ms) out.season = parseInt(ms[1], 10)
      var me = title.match(/(?:сери[яї]|episode|эпизод|епізод|ep\.?|\bE)\s*(\d+)/i)
      if (me) out.episode = parseInt(me[1], 10)
      // Last resort: a trailing number, e.g. "… Серия 1".
      if (out.episode == null) {
        var mt = title.match(/(\d+)\s*$/)
        if (mt) out.episode = parseInt(mt[1], 10)
      }
      return out
    }

    // Season/episode from the play data (playdata() is empty for external players).
    function readEpisode(data) {
      data = data || {}
      var title = data.title || data.name
      var season = toNum(firstDefined(data.season_number, data.season))
      var episode = toNum(firstDefined(data.episode_number, data.episode, data.num))
      if (season == null || episode == null) {
        var parsed = parseFromTitle(title)
        if (season == null) season = parsed.season
        if (episode == null) episode = parsed.episode
      }
      return { season: season, episode: episode, episodeTitle: title }
    }

    function buildItem(percent) {
      var card = readCard()
      var ep = readEpisode(activeContext && activeContext.raw)
      // Treat as an episode only when we actually have an episode number.
      var asEpisode = ep.episode != null
      var v = readVideoEl()
      var duration = (v && v.duration) || lastDuration || 0
      return {
        card: card,
        season: asEpisode ? (ep.season != null ? ep.season : 1) : undefined,
        episode: asEpisode ? ep.episode : undefined,
        episodeTitle: ep.episodeTitle,
        percent: percent,
        runtimeMinutes: duration > 0 ? Math.round(duration / 60) : undefined,
        resolution: mapResolution(v && v.videoHeight),
        audioLanguage: lastAudioLang || undefined,
      }
    }

    return {
      init: function () {
        // Open a session. 'start' fires for the built-in player, 'external' for
        // external ones (Android/webOS/etc); only one fires per playback.
        function onPlaybackBegin(data) {
          try {
            data = data || {}
            var card =
              data.card ||
              (Lampa.Activity.active &&
                Lampa.Activity.active() &&
                (Lampa.Activity.active().card || Lampa.Activity.active().movie))
            if (card) Lampa.Storage.set(LAST_CARD_KEY, card)

            var hash = data.timeline && data.timeline.hash
            var resume =
              data.timeline && typeof data.timeline.percent === 'number'
                ? data.timeline.percent
                : 0

            activeContext = { hash: hash, raw: data }
            lastPercent = resume

            var item = buildItem(resume)
            log('player begin', item)
            sessionController.play(item)
          } catch (e) {
            log('begin handler error', e)
          }
        }

        Lampa.Player.listener.follow('start', onPlaybackBegin)
        Lampa.Player.listener.follow('external', onPlaybackBegin)

        // Extra heartbeats for the built-in player: 'timeupdate' fires every
        // tick with { duration, current }; the /pause throttle caps the rate.
        if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
          Lampa.PlayerVideo.listener.follow('timeupdate', function (e) {
            try {
              if (!e || !e.duration || e.current == null) return
              lastDuration = e.duration
              var percent = (e.current / e.duration) * 100
              lastPercent = percent
              if (activeContext) sessionController.progress(buildItem(percent))
            } catch (err) {
              log('timeupdate error', err)
            }
          })

          // Audio tracks: remember the selected track's language.
          Lampa.PlayerVideo.listener.follow('tracks', function (e) {
            try {
              var tracks = e && e.tracks
              if (!tracks || !tracks.length) return
              for (var i = 0; i < tracks.length; i++) {
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

        // Source of truth for progress. Timeline 'update' carries the same
        // percent Lampa uses for resume, and it's the only signal external
        // players give us (once, on return). Matched to the session by hash.
        if (Lampa.Timeline && Lampa.Timeline.listener) {
          Lampa.Timeline.listener.follow('update', function (e) {
            try {
              var road = e && e.data && e.data.road
              var hash = e && e.data && e.data.hash
              if (!road || typeof road.percent !== 'number') return
              // no session, or a tick for a different file
              if (!activeContext) return
              if (activeContext.hash && hash && activeContext.hash !== hash) return
              lastPercent = road.percent
              sessionController.progress(buildItem(road.percent))
            } catch (err) {
              log('timeline update error', err)
            }
          })
        }

        Lampa.Player.listener.follow('destroy', function () {
          try {
            sessionController.finish(buildItem(lastPercent))
          } catch (e) {
            log('destroy handler error', e)
          }
          activeContext = null
        })
      },
    }
  })()

  // ── settings UI ──────────────────────────────────────────────────────────

  function registerSettings() {
    Lampa.SettingsApi.addComponent({
      component: PLUGIN_ID,
      name: 'MyShows',
      icon: '<svg viewBox="0 0 149 152" width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M28.5832 152C12.4727 152 0 139.166 0 123.765V78.0767C0 62.1626 12.9924 49.8421 28.5832 49.8421H119.53C135.64 49.8421 148.113 62.676 148.113 78.0767V123.765C148.113 139.68 135.121 152 119.53 152H28.5832ZM16.1106 83.2103V118.632C16.1106 127.359 23.3863 134.546 32.2211 134.546H115.372C124.207 134.546 131.483 127.359 131.483 118.632V83.2103C131.483 74.4832 124.207 67.2962 115.372 67.2962H32.2211C23.3863 67.2962 16.1106 74.4832 16.1106 83.2103Z"/><path fill="currentColor" d="M73.7954 24.6876C62.3621 24.6876 53.5273 33.4146 53.0076 44.1951H94.5832C94.0635 33.4146 85.2286 24.6876 73.7954 24.6876Z"/><path fill="currentColor" d="M56.1264 33.4142L31.7008 9.28645C30.6614 8.25974 30.6614 7.23302 31.7008 6.20631C32.7402 5.17959 33.7795 5.17959 34.8189 6.20631L59.2446 30.3341C60.284 31.3608 60.284 32.3875 59.2446 33.4142C58.7249 33.9276 57.1658 33.9276 56.1264 33.4142Z"/><path fill="currentColor" d="M36.422 10.5162C38.8574 8.11045 38.8574 4.21 36.422 1.80429C33.9865 -0.601431 30.038 -0.601428 27.6025 1.80429C25.1671 4.21001 25.1671 8.11045 27.6025 10.5162C30.038 12.9219 33.9865 12.9219 36.422 10.5162Z"/><path fill="currentColor" d="M88.3502 29.8209L112.776 5.69313C113.815 4.66642 114.855 4.66642 115.894 5.69313C116.934 6.71984 116.934 7.74656 115.894 8.77327L91.4684 32.9011C90.429 33.9278 89.3896 33.9278 88.3502 32.9011C87.3109 32.3877 87.3109 30.8476 88.3502 29.8209Z"/><path fill="currentColor" d="M119.134 10.7008C121.566 8.29166 121.56 4.3912 119.121 1.98888C116.683 -0.413431 112.734 -0.407898 110.302 2.00122C107.87 4.41034 107.876 8.31077 110.315 10.7131C112.753 13.1154 116.702 13.1099 119.134 10.7008Z"/></svg>',
    })

    // Connection status row (read-only). Reflects the last GET /check or
    // scrobble result; refreshed live via the Storage listener in start().
    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: { name: 'myshows_status_view', type: 'static' },
      field: {
        name: 'Состояние',
        description: statusLabel(Lampa.Storage.get(STORAGE.status, '')),
      },
      // Capture the rendered row and sync it to the current status every time
      // the settings screen opens (the description string above is only the
      // initial value captured at registration time).
      onRender: function (item) {
        statusRow = item
        refreshStatusRow(Lampa.Storage.get(STORAGE.status, ''))
      },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: { name: STORAGE.enabled, type: 'trigger', default: true },
      field: { name: 'Скробблинг', description: 'Отправлять прогресс просмотра в MyShows' },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      // Two Lampa input-param quirks:
      //  - `values: ''` is needed: Lampa stores values[name] = param.values
      //    and renders `typeof values[name] == 'string' ? ... : values[name][key]`.
      //    Without it values[name] is undefined and it crashes on "reading ''".
      //  - `placeholder` must be set: the template inserts `param.placeholder`
      //    verbatim, so omitting it renders the literal string "undefined".
      param: {
        name: STORAGE.token,
        type: 'input',
        default: '',
        values: '',
        placeholder: 'Вставьте токен из профиля MyShows',
      },
      field: {
        name: 'Токен MyShows',
        description: 'Bearer-токен из профиля MyShows (проверяется при вводе)',
      },
      // Auto-check the token whenever it changes.
      onChange: function () {
        checkToken(true)
      },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: {
        name: STORAGE.threshold,
        type: 'select',
        values: { 50: '50%', 60: '60%', 70: '70%', 80: '80%', 90: '90%', 95: '95%' },
        default: String(DEFAULT_THRESHOLD),
      },
      field: { name: 'Порог «просмотрено»', description: 'С какого % засчитывать просмотр' },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: { name: STORAGE.notify, type: 'trigger', default: false },
      field: {
        name: 'Уведомления об ошибках',
        description: 'Показывать ошибки скробблинга на экране',
      },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: {
        name: STORAGE.baseUrl,
        type: 'input',
        default: DEFAULT_BASE_URL,
        values: '',
        placeholder: DEFAULT_BASE_URL,
      },
      field: { name: 'Адрес API', description: 'Базовый URL scrobble API (для тестов/self-host)' },
    })
  }

  // Map the stored connection status to a short coloured label for the UI.
  function statusLabel(code) {
    switch (code) {
      case 'ok':
        return '<span style="color:#16a34a">● Подключено</span>'
      case 'invalid':
        return '<span style="color:#dc2626">● Токен недействителен</span>'
      case 'error':
        return '<span style="color:#d97706">● Нет связи с MyShows</span>'
      default:
        return '<span style="color:#76767e">○ Не проверено</span>'
    }
  }

  // Live handle to the settings "Состояние" row, captured in its onRender.
  // Lampa renders `type:'static'` params WITHOUT a data-name attribute, so we
  // keep the element itself and patch it in place rather than re-query the DOM.
  var statusRow = null
  function refreshStatusRow(code) {
    if (!statusRow) return
    try {
      statusRow.find('.settings-param__descr').html(statusLabel(code))
    } catch (e) {
      /* noop */
    }
  }

  // Validate the token via GET /check and update status.
  // notify=true also shows a toast (used from the token field onChange).
  function checkToken(notify) {
    if (!Settings.token) {
      if (notify) Lampa.Noty.show('MyShows: токен не задан')
      return
    }
    if (notify) Lampa.Noty.show('MyShows: проверяем…')
    scrobbleClient.check().then(
      function () {
        Settings.setStatus('ok')
        if (notify) Lampa.Noty.show('MyShows: токен работает ✓')
      },
      function (err) {
        var bad = err && (err.status === 401 || err.status === 403)
        Settings.setStatus(bad ? 'invalid' : 'error')
        if (notify) {
          Lampa.Noty.show(
            'MyShows: ошибка — ' +
              (bad ? 'токен недействителен' : (err && err.message) || 'нет связи'),
          )
        }
      },
    )
  }

  // ── bootstrap ──────────────────────────────────────────────────────────

  function start() {
    // Register in the plugin manifest (shows up in the app's plugin list).
    try {
      Lampa.Manifest.plugins = {
        type: 'video',
        version: VERSION,
        name: 'MyShows Scrobbler',
        description: 'Отправляет прогресс просмотра в MyShows',
        component: PLUGIN_ID,
      }
    } catch (e) {
      /* noop */
    }

    registerSettings()
    playerAdapter.init()

    // Keep the settings "Состояние" row in sync when the stored status changes
    // (token check, scrobble error/recovery) while the screen is open.
    try {
      Lampa.Storage.listener.follow('change', function (e) {
        if (!e || e.name !== STORAGE.status) return
        refreshStatusRow(e.value)
      })
    } catch (e) {
      /* noop */
    }

    // Validate the token on launch (best effort, silent; just updates status).
    checkToken(false)

    log('plugin ready, version', VERSION)
  }

  // Run once the app core is ready (PLUGINS_GUIDE §3 readiness pattern).
  function boot() {
    if (window.appready) start()
    else
      Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') start()
      })
  }

  if (window.Lampa) {
    boot()
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.Lampa) boot()
    })
  }
})()
