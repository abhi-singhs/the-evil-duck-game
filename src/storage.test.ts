import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, loadSave, saveGame } from './storage'

describe('browser save data', () => {
  let data: string | null
  beforeEach(() => {
    data = null
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    vi.stubGlobal('localStorage', {
      getItem: () => data,
      setItem: (_key: string, value: string) => { data = value },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads defaults when there is no saved data', () => {
    expect(loadSave()).toEqual({ settings: defaultSettings(), best: { damage: 0, wins: 0, fastest: null }, warning: null })
  })
  it('round-trips scores and settings', () => {
    const settings = { ...defaultSettings(), muted: true, musicVolume: 0.4 }
    const best = { damage: 30000, wins: 1, fastest: 110.5 }
    expect(saveGame(settings, best)).toBe(null)
    expect(loadSave()).toEqual({ settings, best, warning: null })
  })
  it.each(['not json', '{"version":2}', '{"version":1,"settings":{},"best":{}}'])('surfaces malformed saves instead of crashing: %s', (raw) => {
    data = raw
    expect(loadSave().warning).not.toBe(null)
    expect(loadSave().best.damage).toBe(0)
  })
  it('does not accept invalid numeric settings', () => {
    data = JSON.stringify({
      version: 1, settings: { ...defaultSettings(), sfxVolume: 20 },
      best: { damage: 0, wins: 0, fastest: null },
    })
    expect(loadSave().warning).toContain('invalid')
  })
  it('surfaces storage permission and quota failures while keeping the game playable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('Denied', 'SecurityError') },
      setItem: () => { throw new DOMException('Full', 'QuotaExceededError') },
    })
    expect(loadSave().warning).toContain('unavailable')
    expect(saveGame(defaultSettings(), { damage: 0, wins: 0, fastest: null })).toContain('unavailable')
  })
})
