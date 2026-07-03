import { describe, expect, it } from 'vitest'
import { buildPayload, commonIds, isEpisode } from './payload-builder'
import type { ScrobbleItem } from './types'

describe('isEpisode', () => {
  it('is true only when season and episode are both present', () => {
    expect(isEpisode({ percent: 10, season: 1, episode: 2 })).toBe(true)
    expect(isEpisode({ percent: 10, season: 1 })).toBe(false)
    expect(isEpisode({ percent: 10, episode: 2 })).toBe(false)
    expect(isEpisode({ percent: 10 })).toBe(false)
  })
})

describe('commonIds', () => {
  it('stringifies tmdb/imdb/tvdb and keeps kinopoisk numeric', () => {
    expect(commonIds({ tmdb: 42, imdb: 'tt1', tvdb: 7, kinopoisk: '555' })).toEqual({
      tmdb: '42',
      imdb: 'tt1',
      tvdb: '7',
      kinopoisk: 555,
    })
  })

  it('drops non-numeric kinopoisk and absent ids', () => {
    expect(commonIds({ tmdb: 42, kinopoisk: 'abc' })).toEqual({ tmdb: '42' })
  })
})

describe('buildPayload', () => {
  it('builds a show+episode payload for episodes', () => {
    const item: ScrobbleItem = {
      card: { tmdb: 100, title: 'Show', original_title: 'Show Orig', year: 2020 },
      season: 2,
      episode: 5,
      episodeTitle: 'The One',
      percent: 87.44,
      runtimeMinutes: 42,
      resolution: 'hd_1080p',
      audioLanguage: 'en',
    }
    expect(buildPayload(item)).toEqual({
      source_app: 'lampa',
      progress: 87.4,
      show: {
        ids: { tmdb: '100' },
        title: 'Show',
        original_title: 'Show Orig',
        year: 2020,
      },
      episode: {
        season: 2,
        number: 5,
        title: 'The One',
        runtime: 42,
        metadata: { resolution: 'hd_1080p', audio_language: 'en' },
      },
    })
  })

  it('builds a movie payload when season/episode are absent', () => {
    const item: ScrobbleItem = {
      card: { tmdb: 200, title: 'Film' },
      percent: 95,
      runtimeMinutes: 120,
    }
    expect(buildPayload(item)).toEqual({
      source_app: 'lampa',
      progress: 95,
      movie: {
        ids: { tmdb: '200' },
        title: 'Film',
        runtime: 120,
      },
    })
  })

  it('omits empty metadata and undefined fields', () => {
    const payload = buildPayload({ card: { tmdb: 1 }, percent: 10 })
    expect(payload.movie).toEqual({ ids: { tmdb: '1' } })
    expect(payload.movie?.metadata).toBeUndefined()
  })
})
