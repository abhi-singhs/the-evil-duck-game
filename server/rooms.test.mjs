import { beforeEach, describe, expect, it } from 'vitest'
import { ROOM_CAP, ROSTER_EVERY } from './core/game-core.mjs'
import { Room, RoomRegistry } from './rooms.mjs'

/**
 * These exercise the compiled game core, so `npm run build:core` has to have run. The build script
 * and `npm test` both depend on it, and importing it here keeps the failure obvious if it has not.
 */
let clock = 1_000_000
const now = () => clock

function makeRoom() {
  return new Room('TEST', { now, random: () => 0.5 })
}

function fill(room, count) {
  return Array.from({ length: count }, (_, index) => room.join(`Bot ${index}`))
}

beforeEach(() => { clock = 1_000_000 })

describe('joining a room', () => {
  it('accepts exactly fifty players and refuses the next one', () => {
    const room = makeRoom()
    const joined = fill(room, ROOM_CAP)
    expect(joined.every((result) => result.member)).toBe(true)
    expect(room.size).toBe(ROOM_CAP)
    expect(room.open).toBe(false)
    expect(room.join('Latecomer')).toEqual({ error: 'room-full' })
  })

  it('gives every member a short id, because every id rides in every snapshot', () => {
    const room = makeRoom()
    const ids = fill(room, 3).map((result) => result.member.id)
    expect(ids).toEqual(['p0', 'p1', 'p2'])
  })

  it('makes the first connected member the host', () => {
    const room = makeRoom()
    const [first, second] = fill(room, 2)
    expect(room.hostId).toBe(first.member.id)
    expect(room.hostId).not.toBe(second.member.id)
  })

  it('hands the host role on when the host leaves', () => {
    const room = makeRoom()
    const [first, second] = fill(room, 2)
    room.disconnect(first.member.id)
    expect(room.hostId).toBe(second.member.id)
  })

  it('parks a player who arrives mid-run until the next round', () => {
    const room = makeRoom()
    const [host] = fill(room, 1)
    room.start(host.member.id)
    const late = room.join('Latecomer')
    expect(late.member.waiting).toBe(true)
    expect(room.state.players[late.member.id]).toBeUndefined()
  })

  it('seats a waiting player once the room resets', () => {
    const room = makeRoom()
    const [host] = fill(room, 1)
    room.start(host.member.id)
    const late = room.join('Latecomer')
    room.state.duck.hp = 0
    room.state.status = 'won'
    room.status = 'complete'
    room.resultTimer = 0.1
    room.advance(1)
    expect(room.status).toBe('lobby')
    expect(room.member(late.member.id).waiting).toBe(false)
  })
})

describe('starting a run', () => {
  it('refuses anyone who is not the host', () => {
    const room = makeRoom()
    const [, second] = fill(room, 2)
    expect(room.start(second.member.id)).toEqual({ error: 'not-host' })
    expect(room.status).toBe('lobby')
  })

  it('seats every connected member and runs the fight in co-op mode', () => {
    const room = makeRoom()
    const members = fill(room, 4)
    room.start(members[0].member.id)
    expect(room.status).toBe('running')
    expect(room.state.coop).toBe(true)
    expect(Object.keys(room.state.players)).toHaveLength(4)
  })

  it('is a no-op when the run is already going', () => {
    const room = makeRoom()
    const [host] = fill(room, 1)
    room.start(host.member.id)
    const tick = room.state.tick
    expect(room.start(host.member.id)).toEqual({ error: null, started: false })
    expect(room.state.tick).toBe(tick)
  })
})

