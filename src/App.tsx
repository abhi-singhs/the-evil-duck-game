import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DuckIcon } from './components/Icons'
import type { GameState } from './game/types'
import { Hunt } from './Hunt'
import { CoopLobby } from './multiplayer/CoopLobby'
import { JoinRoom } from './multiplayer/JoinRoom'
import { NamePrompt } from './multiplayer/NamePrompt'
import type { NameIntent } from './multiplayer/NamePrompt'
import { rememberName, savedName } from './multiplayer/name'
import { RemoteSession, gameServerUrl } from './net/RemoteSession'
import type { CoopStatus } from './net/RemoteSession'
import { ROOM_CAP, normalizeRoomCode } from './net/protocol'
import { useSave } from './useSave'

type Mode = 'solo' | 'name' | 'join' | 'coop'

/** A `?room=CODE` link skips the picking and heads straight for that room. */
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
  const [name, setName] = useState(savedName)
  const [intent, setIntent] = useState<NameIntent>('create')
  const [pendingRoom, setPendingRoom] = useState<string | null>(invite)
  const [status, setStatus] = useState<CoopStatus | null>(null)
  const [remote, setRemote] = useState<RemoteSession | null>(null)
  // An invite link still asks for a name first, rather than seating a stranger anonymously.
  const [mode, setMode] = useState<Mode>(() => (linkedRoom() ? 'name' : 'solo'))

  const leave = useCallback(() => {
    setRemote((current) => {
      current?.dispose()
      return null
    })
    setStatus(null)
    setPendingRoom(null)
    setMode('solo')
    setRoomParam(null)
  }, [])

  // The socket is opened from a click, never from a render or an effect, so React's development
  // double-invoke cannot quietly claim two of the fifty seats.
  const connect = useCallback((player: string, room: string | null) => {
    const next = new RemoteSession(gameServerUrl(), player, room)
    next.subscribe(setStatus)
    setRemote((current) => {
      current?.dispose()
      return next
    })
    setMode('coop')
  }, [])

  /** Both header buttons land here. With a name already saved, creating skips every screen. */
  const enterCoop = useCallback((next: NameIntent) => {
    setIntent(next)
    setPendingRoom(null)
    const known = savedName()
    if (!known) {
      setMode('name')
      return
    }
    setName(known)
    if (next === 'create') connect(known, null)
    else setMode('join')
  }, [connect])

  const submitName = useCallback((typed: string) => {
    const clean = rememberName(typed)
    setName(clean)
    if (pendingRoom) connect(clean, pendingRoom)
    else if (intent === 'create') connect(clean, null)
    else setMode('join')
  }, [connect, intent, pendingRoom])

  /** Renaming drops the current room: the name travels with the seat, so a new one is taken. */
  const rename = useCallback((next: NameIntent) => {
    setRemote((current) => {
      current?.dispose()
      return null
    })
    setStatus(null)
    setIntent(next)
    setPendingRoom(null)
    setMode('name')
    setRoomParam(null)
  }, [])

  useEffect(() => {
    if (status?.room) setRoomParam(status.room)
  }, [status?.room])

  const recordSolo = useCallback((state: GameState) => {
    // Co-op runs are a shared duck on a server clock, so they stay out of this browser's records.
    if (!state.coop) recordResult(state)
  }, [recordResult])

  const shell = (children: ReactNode) => (
    <main className="app app-centered">
      <header className="bar">
        <span className="wordmark"><span className="brand-duck"><DuckIcon /></span>THE EVIL DUCK</span>
      </header>
      {children}
    </main>
  )

  if (mode === 'name') {
    return shell(
      <NamePrompt intent={intent} room={pendingRoom} cap={ROOM_CAP}
        onSubmit={submitName} onCancel={leave} />,
    )
  }

  if (mode === 'join') {
    return shell(
      <JoinRoom name={name} initialCode={invite}
        onJoin={(room) => connect(name, room)} onRename={() => rename('join')} onCancel={leave} />,
    )
  }

  if (mode === 'coop' && status && remote) {
    const fighting = status.inRun && !status.waiting
    if (!fighting) {
      return shell(
        <CoopLobby status={status} name={name}
          onReady={(value) => remote.setReady(value)}
          onStart={() => remote.start()}
          onRename={() => rename('create')}
          onLeave={leave} />,
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
      setSettings={setSettings} onComplete={recordSolo}
      onCreateRoom={() => enterCoop('create')} onJoinRoom={() => enterCoop('join')} />
  )
}
