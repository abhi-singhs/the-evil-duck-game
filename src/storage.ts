export type Settings = { musicVolume: number; sfxVolume: number; muted: boolean; reducedMotion: boolean }
export type BestResult = { damage: number; wins: number; fastest: number | null }
type SavedData = { version: 1; settings: Settings; best: BestResult }

const KEY = 'evil-duck.v1'
const defaultBest: BestResult = { damage: 0, wins: 0, fastest: null }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function defaultSettings(): Settings {
  return {
    musicVolume: 0.22, sfxVolume: 0.35, muted: false,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

export function loadSave(): { settings: Settings; best: BestResult; warning: string | null } {
  const fallback = { settings: defaultSettings(), best: { ...defaultBest } }
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
    return { ...fallback, warning: 'Browser storage is unavailable. Scores and settings will last for this visit only.' }
  }
  if (!raw) return { ...fallback, warning: null }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { ...fallback, warning: 'The saved game data could not be read. This visit starts with default settings.' }
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.settings) || !isRecord(value.best)) {
    return { ...fallback, warning: 'The saved game data has an unsupported format. Using default settings.' }
  }
  const settings = value.settings
  const best = value.best
  if (!validNumber(settings.musicVolume) || settings.musicVolume > 1
    || !validNumber(settings.sfxVolume) || settings.sfxVolume > 1
    || typeof settings.muted !== 'boolean' || typeof settings.reducedMotion !== 'boolean'
    || !validNumber(best.damage) || !Number.isSafeInteger(best.wins) || !validNumber(best.wins)
    || (best.fastest !== null && (!validNumber(best.fastest) || best.fastest > 120))) {
    return { ...fallback, warning: 'The saved game data contains invalid values. Using default settings.' }
  }
  return {
    settings: {
      musicVolume: settings.musicVolume, sfxVolume: settings.sfxVolume,
      muted: settings.muted, reducedMotion: settings.reducedMotion,
    },
    best: { damage: best.damage, wins: best.wins, fastest: best.fastest },
    warning: null,
  }
}

export function saveGame(settings: Settings, best: BestResult): string | null {
  const data: SavedData = { version: 1, settings, best }
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
    return null
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
    return 'Browser storage is unavailable. Scores and settings will last for this visit only.'
  }
}
