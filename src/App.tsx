import { useCallback, useEffect, useRef, useState } from 'react'
import { Hunt } from './Hunt'
import { LocalSession } from './game/session'
import type { GameState } from './game/types'
import { CoopLobby } from './multiplayer/CoopLobby'
import { JoinRoom } from './multiplayer/JoinRoom'
import { NamePrompt } from './multiplayer/NamePrompt'
import { rememberName, savedName } from './multiplayer/name'
import { RemoteSession, gameServerUrl, type CoopStatus } from './net/RemoteSession'
import { normalizeRoomCode, ROOM_CAP } from './net/protocol'
import { useSave } from './useSave'

type Prompt =
  | { kind: 'create'; back: 'solo' }
  | { kind: 'join'; room: string | null; mode: 'start' | 'return' | 'rejoin'; back: 'join-code' | 'lobby' }

const makeConnectingStatus = (room: string | null): CoopStatus => ({
  phase: 'connecting',
  inRun: false,
  room,
  playerId: null,
  hostId: null,
  members: [],
  waiting: false,
  error: null,
  cap: ROOM_CAP,
  teamDamage: 0,
  alive: 0,
})

export default function App() {
  const { settings, best, storageWarning, setSettings, recordResult } = useSave()
  const [playerName, setPlayerName] = useState(() => savedName())
  const [inviteRoom] = useState(() => normalizeRoomCode(new URLSearchParams(window.location.search).get('room')))
  const [joinCode, setJoinCode] = useState<string | null>(inviteRoom)
  const [joinScreen, setJoinScreen] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [soloSession] = useState(() => new LocalSession())
  const [coopSession, setCoopSession] = useState<RemoteSession | null>(null)
  const coopSessionRef = useRef<RemoteSession | null>(null)
  const [coopStatus, setCoopStatus] = useState<CoopStatus | null>(null)

  useEffect(() => {
    if (!coopSession) {
      setCoopStatus(null)
      return
    }
    return coopSession.subscribe(setCoopStatus)
  }, [coopSession])

  useEffect(() => () => {
    coopSessionRef.current?.dispose()
    coopSessionRef.current = null
  }, [])

  const beginCoop = useCallback((room: string | null, rawName: string, status?: CoopStatus) => {
    const name = rememberName(rawName)
    setPlayerName(name)
    if (room !== null) setJoinCode(room)
    setJoinScreen(false)
    setPrompt(null)
    setCoopStatus(status ?? makeConnectingStatus(room))
    coopSessionRef.current?.dispose()
    const next = new RemoteSession(gameServerUrl(), name, room)
    coopSessionRef.current = next
    setCoopSession(next)
  }, [])

  const leaveCoop = useCallback(() => {
    coopSessionRef.current?.dispose()
    coopSessionRef.current = null
    setCoopSession(null)
    setCoopStatus(null)
    setJoinScreen(false)
    setPrompt(null)
  }, [])

  const startCoopFromLobby = useCallback((room: string | null, name: string) => {
    beginCoop(room, name)
  }, [beginCoop])

  const rejoinWithNewName = useCallback((room: string | null, name: string) => {
    const current = coopStatus
    beginCoop(room, name, current ? { ...current, phase: 'connecting', error: null } : undefined)
  }, [beginCoop, coopStatus])

  const openCreate = useCallback(() => {
    if (playerName) {
      beginCoop(null, playerName)
      return
    }
    setJoinScreen(false)
    setPrompt({ kind: 'create', back: 'solo' })
  }, [beginCoop, playerName])

  const openJoin = useCallback(() => {
    setJoinCode(joinCode ?? inviteRoom)
    setJoinScreen(true)
    setPrompt(null)
  }, [inviteRoom, joinCode])

  const openRenameFromJoin = useCallback(() => {
    setJoinScreen(true)
    setPrompt({ kind: 'join', room: joinCode ?? inviteRoom, mode: 'return', back: 'join-code' })
  }, [inviteRoom, joinCode])

  const openRenameFromLobby = useCallback(() => {
    setJoinScreen(false)
    setPrompt({ kind: 'join', room: coopStatus?.room ?? null, mode: 'rejoin', back: 'lobby' })
  }, [coopStatus?.room])

  const submitName = useCallback((name: string) => {
    if (!prompt) return
    const clean = rememberName(name)
    setPlayerName(clean)

    if (prompt.kind === 'create') {
      beginCoop(null, clean)
      return
    }

    if (prompt.mode === 'return') {
      if (prompt.room) setJoinCode(prompt.room)
      setJoinScreen(true)
      setPrompt(null)
      return
    }

    if (prompt.mode === 'rejoin') {
      rejoinWithNewName(prompt.room ?? coopStatus?.room ?? null, clean)
      return
    }

    startCoopFromLobby(prompt.room, clean)
  }, [beginCoop, coopStatus?.room, prompt, rejoinWithNewName, startCoopFromLobby])

  const cancelName = useCallback(() => {
    if (!prompt) return
    if (prompt.kind === 'join' && prompt.mode === 'rejoin') {
      setPrompt(null)
      return
    }
    setJoinScreen(prompt.kind === 'join' && prompt.back === 'join-code')
    setPrompt(null)
  }, [prompt])

  const submitJoin = useCallback((room: string) => {
    const cleanRoom = normalizeRoomCode(room)
    if (!cleanRoom) return
    setJoinCode(cleanRoom)
    if (playerName) {
      beginCoop(cleanRoom, playerName)
      return
    }
    setJoinScreen(false)
    setPrompt({ kind: 'join', room: cleanRoom, mode: 'start', back: 'join-code' })
  }, [beginCoop, playerName])

  const cancelJoin = useCallback(() => {
    setJoinScreen(false)
    setPrompt(null)
  }, [])

  const completeNoop = useCallback((_state: GameState) => {}, [])
  const canPlayCoop = coopSession !== null && coopStatus !== null
  const showRun = canPlayCoop && (coopStatus.phase === 'running' || coopStatus.phase === 'complete')

  if (prompt) {
    if (prompt.kind === 'create') {
      return (
        <NamePrompt
          intent="create"
          room={null}
          cap={ROOM_CAP}
          onSubmit={submitName}
          onCancel={cancelName}
        />
      )
    }

    return (
      <NamePrompt
        intent="join"
        room={prompt.room}
        cap={ROOM_CAP}
        onSubmit={submitName}
        onCancel={cancelName}
      />
    )
  }

  if (!showRun && canPlayCoop) {
    return (
      <CoopLobby
        status={coopStatus}
        name={playerName || 'Hunter'}
        onReady={(value) => coopSessionRef.current?.setReady(value)}
        onStart={() => coopSessionRef.current?.start()}
        onRename={openRenameFromLobby}
        onLeave={leaveCoop}
      />
    )
  }

  if (showRun) {
    return (
      <Hunt
        settings={settings}
        best={best}
        storageWarning={storageWarning}
        setSettings={setSettings}
        onComplete={completeNoop}
        session={coopSession ?? undefined}
        coop={coopStatus}
        onLeaveCoop={leaveCoop}
      />
    )
  }

  if (joinScreen) {
    return (
      <JoinRoom
        name={playerName || 'Hunter'}
        initialCode={joinCode}
        onJoin={submitJoin}
        onRename={openRenameFromJoin}
        onCancel={cancelJoin}
      />
    )
  }

  return (
    <Hunt
      settings={settings}
      best={best}
      storageWarning={storageWarning}
      setSettings={setSettings}
      onComplete={recordResult}
      session={soloSession}
      onCreateRoom={openCreate}
      onJoinRoom={openJoin}
    />
  )
}
