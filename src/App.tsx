import { useCallback, useEffect, useRef, useState } from 'react'
import { Hunt } from './Hunt'
import { DuckIcon } from './components/Icons'
import { CoopLobby } from './multiplayer/CoopLobby'
import { JoinRoom } from './multiplayer/JoinRoom'
import { NamePrompt } from './multiplayer/NamePrompt'
import type { NameIntent } from './multiplayer/NamePrompt'
import { rememberName, savedName } from './multiplayer/name'
import { gameServerUrl, RemoteSession } from './net/RemoteSession'
import type { CoopStatus } from './net/RemoteSession'
import { normalizeRoomCode, ROOM_CAP } from './net/protocol'
import { useSave } from './useSave'

type Screen =
  | { kind: 'solo' }
  | { kind: 'name'; intent: NameIntent; room: string | null }
  | { kind: 'join' }
  | { kind: 'coop' }

function inviteRoom(): string | null {
  return normalizeRoomCode(new URL(window.location.href).searchParams.get('room'))
}

function setRoomUrl(room: string | null) {
  const url = new URL(window.location.href)
  if (room) url.searchParams.set('room', room)
  else url.searchParams.delete('room')
  window.history.replaceState(null, '', url)
}

export default function App() {
  const { settings, best, storageWarning, setSettings, recordResult } = useSave()
  const [initialInvite] = useState(inviteRoom)
  const [screen, setScreen] = useState<Screen>(() => initialInvite
    ? { kind: 'name', intent: 'join', room: initialInvite }
    : { kind: 'solo' })
  const [name, setName] = useState(savedName)
  const [remote, setRemote] = useState<RemoteSession | null>(null)
  const [status, setStatus] = useState<CoopStatus | null>(null)
  const remoteRef = useRef<RemoteSession | null>(null)

  const closeRemote = useCallback(() => {
    remoteRef.current?.dispose()
    remoteRef.current = null
    setRemote(null)
    setStatus(null)
  }, [])

  const openRemote = useCallback((playerName: string, room: string | null) => {
    closeRemote()
    const next = new RemoteSession(gameServerUrl(), playerName, room)
    remoteRef.current = next
    setRemote(next)
    setScreen({ kind: 'coop' })
  }, [closeRemote])

  const leaveCoop = useCallback(() => {
    closeRemote()
    setRoomUrl(null)
    setScreen({ kind: 'solo' })
  }, [closeRemote])

  useEffect(() => {
    if (!remote) return
    return remote.subscribe(setStatus)
  }, [remote])

  useEffect(() => () => remoteRef.current?.dispose(), [])

  useEffect(() => {
    if (status?.room) setRoomUrl(status.room)
  }, [status?.room])

  const createRoom = () => {
    const stored = savedName()
    if (stored) {
      setName(stored)
      openRemote(stored, null)
    } else {
      setScreen({ kind: 'name', intent: 'create', room: null })
    }
  }

  const joinRoom = () => {
    const stored = savedName()
    if (stored) {
      setName(stored)
      setScreen({ kind: 'join' })
    } else {
      setScreen({ kind: 'name', intent: 'join', room: null })
    }
  }

  const submitName = (playerName: string) => {
    const remembered = rememberName(playerName)
    setName(remembered)
    if (screen.kind !== 'name') return
    if (screen.room || screen.intent === 'create') {
      openRemote(remembered, screen.room)
    } else {
      setScreen({ kind: 'join' })
    }
  }

  const renameFromLobby = () => {
    closeRemote()
    setRoomUrl(null)
    setScreen({ kind: 'name', intent: 'create', room: null })
  }

  if (screen.kind === 'solo') {
    return (
      <Hunt key="solo" settings={settings} best={best} storageWarning={storageWarning}
        setSettings={setSettings} onComplete={recordResult}
        onCreateRoom={createRoom} onJoinRoom={joinRoom} />
    )
  }

  if (screen.kind === 'coop' && remote && status?.inRun && !status.waiting) {
    return (
      <Hunt key={`coop-${status.room ?? 'connecting'}-${status.playerId ?? 'seat'}`}
        settings={settings} best={best} storageWarning={storageWarning}
        setSettings={setSettings} onComplete={() => {}} session={remote} coop={status}
        onLeaveCoop={leaveCoop} />
    )
  }

  return (
    <main className="app app-centered">
      <header className="bar">
        <span className="wordmark"><span className="brand-duck"><DuckIcon /></span>THE EVIL DUCK</span>
      </header>

      {screen.kind === 'name' && (
        <NamePrompt key={`${screen.intent}-${screen.room ?? 'none'}`} intent={screen.intent}
          room={screen.room} cap={ROOM_CAP} onSubmit={submitName} onCancel={leaveCoop} />
      )}

      {screen.kind === 'join' && (
        <JoinRoom name={name} initialCode={null}
          onJoin={(room) => openRemote(name, room)}
          onRename={() => setScreen({ kind: 'name', intent: 'join', room: null })}
          onCancel={leaveCoop} />
      )}

      {screen.kind === 'coop' && remote && status && (
        <CoopLobby status={status} name={name}
          onReady={(value) => remote.setReady(value)}
          onStart={() => remote.start()}
          onRename={renameFromLobby}
          onLeave={leaveCoop} />
      )}
    </main>
  )
}
