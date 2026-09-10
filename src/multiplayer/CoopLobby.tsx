import { useState } from 'react'
import type { CoopStatus } from '../net/RemoteSession'

type Props = {
  status: CoopStatus
  name: string
  onReady: (value: boolean) => void
  onStart: () => void
  onRename: () => void
  onLeave: () => void
}

function shareLink(room: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', room)
  url.hash = ''
  return url.toString()
}

/** The room between runs: who is here, who is ready, and the one button that starts the hunt. */
export function CoopLobby({ status, name, onReady, onStart, onRename, onLeave }: Props) {
  const [copied, setCopied] = useState(false)
  const me = status.members.find((member) => member.id === status.playerId)
  const host = status.hostId === status.playerId
  const present = status.members.filter((member) => member.connected)
  const ready = present.filter((member) => member.ready).length

  const copy = async () => {
    if (!status.room) return
    try {
      await navigator.clipboard.writeText(shareLink(status.room))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (status.phase === 'error') {
    return (
      <div className="coop-panel">
        <h2>Cannot join</h2>
        <p className="coop-problem" role="alert">{status.error}</p>
        <button className="primary-button" onClick={onLeave}>BACK</button>
      </div>
    )
  }

  if (status.phase === 'connecting' && !status.room) {
    return (
      <div className="coop-panel">
        <h2>Connecting</h2>
        <p className="coop-lede">Finding the duck.</p>
        <button className="link-button" onClick={onLeave}>Cancel</button>
      </div>
    )
  }

  if (status.waiting) {
    return (
      <div className="coop-panel">
        <h2>Next round</h2>
        <p className="coop-lede">
          A hunt is already running in room {status.room}. You are in the queue and join the moment it ends.
        </p>
        <p className="coop-count">{present.length} of {status.cap} in the room</p>
        <button className="link-button" onClick={onLeave}>Leave room</button>
      </div>
    )
  }

  return (
    <div className="coop-panel coop-lobby">
      <h2>Room {status.room}</h2>
      <div className="coop-share">
        <code>{status.room}</code>
        <button className="secondary-button" onClick={copy}>{copied ? 'COPIED' : 'COPY LINK'}</button>
      </div>
      <p className="coop-count">
        {present.length} of {status.cap} here, {ready} ready
        {status.phase === 'connecting' && ' — reconnecting'}
      </p>
      <ul className="roster">
        {status.members.map((member) => (
          <li key={member.id} className={member.connected ? '' : 'gone'}>
            <span className={`dot ${member.ready ? 'on' : ''}`} aria-hidden="true" />
            <span className="roster-name">{member.name}</span>
            {member.id === status.hostId && <span className="tag">HOST</span>}
            {member.id === status.playerId && <span className="tag you">YOU</span>}
            {!member.connected && <span className="tag">AWAY</span>}
          </li>
        ))}
      </ul>
      <div className="coop-actions">
        <button className="secondary-button" aria-pressed={me?.ready ?? false}
          onClick={() => onReady(!(me?.ready ?? false))}>
          {me?.ready ? 'NOT READY' : 'READY'}
        </button>
        {host
          ? <button className="primary-button" onClick={onStart} disabled={!present.length}>START THE HUNT</button>
          : <p className="coop-lede">Waiting for the host to start.</p>}
      </div>
      {status.error && <p className="coop-problem" role="alert">{status.error}</p>}
      {present.length === 1 && (
        // Only offered while the room is yours alone, since taking a new name starts a new room.
        <p className="coop-identity">
          Playing as <strong>{name}</strong>
          <button className="link-button" type="button" onClick={onRename}>Change</button>
        </p>
      )}
      <button className="link-button" onClick={onLeave}>Leave room</button>
    </div>
  )
}
