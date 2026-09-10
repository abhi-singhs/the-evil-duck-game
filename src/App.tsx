import { useCallback, useEffect, useRef, useState } from 'react'
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

const ignoreCoopResult = () => {}

function inviteRoom(): string | null {
  return normalizeRoomCode(new URL(window.location.href).searchParams.get('room'))
}

function setRoomUrl(room: string | null) {
  const url = new URL(window.location.href)
  if (room) url.searchParams.set('room', room)
  else url.searchParams.delete('room')
  window.history.replaceState(window.history.state, '', url)
}

export default function App() {
  const { settings, best, storageWarning, setSettings, recordResult } = useSave()
  const [initialRoom] = useState(inviteRoom)
  const [screen, setScreen] = useState<Screen>(initialRoom ? 'name' : 'solo')
  const [intent, setIntent] = useState<NameIntent>('join')
  const [requestedRoom, setRequestedRoom] = useState<string | null>(initialRoom)
  const [name, setName] = useState('')
  const [session, setSession] = useState<RemoteSession | null>(null)
  const [status, setStatus] = useState<CoopStatus | null>(null)
  const [coopKey, setCoopKey] = useState(0)
  const sessionRef = useRef<RemoteSession | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const disposeSession = useCallback(() => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    sessionRef.current?.dispose()
    sessionRef.current = null
  }, [])

  const closeSession = useCallback(() => {
    disposeSession()
    setSession(null)
    setStatus(null)
  }, [disposeSession])

  const openSession = useCallback((playerName: string, room: string | null) => {
    closeSession()
    const next = new RemoteSession(gameServerUrl(), playerName, room)
    sessionRef.current = next
    unsubscribeRef.current = next.subscribe((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.room && nextStatus.playerId) setRoomUrl(nextStatus.room)
    })
    setName(playerName)
    setSession(next)
    setCoopKey((key) => key + 1)
    setScreen('coop')
  }, [closeSession])

  const leaveCoop = useCallback(() => {
    closeSession()
    setRequestedRoom(null)
    setRoomUrl(null)
    setScreen('solo')
  }, [closeSession])

  useEffect(() => () => disposeSession(), [disposeSession])

  const createRoom = useCallback(() => {
    const stored = savedName()
    if (stored) {
      openSession(stored, null)
      return
    }
    setIntent('create')
    setRequestedRoom(null)
    setScreen('name')
  }, [openSession])

  const chooseRoom = useCallback(() => {
    const stored = savedName()
    setRequestedRoom(null)
    if (stored) {
      setName(stored)
      setScreen('join')
      return
    }
    setIntent('join')
    setScreen('name')
  }, [])

  const submitName = useCallback((value: string) => {
    const clean = rememberName(value)
    setName(clean)
    if (requestedRoom || intent === 'create') {
      openSession(clean, requestedRoom)
      return
    }
    setScreen('join')
  }, [intent, openSession, requestedRoom])

  const renameBeforeJoin = useCallback(() => {
    setIntent('join')
    setRequestedRoom(null)
    setScreen('name')
  }, [])

  const renameFromLobby = useCallback(() => {
    closeSession()
    setRoomUrl(null)
    setIntent('create')
    setRequestedRoom(null)
    setScreen('name')
  }, [closeSession])

  if (screen === 'name') {
    return (
      <main className="app app-centered">
        <NamePrompt intent={intent} room={requestedRoom} cap={ROOM_CAP}
          onSubmit={submitName} onCancel={leaveCoop} />
      </main>
    )
  }

  if (screen === 'join') {
    return (
      <main className="app app-centered">
        <JoinRoom name={name} initialCode={requestedRoom}
          onJoin={(room) => openSession(name, room)}
          onRename={renameBeforeJoin} onCancel={leaveCoop} />
      </main>
    )
  }

  if (screen === 'coop' && session && status) {
    if (status.inRun && !status.waiting) {
      return (
        <Hunt key={`coop-${coopKey}`} settings={settings} best={best}
          storageWarning={storageWarning} setSettings={setSettings}
          onComplete={ignoreCoopResult} session={session} coop={status}
          onLeaveCoop={leaveCoop} />
      )
    }
    return (
      <main className="app app-centered">
        <CoopLobby status={status} name={name}
          onReady={(value) => session.setReady(value)}
          onStart={() => session.start()}
          onRename={renameFromLobby} onLeave={leaveCoop} />
      </main>
    )
  }

  return (
    <Hunt key="solo" settings={settings} best={best}
      storageWarning={storageWarning} setSettings={setSettings}
      onComplete={recordResult} onCreateRoom={createRoom} onJoinRoom={chooseRoom} />
  )
}