describe('commands', () => {
  it('never lets a client name someone else as the source', () => {
    const room = makeRoom()
    const [alice, bob] = fill(room, 2)
    room.start(alice.member.id)
    room.command(alice.member.id, {
      sequence: 1, aim: { x: 100, y: 100 }, trigger: true, weapon: 'pistol',
    })
    expect(room.state.players[alice.member.id].trigger).toBe(true)
    expect(room.state.players[bob.member.id].trigger).toBe(false)
  })

  it('ignores a replayed or stale sequence', () => {
    const room = makeRoom()
    const [alice] = fill(room, 1)
    room.start(alice.member.id)
    const command = { sequence: 5, aim: { x: 10, y: 10 }, trigger: true, weapon: 'pistol' }
    expect(room.command(alice.member.id, command)).toBe(true)
    expect(room.command(alice.member.id, command)).toBe(false)
    expect(room.command(alice.member.id, { ...command, sequence: 4 })).toBe(false)
  })

  it('refuses a weapon the player has not unlocked', () => {
    const room = makeRoom()
    const [alice] = fill(room, 1)
    room.start(alice.member.id)
    const accepted = room.command(alice.member.id, {
      sequence: 1, aim: { x: 10, y: 10 }, trigger: true, weapon: 'rocket',
    })
    expect(accepted).toBe(false)
  })
})

describe('disconnects', () => {
  it('frees the seat immediately in the lobby', () => {
    const room = makeRoom()
    const [alice] = fill(room, 2)
    room.disconnect(alice.member.id)
    expect(room.size).toBe(1)
  })

  it('keeps the seat during a run so a reconnect finds its damage and lives', () => {
    const room = makeRoom()
    const [alice, bob] = fill(room, 2)
    room.start(alice.member.id)
    room.state.players[alice.member.id].damage = 900
    room.state.players[alice.member.id].hp = 2
    room.disconnect(alice.member.id)
    expect(room.size).toBe(2)
    expect(room.state.players[alice.member.id].connected).toBe(false)
    expect(room.hostId).toBe(bob.member.id)

    const back = room.join('Alice again', { token: alice.member.token })
    expect(back.rejoined).toBe(true)
    expect(back.member.id).toBe(alice.member.id)
    expect(room.state.players[alice.member.id].connected).toBe(true)
    expect(room.state.players[alice.member.id].damage).toBe(900)
    expect(room.state.players[alice.member.id].hp).toBe(2)
  })

  it('ends a run once the last connection goes', () => {
    const room = makeRoom()
    const [alice, bob] = fill(room, 2)
    room.start(alice.member.id)
    room.disconnect(alice.member.id)
    expect(room.state.status).toBe('running')
    room.disconnect(bob.member.id)
    expect(room.state.status).toBe('lost')
  })

  it('does not let a stranger claim a seat with a wrong token', () => {
    const room = makeRoom()
    const [alice] = fill(room, 1)
    room.start(alice.member.id)
    room.disconnect(alice.member.id)
    const result = room.join('Impostor', { token: 'ffffffffffffffffffffffffffffffff' })
    expect(result.rejoined).toBe(false)
    expect(result.member.id).not.toBe(alice.member.id)
  })
})

describe('snapshots', () => {
  it('sends each client its own player in full and everyone else packed', () => {
    const room = makeRoom()
    const members = fill(room, 3)
    room.start(members[0].member.id)
    const snapshot = room.snapshotFor(members[0].member.id)
    expect(snapshot.you.id).toBe(members[0].member.id)
    expect(snapshot.mates).toHaveLength(2)
    for (const mate of snapshot.mates) {
      expect(mate).toHaveLength(4)
      expect(mate[0]).not.toBe(members[0].member.id)
    }
  })

  it('stays small enough for a full room to be worth broadcasting', () => {
    const room = makeRoom()
    const members = fill(room, ROOM_CAP)
    room.start(members[0].member.id)
    const bytes = JSON.stringify(room.snapshotFor(members[0].member.id)).length
    expect(bytes).toBeLessThan(3000)
  })

  it('carries health and damage on the slower roster message', () => {
    const room = makeRoom()
    const members = fill(room, 2)
    room.start(members[0].member.id)
    room.state.players[members[1].member.id].damage = 1234
    const roster = room.rosterMessage(members[0].member.id)
    expect(roster.mates).toEqual([[members[1].member.id, 5, 1234, 0]])
  })
})

