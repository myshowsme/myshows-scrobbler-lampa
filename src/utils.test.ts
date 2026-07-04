import { describe, expect, it } from 'vitest'
import { clampPercent, mapResolution } from './utils'

describe('clampPercent', () => {
  it('rounds to one decimal', () => {
    expect(clampPercent(87.44)).toBe(87.4)
    expect(clampPercent(87.46)).toBe(87.5)
  })

  it('clamps out-of-range values', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(150)).toBe(100)
  })

  it('coerces junk to 0', () => {
    expect(clampPercent('nope')).toBe(0)
    expect(clampPercent(undefined)).toBe(0)
    expect(clampPercent(null)).toBe(0)
  })

  it('accepts numeric strings', () => {
    expect(clampPercent('42.5')).toBe(42.5)
  })
})

describe('mapResolution', () => {
  it('maps heights to the API enum', () => {
    expect(mapResolution(2160)).toBe('uhd_4k')
    expect(mapResolution(1080)).toBe('hd_1080p')
    expect(mapResolution(720)).toBe('hd_720p')
    expect(mapResolution(576)).toBe('sd_576p')
    expect(mapResolution(480)).toBe('sd_480p')
  })

  it('returns undefined below the lowest bucket or for falsy input', () => {
    expect(mapResolution(360)).toBeUndefined()
    expect(mapResolution(0)).toBeUndefined()
    expect(mapResolution(undefined)).toBeUndefined()
    expect(mapResolution(null)).toBeUndefined()
  })
})
