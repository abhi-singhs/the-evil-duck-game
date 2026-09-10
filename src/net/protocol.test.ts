import { describe, expect, it } from 'vitest'
import { WORLD } from '../game/config'
import type { GameEvent } from '../game/types'
import {
  MAX_MESSAGE_BYTES, MAX_NAME_LENGTH, ROOM_CAP, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
  filterEvents, normalizeName, normalizeRoomCode, parseClientMessage, roomCode,
} from './protocol'

const command = (patch: Record<string, unknown> = {}) => JSON.stringify({
  t: 'cmd', sequence: 4, aim: { x: 10, y: 20 }, trigger: true, weapon: 'pistol', ...patch,
})

describe('client message validation', () => {
  it('accepts a well formed command', () => {
    expect(parseClientMessage(command())).toEqual({
      t: 'cmd', sequence: 4, aim: { x: 10, y: 20 }, trigger: true, weapon: 'pistol',
    })
  })

  it('clamps aim into the playfield rather than trusting it', () => {
    const parsed = parseClientMessage(command({ aim: { x: 99_999, y: -400 } }))
    expect(parsed).toEqual({
      t: 'cmd', sequence: 4, aim: { x: WORLD.width, y: 0 }, trigger: true, weapon: 'pistol',
    })
  })

  it.each([
    ['a weapon that does not exist', command({ weapon: 'railgun' })],
    ['a fractional sequence', command({ sequence: 1.5 })],
    ['a negative sequence', command({ sequence: -1 })],
    ['a non-finite aim', command({ aim: { x: null, y: 3 } })],
    ['a missing aim', command({ aim: undefined })],
    ['a trigger that is not a boolean', command({ trigger: 'yes' })],
    ['an unknown message type', JSON.stringify({ t: 'nuke' })],
    ['a bare array', JSON.stringify([1, 2, 3])],
    ['text that is not JSON', 'not json at all'],
    ['a non-string payload', { t: 'cmd' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseClientMessage(payload)).toBeNull()
  })

  it('rejects anything larger than the message cap', () => {
    const padded = JSON.stringify({ t: 'join', room: null, name: 'x'.repeat(MAX_MESSAGE_BYTES) })
    expect(padded.length).toBeGreaterThan(MAX_MESSAGE_BYTES)
    expect(parseClientMessage(padded)).toBeNull()
  })

  it('treats a missing room as a request for a new one', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'join', name: 'Ada' })))
      .toEqual({ t: 'join', room: null, name: 'Ada', token: null })
  })

  it('rejects a join carrying a malformed code', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'join', room: 'nope!', name: 'Ada' }))).toBeNull()
  })

  it('ignores a token that is not a plausible token', () => {
    const parsed = parseClientMessage(JSON.stringify({ t: 'join', room: null, name: 'Ada', token: '../etc' }))
    expect(parsed).toMatchObject({ token: null })
  })
})

describe('names', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(normalizeName('  Ada\u0000\u0007  Lovelace\n ')).toBe('Ada Lovelace')
  })

  it('caps length and falls back when nothing usable is left', () => {
    expect(normalizeName('x'.repeat(80))).toHaveLength(MAX_NAME_LENGTH)
    expect(normalizeName('   ')).toBe('Hunter')
    expect(normalizeName(42)).toBe('Hunter')
  })
})

describe('room codes', () => {
  it('normalizes case and whitespace', () => {
    const code = roomCode(() => 0.5)
    expect(normalizeRoomCode(` ${code.toLowerCase()} `)).toBe(code)
  })

  it('rejects wrong lengths and ambiguous characters', () => {
    expect(normalizeRoomCode('ABC')).toBeNull()
    expect(normalizeRoomCode('ABCDE')).toBeNull()
    expect(normalizeRoomCode('AB!D')).toBeNull()
    expect(normalizeRoomCode(null)).toBeNull()
  })

  it('only generates codes it will accept', () => {
    for (let i = 0; i < 200; i++) {
      const code = roomCode()
      expect(code).toHaveLength(ROOM_CODE_LENGTH)
      expect(normalizeRoomCode(code)).toBe(code)
      for (const character of code) expect(ROOM_CODE_ALPHABET).toContain(character)
    }
  })
})

describe('event filtering', () => {
  const events: GameEvent[] = [
    { type: 'shot', playerId: 'p1', weapon: 'pistol', aim: { x: 1, y: 1 }, hit: true },
    { type: 'shot', playerId: 'p2', weapon: 'pistol', aim: { x: 2, y: 2 }, hit: true },
    { type: 'hurt', playerId: 'p2', position: { x: 3, y: 3 }, hp: 4 },
    { type: 'phase', phase: 2 },
    { type: 'end', won: true },
  ]

  it('keeps your own events and the ones the whole room shares', () => {
    expect(filterEvents(events, 'p1')).toEqual([events[0], events[2], events[3], events[4]])
  })

  it('drops other players\' muzzle flashes, which the crosshairs already imply', () => {
    expect(filterEvents(events, 'p1').some((event) =>
      event.type === 'shot' && event.playerId === 'p2')).toBe(false)
  })

  it('caps how many of other players\' effects ride along in one batch', () => {
    const flood: GameEvent[] = Array.from({ length: 40 }, (_, index) => ({
      type: 'explosion', position: { x: index, y: index },
    }))
    expect(filterEvents(flood, 'p1', 3)).toHaveLength(3)
  })
})

describe('room capacity', () => {
  it('is the number the interface promises', () => {
    expect(ROOM_CAP).toBe(50)
  })
})
