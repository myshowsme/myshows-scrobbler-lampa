// Domain types for the scrobble payload.
//
// `Card` is the normalized TMDB-ish object the playerAdapter produces.
// `ScrobbleItem` is what the sessionController passes to the payload builder.
// These types describe the SOURCE shape; the wire DTO is built in payload-builder.

export interface Card {
  tmdb?: number | string | null
  imdb?: string | null
  tvdb?: number | string | null
  kinopoisk?: number | string | null
  title?: string
  original_title?: string
  year?: number
  contentRating?: string
  isSeries?: boolean
}

export interface ScrobbleItem {
  card?: Card
  /** null/undefined => treated as a movie, not an episode */
  season?: number | null
  episode?: number | null
  episodeTitle?: string
  percent: number
  runtimeMinutes?: number
  resolution?: string
  audioLanguage?: string
}

// ── Wire DTO (what the scrobble API receives) ────────────────────────────────

export interface Ids {
  tmdb?: string
  imdb?: string
  tvdb?: string
  kinopoisk?: number
}

export interface Metadata {
  resolution?: string
  audio_language?: string
}

export interface ShowDto {
  ids: Ids
  title?: string
  original_title?: string
  year?: number
  content_rating?: string
}

export interface EpisodeDto {
  season?: number
  number?: number
  title?: string
  runtime?: number
  metadata?: Metadata
}

export interface MovieDto extends ShowDto {
  runtime?: number
  metadata?: Metadata
}

export interface ScrobblePayload {
  source_app: string
  progress: number
  show?: ShowDto
  episode?: EpisodeDto
  movie?: MovieDto
}

// ── Client + settings seams (for dependency injection / testing) ─────────────

export type ConnectionStatus = 'ok' | 'invalid' | 'error' | ''

export interface ScrobbleError {
  status: number
  message: string
}

export interface ScrobbleClient {
  start(payload: ScrobblePayload): Promise<unknown>
  pause(payload: ScrobblePayload): Promise<unknown>
  stop(payload: ScrobblePayload): Promise<unknown>
  check(): Promise<unknown>
}

/** The slice of settings the scrobble logic reads. Real impl is Lampa-backed. */
export interface SettingsReader {
  readonly token: string
  readonly baseUrl: string
  readonly threshold: number
  readonly enabled: boolean
  readonly notify: boolean
  setStatus(status: ConnectionStatus): void
}

export interface SessionController {
  play(item: ScrobbleItem): void
  progress(item: ScrobbleItem): void
  finish(item: ScrobbleItem): void
  abort(): void
  /**
   * One-shot mark for an episode finished inside an external player: a full
   * /start -> /stop pair outside the regular session. `done` fires when the
   * exchange settles (success or give-up) so marks can run sequentially.
   */
  markEpisode(item: ScrobbleItem, done?: () => void): void
}
