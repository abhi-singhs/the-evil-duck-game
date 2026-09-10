import { WEAPON_ORDER, WORLD } from '../game/config'
import type { DuckState, GameEvent, PlayerState, Point, Projectile, RunStatus, Threat, WeaponId } from '../game/types'

/** One authoritative process owns a room, so the cap is a real limit rather than a hint. */
export const ROOM_CAP = 50
export const MAX_ROOMS = 24
export const MAX_NAME_LENGTH = 16
/** A join code the host can read out loud without spelling it twice. */
export const ROOM_CODE_LENGTH = 4
export const ROOM_CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'

export const SNAPSHOT_HZ = 20
export const COMMAND_HZ = 20
/** Commands above this rate are dropped: a client at 20 Hz has ample headroom. */
export const COMMAND_RATE_LIMIT = 45
export const MAX_MESSAGE_BYTES = 2048
export const PING_INTERVAL = 15_000
export const PING_TIMEOUT = 40_000

export type RoomStatus = 'lobby' | 'running' | 'complete'

export type LobbyMember = {
  id: string
  name: string
  ready: boolean
  connected: boolean
  /** True while a run this player did not join is still in progress. */
  waiting: boolean
}

/**
 * Aim moves every frame; health and damage barely move at all. Splitting them lets the frequent
 * message stay tiny: `[id, x, y, firing]` per teammate, twenty times a second.
 */
export type MateTuple = [string, number, number, 0 | 1]
/** The scoreboard half: `[id, hp, damage, weaponIndex]`, sent a few times a second. */
export type RosterTuple = [string, number, number, number]

/** How many snapshots pass between roster messages. */
export const ROSTER_EVERY = 5
/**
 * A room sends every player its own events in full. Other players' effects are decoration, so each
 * batch carries a handful of them rather than fifty players' worth of muzzle flashes.
 */
export const FOREIGN_EVENT_BUDGET = 8

export const eventOwner = (event: GameEvent): string | null =>
  'playerId' in event ? event.playerId : null

/** Phase changes and the end of the run are the same for everyone in the room. */
export const isBroadcastEvent = (event: GameEvent): boolean =>
  event.type === 'phase' || event.type === 'end'

/**
 * The only other players' events worth a client's bandwidth are the ones you can actually read
 * across the arena: a rocket going off, and a teammate taking an egg. Their muzzle flashes are
 * already implied by the crosshairs in every snapshot.
 */
const FOREIGN_TYPES = new Set(['explosion', 'hurt'])

export function filterEvents(
  events: GameEvent[], playerId: string, budget = FOREIGN_EVENT_BUDGET,
): GameEvent[] {
  const kept: GameEvent[] = []
  let foreign = 0
  for (const event of events) {
    if (isBroadcastEvent(event) || eventOwner(event) === playerId) kept.push(event)
    else if (FOREIGN_TYPES.has(event.type) && foreign < budget) {
      foreign++
      kept.push(event)
    }
  }
  return kept
}

export type RunView = {
  status: RunStatus
  tick: number
  elapsed: number
  duration: number
  duck: DuckState
  threats: Threat[]
  projectiles: Projectile[]
  teamDamage: number
  players: number
  alive: number
}

export type ClientMessage =
  | { t: 'join'; room: string | null; name: string; token: string | null }
  | { t: 'ready'; value: boolean }
  | { t: 'start' }
  | { t: 'leave' }
  | { t: 'cmd'; sequence: number; aim: Point; trigger: boolean; weapon: WeaponId }
  | { t: 'pong' }

export type ServerMessage =
  | { t: 'welcome'; playerId: string; room: string; cap: number; token: string; rejoined: boolean }
  | { t: 'lobby'; status: RoomStatus; hostId: string | null; members: LobbyMember[]; waiting: boolean }
  | { t: 'snapshot'; run: RunView; you: PlayerState | null; mates: MateTuple[] }
  | { t: 'roster'; mates: RosterTuple[] }
  | { t: 'events'; events: GameEvent[] }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'ping' }

export type ErrorCode =
  | 'bad-message' | 'room-full' | 'no-room' | 'server-full' | 'not-host' | 'rate-limit' | 'already-joined'

export const ERROR_TEXT: Record<ErrorCode, string> = {
  'bad-message': 'The server could not read that message.',
  'room-full': `That room already has ${ROOM_CAP} players.`,
  'no-room': 'No room with that code. Check it, or start a new room.',
  'server-full': 'The server is hosting as many rooms as it can. Try again shortly.',
  'not-host': 'Only the host can start the hunt.',
  'rate-limit': 'Too many messages. Slow down.',
  'already-joined': 'This connection already joined a room.',
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFinitePoint = (value: unknown): value is Point =>
  isObject(value) && typeof value.x === 'number' && typeof value.y === 'number'
  && Number.isFinite(value.x) && Number.isFinite(value.y)

export function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  if (code.length !== ROOM_CODE_LENGTH) return null
  for (const character of code) if (!ROOM_CODE_ALPHABET.includes(character)) return null
  return code
}

/** Names are display text from strangers, so strip control characters before anything renders them. */
export function normalizeName(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  let cleaned = ''
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0
    cleaned += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : character
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) || 'Hunter'
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(value)) return null
  switch (value.t) {
    case 'join': {
      const missing = value.room === null || value.room === undefined
      const room = missing ? null : normalizeRoomCode(value.room)
      if (!missing && room === null) return null
      const token = typeof value.token === 'string' && /^[a-z0-9]{8,64}$/i.test(value.token)
        ? value.token
        : null
      return { t: 'join', room, name: normalizeName(value.name), token }
    }
    case 'ready':
      return typeof value.value === 'boolean' ? { t: 'ready', value: value.value } : null
    case 'start':
      return { t: 'start' }
    case 'leave':
      return { t: 'leave' }
    case 'pong':
      return { t: 'pong' }
    case 'cmd': {
      const sequence = value.sequence
      if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) return null
      if (!isFinitePoint(value.aim) || typeof value.trigger !== 'boolean') return null
      if (!WEAPON_ORDER.includes(value.weapon as WeaponId)) return null
      return {
        t: 'cmd',
        sequence: sequence as number,
        aim: {
          x: Math.min(WORLD.width, Math.max(0, value.aim.x)),
          y: Math.min(WORLD.height, Math.max(0, value.aim.y)),
        },
        trigger: value.trigger,
        weapon: value.weapon as WeaponId,
      }
    }
    default:
      return null
  }
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string' || raw.length > 1_000_000) return null
  try {
    const value = JSON.parse(raw)
    return isObject(value) && typeof value.t === 'string' ? value as unknown as ServerMessage : null
  } catch {
    return null
  }
}

export function roomCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)]
  }
  return code
}
