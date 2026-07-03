// Domain types for the scrobble payload.
//
// `Card` is the normalized TMDB-ish object the playerAdapter produces.
// `ScrobbleItem` is what the sessionController passes to the payload builder.
// These types describe the SOURCE shape; the wire DTO is built in payload-builder.

export interface Card {
  tmdb?: number | string | null;
  imdb?: string | null;
  tvdb?: number | string | null;
  kinopoisk?: number | string | null;
  title?: string;
  original_title?: string;
  year?: number;
  contentRating?: string;
  isSeries?: boolean;
}

export interface ScrobbleItem {
  card?: Card;
  /** null/undefined => treated as a movie, not an episode */
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string;
  percent: number;
  runtimeMinutes?: number;
  resolution?: string;
  audioLanguage?: string;
}

// ── Wire DTO (what the scrobble API receives) ────────────────────────────────

export interface Ids {
  tmdb?: string;
  imdb?: string;
  tvdb?: string;
  kinopoisk?: number;
}

export interface Metadata {
  resolution?: string;
  audio_language?: string;
}

export interface ShowDto {
  ids: Ids;
  title?: string;
  original_title?: string;
  year?: number;
  content_rating?: string;
}

export interface EpisodeDto {
  season?: number;
  number?: number;
  title?: string;
  runtime?: number;
  metadata?: Metadata;
}

export interface MovieDto extends ShowDto {
  runtime?: number;
  metadata?: Metadata;
}

export interface ScrobblePayload {
  source_app: string;
  progress: number;
  show?: ShowDto;
  episode?: EpisodeDto;
  movie?: MovieDto;
}
