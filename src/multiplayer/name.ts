import { MAX_NAME_LENGTH, normalizeName } from '../net/protocol'

const NAME_KEY = 'evil-duck-name'

/**
 * The name is asked once and kept, so the second visit goes straight from the button to the room.
 * It is normalized on the way in with the same function the server applies, so what you type is
 * what your teammates see.
 */
export function savedName(): string {
  try {
    const stored = localStorage.getItem(NAME_KEY)
    return stored ? normalizeName(stored) : ''
  } catch {
    return ''
  }
}

export function rememberName(name: string): string {
  const clean = normalizeName(name)
  try {
    localStorage.setItem(NAME_KEY, clean)
  } catch {
    // A browser refusing storage costs you the prompt next time, nothing more.
  }
  return clean
}

export { MAX_NAME_LENGTH }
