import { useCallback, useEffect, useState } from 'react'
import { DuckIcon } from './components/Icons'
import type { GameState } from './game/types'
import { Hunt } from './Hunt'
import { CoopJoin } from './multiplayer/CoopJoin'
import { CoopLobby } from './multiplayer/CoopLobby'
import { RemoteSession, gameServerUrl } from './net/RemoteSession'
import type { CoopStatus } from './net/RemoteSession'
import { ROOM_CAP, normalizeRoomCode } from './net/protocol'
import { useSave } from './useSave'

type Mode = 'solo' | 'join' | 'coop'

/** A `?room=CODE` link drops straight into the join screen with the code filled in. */
function linkedRoom(): string | null {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get('room'))
}

function setRoomParam(room: string | null) {
  const url = new URL(window.location.href)
  if (room) url.searchParams.set('room', room)
  else url.searchParams.delete('room')
  window.history.replaceState(null, '', url)
}

export default function App() {
  const { settings, best, storageWarning, setSettings, recordResult } = useSave()
  const [invite] = useState(linkedRoom)
  const [mode, setMode] = useState<Mode>(() => (linkedRoom() ? 'join' : 'solo'))
  const [status, setStatus] = useState<CoopStatus | null>(null)
  const [remote, setRemote] = useState<RemoteSession | null>(null)

  const leave = useCallback(() => {
    setRemote((current) => {
      current?.dispose()
      return null
    })
    setStatus(null)
    setMode('solo')
    setRoomParam(null)
  }, [])

  // The socket is opened from a click, never from a render or an effect, so React's development
  // double-invoke cannot quietly claim two of the fifty seats.
  const connect = useCallback((name: string, room: string | null) => {
    const next = new RemoteSession(gameServerUrl(), name, room)
    next.subscribe(setStatus)
    setRemote((current) => {
      current?.dispose()
      return next
    })
    setMode('coop')
  }, [])

  useEffect(() => {
    if (status?.room) setRoomParam(status.room)
  }, [status?.room])

  const recordSolo = useCallback((state: GameState) => {
    // Co-op runs are a shared duck on a server clock, so they stay out of this browser's records.
    if (!state.coop) recordResult(state)
  }, [recordResult])

  if (mode === 'join') {
    return (
      <main className="app app-centered">
        <header className="bar">
          <span className="wordmark"><span className="brand-duck"><DuckIcon /></span>THE EVIL DUCK</span>
        </header>
        <CoopJoin cap={ROOM_CAP} initialCode={invite} onJoin={connect} onCancel={leave} />
      </main>
    )
  }

  if (mode === 'coop' && status && remote) {
    const fighting = status.inRun && !status.waiting
    if (!fighting) {
      return (
        <main className="app app-centered">
          <header className="bar">
            <span className="wordmark"><span className="brand-duck"><DuckIcon /></span>THE EVIL DUCK</span>
          </header>
          <CoopLobby status={status}
            onReady={(value) => remote.setReady(value)}
            onStart={() => remote.start()}
            onLeave={leave} />
        </main>
      )
    }
    return (
      <Hunt key={status.room ?? 'coop'} settings={settings} best={best} storageWarning={storageWarning}
        setSettings={setSettings} onComplete={recordSolo} session={remote}
        coop={status} onLeaveCoop={leave} />
    )
  }

  return (
    <Hunt key="solo" settings={settings} best={best} storageWarning={storageWarning}
      setSettings={setSettings} onComplete={recordSolo} onCoop={() => setMode('join')} />
  )
}
