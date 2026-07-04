// Pure parsing of Lampa/TMDB shapes into our normalized Card + episode info.
// No Lampa globals, no DOM — the player adapter fetches the raw objects and
// hands them here, so all the fiddly parsing stays unit-testable.

import type { Card } from './types'

// External TMDB / play-data objects are dynamically shaped; treat as loose.
type Raw = Record<string, any>

export interface EpisodeInfo {
  season?: number
  episode?: number
  episodeTitle?: string
}

function firstDefined<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null) {
      return v
    }
  }
  return undefined
}

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') {
    return undefined
  }
  const n = parseInt(v as string, 10)
  return isNaN(n) ? undefined : n
}

const LANG_MAP: Record<string, string> = {
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

export function normalizeLang(code: unknown): string | undefined {
  if (!code) {
    return undefined
  }
  const c = String(code).toLowerCase().slice(0, 3)
  if (LANG_MAP[c]) {
    return LANG_MAP[c]
  }
  return c.slice(0, 2)
}

// Pick an age certification from TMDB content_ratings (TV) or release_dates
// (movie). Prefer RU, then US, then the first non-empty.
export function extractContentRating(src: Raw): string | undefined {
  try {
    const cr = src.content_ratings && src.content_ratings.results
    if (cr && cr.length) {
      const byc: Record<string, string> = {}
      cr.forEach(function (r: Raw) {
        if (r && r.rating) {
          byc[r.iso_3166_1] = r.rating
        }
      })
      const tv = byc.RU || byc.US || (cr.find((r: Raw) => r && r.rating) || {}).rating
      if (tv) {
        return tv
      }
    }
    const rd = src.release_dates && src.release_dates.results
    if (rd && rd.length) {
      const pick =
        rd.find((r: Raw) => r.iso_3166_1 === 'RU') ||
        rd.find((r: Raw) => r.iso_3166_1 === 'US') ||
        rd[0]
      const cert =
        pick &&
        pick.release_dates &&
        (pick.release_dates.find((d: Raw) => d.certification) || {}).certification
      if (cert) {
        return cert
      }
    }
  } catch {
    /* noop */
  }
  return undefined
}

// Normalize a raw TMDB-ish source object into our Card.
export function normalizeCard(src: Raw | null | undefined): Card {
  if (!src) {
    return {}
  }
  const ext = src.external_ids || {}
  const date = src.release_date || src.first_air_date || ''
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

// Some Lampa builds don't expose season_number/episode_number on the play item;
// the numbers are baked into the episode title (e.g. "S1 / Серия 1"). Parse
// them out as a fallback.
export function parseFromTitle(title: string | undefined): {
  season?: number
  episode?: number
} {
  const out: { season?: number; episode?: number } = {}
  if (!title) {
    return out
  }
  const ms = title.match(/\bS(?:eason)?\s*(\d+)/i) || title.match(/сезон\s*(\d+)/i)
  if (ms) {
    out.season = parseInt(ms[1]!, 10)
  }
  const me = title.match(/(?:сери[яї]|episode|эпизод|епізод|ep\.?|\bE)\s*(\d+)/i)
  if (me) {
    out.episode = parseInt(me[1]!, 10)
  }
  // Last resort: a trailing number, e.g. "… Серия 1".
  if (out.episode == null) {
    const mt = title.match(/(\d+)\s*$/)
    if (mt) {
      out.episode = parseInt(mt[1]!, 10)
    }
  }
  return out
}

// ── external-player playlists ────────────────────────────────────────────────

export interface PlaylistEntry {
  season: number
  episode: number
  title?: string
  hash: string
}

// Lampa's episode resume-hash formula (timeline.js / episode.js):
// [season, season > 10 ? ':' : '', episode, original].join('')
export function episodeHashSource(season: number, episode: number, original: string): string {
  return [season, season > 10 ? ':' : '', episode, original].join('')
}

// Normalize the playlist passed to an external player into PlaylistEntry[].
// Lampa attaches a timeline (with the resume hash) to every element; fall back
// to computing the hash the way Lampa does for episodes. `hashFn` is injected
// (Lampa.Utils.hash in production) to keep this module Lampa-free.
export function normalizePlaylist(
  list: Raw[] | null | undefined,
  card: Card,
  hashFn: (source: string) => string | number,
): PlaylistEntry[] {
  const out: PlaylistEntry[] = []
  if (!list || !list.length) {
    return out
  }
  // Card.original_title already normalizes original_name || original_title;
  // Lampa hashes '' when both are missing, so no further fallback here.
  const original = card.original_title || ''
  for (const el of list) {
    const ep = readEpisode(el || {})
    if (ep.episode == null) {
      continue
    }
    const season = ep.season != null ? ep.season : 1
    let hash: unknown = el && el.timeline && el.timeline.hash
    if (hash == null) {
      hash = hashFn(episodeHashSource(season, ep.episode, original))
    }
    out.push({ season, episode: ep.episode, title: ep.episodeTitle, hash: String(hash) })
  }
  return out
}

// Index of the launched item in the normalized playlist: by resume hash first,
// then by parsed season/episode. -1 when unknown — the caller must NOT assume
// a range from an unknown launch position (it would mass-mark episodes).
export function playlistIndexOf(
  playlist: PlaylistEntry[],
  hash: unknown,
  data: Raw | null | undefined,
): number {
  if (hash != null) {
    for (let i = 0; i < playlist.length; i++) {
      if (playlist[i]!.hash === String(hash)) {
        return i
      }
    }
  }
  const ep = readEpisode(data)
  if (ep.episode != null) {
    for (let i = 0; i < playlist.length; i++) {
      if (
        playlist[i]!.episode === ep.episode &&
        (ep.season == null || playlist[i]!.season === ep.season)
      ) {
        return i
      }
    }
  }
  return -1
}

// Season/episode from the play data (empty for external players).
export function readEpisode(data: Raw | null | undefined): EpisodeInfo {
  data = data || {}
  const title = data.title || data.name
  let season = toNum(firstDefined(data.season_number, data.season))
  let episode = toNum(firstDefined(data.episode_number, data.episode, data.num))
  if (season == null || episode == null) {
    const parsed = parseFromTitle(title)
    if (season == null) {
      season = parsed.season
    }
    if (episode == null) {
      episode = parsed.episode
    }
  }
  return { season, episode, episodeTitle: title }
}
