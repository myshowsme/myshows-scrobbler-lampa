// Pure numeric helpers. No Lampa, no DOM — trivially unit-testable.

/** Clamp a raw percent into [0, 100], rounded to one decimal. */
export function clampPercent(p: unknown): number {
  const n = Number(p) || 0
  if (n < 0) {
    return 0
  }
  if (n > 100) {
    return 100
  }
  return Math.round(n * 10) / 10
}

/** Map a video pixel height to the scrobble API's resolution enum. */
export function mapResolution(h: number | undefined | null): string | undefined {
  if (!h) {
    return undefined
  }
  if (h >= 2000) {
    return 'uhd_4k'
  }
  if (h >= 1000) {
    return 'hd_1080p'
  }
  if (h >= 700) {
    return 'hd_720p'
  }
  if (h >= 560) {
    return 'sd_576p'
  }
  if (h >= 460) {
    return 'sd_480p'
  }
  return undefined
}

// Lampa.Storage caches raw values in memory, and its get() drops falsy cached
// values in favor of the default ('value || empty'). A cached boolean false
// would therefore read back as the default — store booleans as 'true'/'false'
// strings, which get() parses back to booleans.
export function storableValue(v: unknown): unknown {
  if (v === true) {
    return 'true'
  }
  if (v === false) {
    return 'false'
  }
  return v
}