describe('the registry', () => {
  it('sends a roster on a cadence of its own, not one shared with other rooms', () => {
    const registry = new RoomRegistry({ now })
    // Five rooms against a roster interval of five is the case a shared counter gets exactly wrong:
    // one room would take every roster and the other four would never see one.
    const rooms = Array.from({ length: ROSTER_EVERY }, () => registry.create().room)
    for (const room of rooms) {
      const [host] = fill(room, 2)
      room.start(host.member.id)
    }
    const due = rooms.map(() => 0)
    for (let tick = 0; tick < 120; tick++) {
      rooms.forEach((room, index) => {
        room.advance(1 / 60)
        if (room.shouldBroadcast() && room.rosterDue) due[index]++
      })
    }
    expect(due[0]).toBeGreaterThan(3)
    expect(new Set(due).size).toBe(1)
  })

  it('creates a room on request and finds it by code', () => {
    const registry = new RoomRegistry({ now })
    const { room } = registry.create()
    expect(registry.resolve(room.code).room).toBe(room)
  })

  it('reports a missing code rather than inventing a room', () => {
    const registry = new RoomRegistry({ now })
    expect(registry.resolve('ZZZZ')).toEqual({ error: 'no-room' })
  })

  it('refuses to host more rooms than it can run', () => {
    const registry = new RoomRegistry({ now })
    let last = null
    for (let i = 0; i < 200; i++) {
      last = registry.create()
      if (last.error) break
    }
    expect(last.error).toBe('server-full')
  })

  it('sweeps rooms nobody came back to', () => {
    const registry = new RoomRegistry({ now })
    const { room } = registry.create()
    const [alice] = fill(room, 1)
    room.disconnect(alice.member.id)
    registry.sweep(60)
    expect(registry.get(room.code)).toBe(room)
    clock += 61_000
    registry.sweep(60)
    expect(registry.get(room.code)).toBeNull()
  })
})

describe('the room scoreboard', () => {
  it('reports nulls in the lobby, because there is nothing to score yet', () => {
    const room = makeRoom()
    fill(room, 2)
    const stats = room.stats()
    expect(stats).toMatchObject({ room: 'TEST', status: 'lobby', members: 2, run: null })
    expect(stats.players[0]).toMatchObject({ id: 'p0', host: true, score: null, hp: null, alive: null })
  })

  it('reports damage as score, with health, shots, and accuracy', () => {
    const room = makeRoom()
    const [host] = fill(room, 2)
    room.start(host.member.id)
    const player = room.state.players.p0
    player.damage = 300
    player.shots = 8
    player.hits = 6
    player.hp = 2

    const stats = room.stats()
    expect(stats.run).toMatchObject({ status: 'running', duration: room.state.duration, alive: 2 })
    expect(stats.players[0]).toMatchObject({
      score: 300, hp: 2, maxHp: player.maxHp, alive: true, shots: 8, hits: 6, accuracy: 0.75,
    })
  })

  it('keeps listing a player who is waiting out a run they could not join', () => {
    const room = makeRoom()
    const [host] = fill(room, 1)
    room.start(host.member.id)
    const late = room.join('Latecomer')
    const stats = room.stats()
    expect(stats.players).toHaveLength(2)
    expect(stats.players[1]).toMatchObject({ id: late.member.id, waiting: true, score: null, hp: null })
  })

  it('holds the final numbers on the result screen, until the room resets', () => {
    const room = makeRoom()
    const [host] = fill(room, 1)
    room.start(host.member.id)
    room.state.players.p0.damage = 1234
    room.state.status = 'won'
    room.advance(0.02)
    expect(room.status).toBe('complete')
    expect(room.stats().players[0].score).toBe(1234)
    room.advance(999)
    expect(room.stats()).toMatchObject({ status: 'lobby', run: null })
  })
})
