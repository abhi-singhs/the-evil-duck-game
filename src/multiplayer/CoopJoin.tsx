import { useState } from 'react'
import { ROOM_CODE_LENGTH, normalizeRoomCode } from '../net/protocol'

const NAME_KEY = 'evil-duck-name'

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Nothing here is worth failing a join over.
  }
}

type Props = {
  cap: number
  initialCode: string | null
  onJoin: (name: string, room: string | null) => void
  onCancel: () => void
}

/** The screen that turns a name and an optional code into a live connection. */
export function CoopJoin({ cap, initialCode, onJoin, onCancel }: Props) {
  const [name, setName] = useState(savedName)
  const [code, setCode] = useState(initialCode ?? '')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (room: string | null) => {
    const trimmed = name.trim() || 'Hunter'
    if (room !== null && normalizeRoomCode(room) === null) {
      setProblem(`A join code is ${ROOM_CODE_LENGTH} characters, like ${'ABCD'.slice(0, ROOM_CODE_LENGTH)}.`)
      return
    }
    rememberName(trimmed)
    onJoin(trimmed, room === null ? null : normalizeRoomCode(room))
  }

  return (
    <div className="coop-panel">
      <h2>Hunt together</h2>
      <p className="coop-lede">Up to {cap} players, one duck, one server holding the clock.</p>
      <label className="field">
        <span>Your name</span>
        <input value={name} maxLength={16} placeholder="Hunter" autoComplete="nickname"
          onChange={(event) => setName(event.target.value)} />
      </label>
      <button className="primary-button" onClick={() => submit(null)}>START A ROOM</button>
      <div className="coop-divider"><span>or join one</span></div>
      <form className="coop-code" onSubmit={(event) => { event.preventDefault(); submit(code) }}>
        <label className="field">
          <span>Join code</span>
          <input value={code} maxLength={ROOM_CODE_LENGTH} placeholder="ABCD" autoCapitalize="characters"
            spellCheck={false} onChange={(event) => { setCode(event.target.value.toUpperCase()); setProblem(null) }} />
        </label>
        <button className="secondary-button" type="submit" disabled={!code.trim()}>JOIN</button>
      </form>
      {problem && <p className="coop-problem" role="alert">{problem}</p>}
      <button className="link-button" onClick={onCancel}>Back to solo</button>
    </div>
  )
}
