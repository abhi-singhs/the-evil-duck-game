import { useState } from 'react'
import { ROOM_CODE_LENGTH, normalizeRoomCode } from '../net/protocol'

type Props = {
  name: string
  initialCode: string | null
  onJoin: (room: string) => void
  onRename: () => void
  onCancel: () => void
}

/** Code entry. Creating a room is a button of its own, so this screen only has one job. */
export function JoinRoom({ name, initialCode, onJoin, onRename, onCancel }: Props) {
  const [code, setCode] = useState(initialCode ?? '')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = () => {
    const room = normalizeRoomCode(code)
    if (!room) {
      setProblem(`A join code is ${ROOM_CODE_LENGTH} characters, like ABCD.`)
      return
    }
    onJoin(room)
  }

  return (
    <form className="coop-panel" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <h2>Join a room</h2>
      <p className="coop-lede">Ask the host for their four-character code, or open the link they sent you.</p>
      <label className="field">
        <span>Join code</span>
        <input value={code} maxLength={ROOM_CODE_LENGTH} placeholder="ABCD" autoCapitalize="characters"
          autoComplete="off" spellCheck={false} autoFocus
          onChange={(event) => { setCode(event.target.value.toUpperCase()); setProblem(null) }} />
      </label>
      <button className="primary-button" type="submit" disabled={!code.trim()}>JOIN</button>
      {problem && <p className="coop-problem" role="alert">{problem}</p>}
      <p className="coop-identity">
        Playing as <strong>{name}</strong>
        <button className="link-button" type="button" onClick={onRename}>Change</button>
      </p>
      <button className="link-button" type="button" onClick={onCancel}>Back to solo</button>
    </form>
  )
}
