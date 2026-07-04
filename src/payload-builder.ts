// Pure: ScrobbleItem -> ScrobblePayload wire DTO.
// `card` is a normalized TMDB-ish object from the playerAdapter.
// No Lampa, no side effects — the primary Vitest target.

import { SOURCE_APP } from './config'
import { clampPercent } from './utils'
import type { Card, Ids, Metadata, ScrobbleItem, ScrobblePayload } from './types'

export function isEpisode(item: ScrobbleItem): boolean {
  return item.season != null && item.episode != null
}

export function commonIds(card: Card): Ids {
  const ids: Ids = {}
  if (card.tmdb != null) {
    ids.tmdb = String(card.tmdb)
  }
  if (card.imdb) {
    ids.imdb = String(card.imdb)
  }
  if (card.tvdb != null) {
    ids.tvdb = String(card.tvdb)
  }
  if (card.kinopoisk != null && !isNaN(Number(card.kinopoisk))) {
    ids.kinopoisk = Number(card.kinopoisk)
  }
  return ids
}

export function buildMetadata(item: ScrobbleItem): Metadata | undefined {
  const m: Metadata = {}
  if (item.resolution) {
    m.resolution = item.resolution
  }
  if (item.audioLanguage) {
    m.audio_language = item.audioLanguage
  }
  return Object.keys(m).length ? m : undefined
}

/** Copy only defined / non-empty fields onto `target` (mutates and returns it). */
export function assignDefined<T extends Record<string, unknown>>(
  target: T,
  fields: Record<string, unknown>,
): T {
  Object.keys(fields).forEach(function (k) {
    const v = fields[k]
    if (v !== undefined && v !== null && v !== '') {
      ;(target as Record<string, unknown>)[k] = v
    }
  })
  return target
}

export function buildPayload(item: ScrobbleItem): ScrobblePayload {
  const card = item.card || {}
  const meta = buildMetadata(item)
  const base: ScrobblePayload = {
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
