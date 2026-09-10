import { useCallback, useEffect, useRef, useState } from 'react'
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

type Screen = 'solo' | 'name' | 'join' | 'coop'
type Connection = { session: RemoteSession; unsubscribe: () => void }

function setRoomParam(room: string | null) {
  const url = new URL(window.location.href)
  if (room) url.searchParams.set('room', room)
  else url.searchParams.delete('room')
  window.history.replaceState(null, '', url)
}

export default function App() {
  const { settings, best, storageWarning, setSettings, recordResult } = useSave()
  const [invite] = useState(() => normalizeRoomCode(new URLSearchParams(window.location.search).get('room')))
  const [name, setName] = useState(savedName)
  const [intent, setIntent] = useState<NameIntent>('create')
  const [pendingRoom, setPendingRoom] = useState<string | null>(invite)
  const [screen, setScreen] = useState<Screen>(invite ? 'name' : 'solo')
  const [status, setStatus] = useState<CoopStatus | null>(null)
  const [remote, setRemote] = useState<RemoteSession | null>(null)
  const connection = useRef<Connection | null>(null)

  const disposeConnection = useCallback(() => {
    const previous = connection.current
    connection.current = null
    previous?.unsubscribe()
    previous?.session.dispose()
  }, [])

  useEffect(() => disposeConnection, [disposeConnection])

  const leave = useCallback(() => {
    disposeConnection()
    setRemote(null)
    setStatus(null)
    setPendingRoom(null)
    setScreen('solo')
    setRoomParam(null)
  }, [disposeConnection])

  const connect = useCallback((player: string, room: string | null) => {
    disposeConnection()
    const session = new RemoteSession(gameServerUrl(), player, room)
    connection.current = { session, unsubscribe: session.subscribe(setStatus) }
    setRemote(session)
    setScreen('coop')
  }, [disposeConnection])

  const enter = useCallback((next: NameIntent) => {
    setIntent(next)
    setPendingRoom(null)
    const known = savedName()
    if (!known) {
      setScreen('name')
      return
    }
    setName(known)
    if (next === 'create') connect(known, null)
    else setScreen('join')
  }, [connect])

  const submitName = useCallback((typed: string) => {
    const clean = rememberName(typed)
    setName(clean)
    if (pendingRoom) connect(clean, pendingRoom)
    else if (intent === 'create') connect(clean, null)
    else setScreen('join')
  }, [connect, intent, pendingRoom])

  const rename = useCallback((next: NameIntent) => {
    leave()
    setIntent(next)
    setScreen('name')
  }, [leave])

  useEffect(() => {
    if (status?.room) setRoomParam(status.room)
  }, [status?.room])

  const recordSolo = useCallback((state: GameState) => {
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

  if (screen === 'name') {
    return shell(
      <NamePrompt intent={intent} room={pendingRoom} cap={ROOM_CAP}
        onSubmit={submitName} onCancel={leave} />,
    )
  }
  if (screen === 'join') {
    return shell(
      <JoinRoom name={name} initialCode={invite} onJoin={(room) => connect(name, room)}
        onRename={() => rename('join')} onCancel={leave} />,
    )
  }
  if (screen === 'coop' && remote && status) {
    if (!status.inRun || status.waiting) {
      return shell(
        <CoopLobby status={status} name={name}
          onReady={(ready) => remote.setReady(ready)} onStart={() => remote.start()}
          onRename={() => rename('create')} onLeave={leave} />,
      )
    }
    return (
      <Hunt key={status.room ?? 'coop'} settings={settings} best={best} storageWarning={storageWarning}
        setSettings={setSettings} onComplete={recordSolo} session={remote} coop={status} onLeaveCoop={leave} />
    )
  }
  return (
    <Hunt key="solo" settings={settings} best={best} storageWarning={storageWarning}
      setSettings={setSettings} onComplete={recordSolo}
      onCreateRoom={() => enter('create')} onJoinRoom={() => enter('join')} />
  )
}
