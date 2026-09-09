import { useCallback, useRef, useState } from 'react'
import type { GameState } from './game/types'
import { loadSave, saveGame } from './storage'
import type { Settings } from './storage'

export function useSave() {
  const [saved, setSaved] = useState(loadSave)
  const latest = useRef(saved)
  const commit = useCallback((next: ReturnType<typeof loadSave>) => {
    const warning = saveGame(next.settings, next.best)
    const result = { ...next, warning: warning ?? next.warning }
    latest.current = result
    setSaved(result)
  }, [])

  const setSettings = useCallback((settings: Settings) => {
    commit({ ...latest.current, settings })
  }, [commit])

  const recordResult = useCallback((result: GameState) => {
    const previous = latest.current.best
    commit({
      ...latest.current,
      best: {
        damage: Math.max(previous.damage, result.players.local.damage),
        wins: previous.wins + Number(result.status === 'won'),
        fastest: result.status === 'won'
          ? Math.min(previous.fastest ?? Infinity, result.elapsed)
          : previous.fastest,
      },
    })
  }, [commit])

  return { settings: saved.settings, best: saved.best, storageWarning: saved.warning, setSettings, recordResult }
}
