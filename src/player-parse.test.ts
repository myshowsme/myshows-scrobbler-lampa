import { describe, expect, it } from 'vitest'
import {
  extractContentRating,
  normalizeCard,
  normalizeLang,
  parseFromTitle,
  readEpisode,
} from './player-parse'

describe('normalizeLang', () => {
  it('maps 3-letter codes and truncates unknowns to 2 letters', () => {
    expect(normalizeLang('rus')).toBe('ru')
    expect(normalizeLang('eng')).toBe('en')
    expect(normalizeLang('ger')).toBe('de')
    expect(normalizeLang('POL')).toBe('po') // unknown -> first 2 letters
    expect(normalizeLang('')).toBeUndefined()
    expect(normalizeLang(undefined)).toBeUndefined()
  })
})

describe('parseFromTitle', () => {
  it('pulls season and episode out of a title', () => {
    expect(parseFromTitle('Season 2 Episode 5')).toEqual({ season: 2, episode: 5 })
    expect(parseFromTitle('S1 / Серия 3')).toEqual({ season: 1, episode: 3 })
    expect(parseFromTitle('Сезон 4 эпизод 7')).toEqual({ season: 4, episode: 7 })
  })

  it('falls back to a trailing number for the episode', () => {
    expect(parseFromTitle('Какое-то название 12')).toEqual({ episode: 12 })
  })

  it('returns empty for a plain title', () => {
    expect(parseFromTitle('The Movie')).toEqual({})
    expect(parseFromTitle(undefined)).toEqual({})
  })
})

describe('readEpisode', () => {
  it('prefers explicit numeric fields', () => {
    expect(readEpisode({ season_number: 3, episode_number: 9, title: 'X' })).toEqual({
      season: 3,
      episode: 9,
      episodeTitle: 'X',
    })
  })

  it('falls back to title parsing when numbers are missing', () => {
    expect(readEpisode({ title: 'S2 Серия 4' })).toEqual({
      season: 2,
      episode: 4,
      episodeTitle: 'S2 Серия 4',
    })
  })

  it('handles empty play data', () => {
    expect(readEpisode(null)).toEqual({
      season: undefined,
      episode: undefined,
      episodeTitle: undefined,
    })
  })
})

describe('normalizeCard', () => {
  it('normalizes a TMDB series card', () => {
    const card = normalizeCard({
      id: 1399,
      name: 'Game of Thrones',
      original_name: 'Game of Thrones',
      first_air_date: '2011-04-17',
      number_of_seasons: 8,
      external_ids: { tvdb_id: 121361 },
      imdb_id: 'tt0944947',
    })
    expect(card).toMatchObject({
      tmdb: 1399,
      imdb: 'tt0944947',
      tvdb: 121361,
      title: 'Game of Thrones',
      year: 2011,
      isSeries: true,
    })
  })

  it('normalizes a movie card and marks it non-series', () => {
    const card = normalizeCard({ id: 27205, title: 'Inception', release_date: '2010-07-16' })
    expect(card).toMatchObject({ tmdb: 27205, title: 'Inception', year: 2010, isSeries: false })
  })

  it('returns an empty object for no source', () => {
    expect(normalizeCard(null)).toEqual({})
  })
})

describe('extractContentRating', () => {
  it('prefers the RU TV content rating', () => {
    const src = {
      content_ratings: {
        results: [
          { iso_3166_1: 'US', rating: 'TV-MA' },
          { iso_3166_1: 'RU', rating: '18+' },
        ],
      },
    }
    expect(extractContentRating(src)).toBe('18+')
  })

  it('falls back to a movie certification from release_dates', () => {
    const src = {
      release_dates: {
        results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }],
      },
    }
    expect(extractContentRating(src)).toBe('PG-13')
  })

  it('returns undefined when nothing is present', () => {
    expect(extractContentRating({})).toBeUndefined()
  })
})
