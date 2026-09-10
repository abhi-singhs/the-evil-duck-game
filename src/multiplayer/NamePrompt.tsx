import { useState } from 'react'
import { MAX_NAME_LENGTH, savedName } from './name'

export type NameIntent = 'create' | 'join'

type Props = {
  intent: NameIntent
  /** The code from an invite link, so the prompt can say which room you are heading for. */
  room: string | null
  cap: number
  onSubmit: (name: string) => void
  onCancel: () => void
}

/** The first step of co-op. Your teammates need something to call you before anything else. */
export function NamePrompt({ intent, room, cap, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(savedName)
  const trimmed = name.trim()

  return (
    <form className="coop-panel" onSubmit={(event) => { event.preventDefault(); onSubmit(trimmed) }}>
      <h2>What should we call you?</h2>
      <p className="coop-lede">
        {room
          ? `You were invited to room ${room}. Up to ${cap} hunters, one duck.`
          : intent === 'create'
            ? `Your name goes on the scoreboard the other ${cap - 1} hunters can see.`
            : `Your name goes on the scoreboard the rest of the room can see.`}
      </p>
      <label className="field">
        <span>Your name</span>
        <input value={name} maxLength={MAX_NAME_LENGTH} placeholder="Hunter" autoComplete="nickname"
          autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <button className="primary-button" type="submit">
        {room ? `JOIN ${room}` : intent === 'create' ? 'CREATE THE ROOM' : 'CONTINUE'}
      </button>
      <button className="link-button" type="button" onClick={onCancel}>Back to solo</button>
    </form>
  )
}
