import { randomUUID } from 'node:crypto'
import {
  MAX_ROOMS, ROOM_CAP, ROSTER_EVERY, SNAPSHOT_HZ, STEP, WEAPON_ORDER,
  activePlayers, applyCommand, clearTriggers, createGame, removePlayer, roomCode, setConnected,
  stepGame,
} from './core/game-core.mjs'

const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(1 / STEP / SNAPSHOT_HZ))
/** A finished run stays on screen this long before the room drops back to the lobby. */
const RESULT_SECONDS = 12
/** Empty rooms are swept rather than left to accumulate join codes. */
const EMPTY_ROOM_SECONDS = 60

/**
 * Full precision is expensive in JSON: a cooldown of 0.29999999999999993 is twenty bytes, and at
 * twenty snapshots a second across fifty players that adds up faster than the gameplay data does.
 */
const round = (value, places) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function trimPlayer(player) {
  if (!player) return null
  return {
    ...player,
    aim: { x: round(player.aim.x, 1), y: round(player.aim.y, 1) },
    heat: round(player.heat, 1),
    cooldowns: {
      pistol: round(player.cooldowns.pistol, 3),
      shotgun: round(player.cooldowns.shotgun, 3),
      blaster: round(player.cooldowns.blaster, 3),
      rocket: round(player.cooldowns.rocket, 3),
    },
  }
}

/**
 * One room is one authoritative fight. The container runs a single replica precisely so that every
 * socket holding a given code reaches this same object, and therefore the same duck.
 */
export class Room {
  constructor(code, options = {}) {
    this.code = code
    this.members = new Map()
    this.nextId = 0
    this.hostId = null
    this.status = 'lobby'
    this.state = null
    this.accumulator = 0
    this.tickBudget = 0
    this.snapshotCount = 0
    this.rosterDue = false
    this.resultTimer = 0
    this.emptySince = null
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? Math.random
  }

  get size() {
    return this.members.size
  }

  get open() {
    return this.members.size < ROOM_CAP
  }

  member(id) {
    return this.members.get(id) ?? null
  }

  /**
   * Joins are lobby-only by design: latecomers hold a seat and watch the next-round screen rather
   * than dropping into a fight whose balance was already settled.
   */
  join(name, options = {}) {
    const token = options.token
    if (token) {
      const existing = [...this.members.values()].find((member) => member.token === token)
      if (existing) {
        existing.connected = true
        existing.name = name
        existing.lastSeen = this.now()
        this.emptySince = null
        if (this.state) setConnected(this.state, existing.id, true)
        this.electHost()
        return { member: existing, rejoined: true }
      }
    }
    if (!this.open) return { error: 'room-full' }
    const member = {
      // Short ids, because every one of them rides in every snapshot. Fifty UUIDs would be
      // 1.8 KB of pure identifier twenty times a second.
      id: `p${this.nextId++}`,
      token: randomUUID().replaceAll('-', ''),
      name,
      ready: false,
      connected: true,
      // Seats are assigned when a run starts. Arriving mid-fight means waiting for the next one.
      waiting: this.status !== 'lobby',
      lastSeen: this.now(),
      commandWindow: { start: this.now(), count: 0 },
      send: null,
      events: [],
    }
    this.members.set(member.id, member)
    this.emptySince = null
    this.electHost()
    return { member, rejoined: false }
  }

  disconnect(id) {
    const member = this.members.get(id)
    if (!member) return
    member.connected = false
    member.ready = false
    member.send = null
    if (this.state) setConnected(this.state, id, false)
    // Between runs there is no seat worth keeping, so a disconnect frees the slot immediately.
    if (this.status !== 'running' || member.waiting) this.remove(id)
    else if (![...this.members.values()].some((other) => other.connected)) this.emptySince = this.now()
    this.electHost()
  }

  remove(id) {
    this.members.delete(id)
    if (this.state) removePlayer(this.state, id)
    if (!this.members.size) this.emptySince = this.now()
    this.electHost()
  }

  /** The host is simply the longest-standing connected member, so the room never loses its start button. */
  electHost() {
    const eligible = [...this.members.values()].filter((member) => member.connected && !member.waiting)
    if (this.hostId && eligible.some((member) => member.id === this.hostId)) return
    this.hostId = eligible[0]?.id ?? null
  }

  setReady(id, value) {
    const member = this.members.get(id)
    if (!member || member.waiting) return false
    member.ready = value
    return true
  }

  start(id) {
    if (id !== this.hostId) return { error: 'not-host' }
    if (this.status === 'running') return { error: null, started: false }
    const roster = [...this.members.values()].filter((member) => member.connected)
    if (!roster.length) return { error: null, started: false }
    const seed = Math.floor(this.random() * 1_000_000)
    this.state = createGame(seed, roster.map((member) => member.id), true)
    for (const member of roster) {
      this.state.players[member.id].name = member.name
      member.waiting = false
      member.ready = false
    }
    this.state.status = 'running'
    this.status = 'running'
    this.accumulator = 0
    this.snapshotCount = 0
    this.resultTimer = 0
    return { error: null, started: true }
  }

  command(id, message) {
    const member = this.members.get(id)
    if (!member || !this.state || this.status !== 'running' || member.waiting) return false
    return applyCommand(this.state, {
      playerId: id,
      sequence: message.sequence,
      aim: message.aim,
      trigger: message.trigger,
      weapon: message.weapon,
    })
  }

  /**
   * Advances the fight by real elapsed time in fixed 60 Hz steps, and returns the events produced.
   * A long stall is capped rather than replayed, so a hiccup never fires a backlog of invisible shots.
   */
  advance(seconds) {
    if (this.status === 'complete') {
      this.resultTimer -= seconds
      if (this.resultTimer <= 0) this.reset()
      return []
    }
    if (this.status !== 'running' || !this.state) return []
    this.accumulator = Math.min(this.accumulator + seconds, 0.5)
    const events = []
    while (this.accumulator + 1e-9 >= STEP && this.state.status === 'running') {
      this.accumulator -= STEP
      this.tickBudget++
      events.push(...stepGame(this.state))
    }
    if (this.state.status !== 'running') {
      this.status = 'complete'
      this.resultTimer = RESULT_SECONDS
      clearTriggers(this.state)
      // Force the final frame out immediately: the result screen reads it.
      this.tickBudget = TICKS_PER_SNAPSHOT
    }
    return events
  }

  /** True on the ticks where clients should receive a snapshot, at 20 Hz against a 60 Hz loop. */
  shouldBroadcast() {
    if (this.tickBudget < TICKS_PER_SNAPSHOT) return false
    this.tickBudget = 0
    // Counted per room. A server-wide counter would tie one room's roster cadence to how many
    // other rooms happened to broadcast on the same tick.
    this.rosterDue = this.snapshotCount++ % ROSTER_EVERY === 0
    return true
  }

  reset() {
    this.status = 'lobby'
    this.state = null
    this.accumulator = 0
    this.resultTimer = 0
    for (const member of [...this.members.values()]) {
      if (!member.connected) this.members.delete(member.id)
      else {
        member.ready = false
        member.waiting = false
      }
    }
    if (!this.members.size) this.emptySince = this.now()
    this.electHost()
  }

  lobbyMessage() {
    return {
      t: 'lobby',
      status: this.status,
      hostId: this.hostId,
      members: [...this.members.values()].map((member) => ({
        id: member.id,
        name: member.name,
        ready: member.ready,
        connected: member.connected,
        waiting: member.waiting,
      })),
      waiting: false,
    }
  }

  /**
   * Each client gets the duck, the live threats, its own player in full, and one packed tuple per
   * teammate. Sending every player's full state at the loop rate costs tens of megabits per room;
   * `[id, x, y, firing]` is a few hundred bytes and still draws the whole swarm.
   */
  snapshotFor(id) {
    const state = this.state
    if (!state) return null
    const mates = []
    for (const player of Object.values(state.players)) {
      if (player.id === id) continue
      mates.push([player.id, Math.round(player.aim.x), Math.round(player.aim.y), player.trigger ? 1 : 0])
    }
    return {
      t: 'snapshot',
      run: {
        status: state.status,
        tick: state.tick,
        elapsed: round(state.elapsed, 2),
        duration: state.duration,
        duck: { ...state.duck, x: round(state.duck.x, 1), y: round(state.duck.y, 1) },
        threats: state.threats.map((threat) => ({
          ...threat,
          age: round(threat.age, 2),
          position: { x: round(threat.position.x, 1), y: round(threat.position.y, 1) },
        })),
        projectiles: state.projectiles.map((projectile) => ({
          ...projectile,
          position: { x: round(projectile.position.x, 1), y: round(projectile.position.y, 1) },
        })),
        teamDamage: state.teamDamage,
        players: Object.keys(state.players).length,
        alive: activePlayers(state).length,
      },
      you: trimPlayer(state.players[id]),
      mates,
    }
  }

  /** Health, damage, and weapon change slowly, so the scoreboard rides its own slower message. */
  rosterMessage(id) {
    const state = this.state
    if (!state) return null
    const mates = []
    for (const player of Object.values(state.players)) {
      if (player.id === id) continue
      mates.push([player.id, player.hp, player.damage, WEAPON_ORDER.indexOf(player.weapon)])
    }
    return { t: 'roster', mates }
  }

  /**
   * The whole room as plain JSON, for the HTTP endpoint. Snapshots are trimmed for bandwidth and
   * split across two messages; this is the readable version, and it covers members who are
   * disconnected or waiting out a run, who never appear in a snapshot at all.
   *
   * Score is damage dealt to the duck, which is what the in-game scoreboard ranks players by.
   * Members with no seat in the current run report null rather than zero, so a caller can tell
   * "has not played" apart from "has hit nothing".
   */
  stats() {
    const state = this.state
    return {
      room: this.code,
      status: this.status,
      hostId: this.hostId,
      cap: ROOM_CAP,
      members: this.members.size,
      run: state
        ? {
          status: state.status,
          elapsed: round(state.elapsed, 2),
          duration: state.duration,
          teamDamage: state.teamDamage,
          duck: { hp: state.duck.hp, maxHp: state.duck.maxHp, phase: state.duck.phase },
          alive: activePlayers(state).length,
        }
        : null,
      players: [...this.members.values()].map((member) => {
        const player = state?.players[member.id] ?? null
        return {
          id: member.id,
          name: member.name,
          host: member.id === this.hostId,
          connected: member.connected,
          ready: member.ready,
          waiting: member.waiting,
          score: player ? player.damage : null,
          hp: player ? player.hp : null,
          maxHp: player ? player.maxHp : null,
          alive: player ? player.connected && player.hp > 0 : null,
          shots: player ? player.shots : null,
          hits: player ? player.hits : null,
          accuracy: player?.shots ? round(player.hits / player.shots, 3) : null,
          blocked: player ? player.blocked : null,
          weapon: player ? player.weapon : null,
        }
      }),
    }
  }

  expired(idleSeconds = EMPTY_ROOM_SECONDS) {
    if (this.members.size && [...this.members.values()].some((member) => member.connected)) return false
    return this.emptySince !== null && this.now() - this.emptySince > idleSeconds * 1000
  }
}

export class RoomRegistry {
  constructor(options = {}) {
    this.rooms = new Map()
    this.options = options
    this.random = options.random ?? Math.random
  }

  get(code) {
    return this.rooms.get(code) ?? null
  }

  create() {
    if (this.rooms.size >= MAX_ROOMS) return { error: 'server-full' }
    let code = null
    for (let attempt = 0; attempt < 40 && code === null; attempt++) {
      const candidate = roomCode(this.random)
      if (!this.rooms.has(candidate)) code = candidate
    }
    if (code === null) return { error: 'server-full' }
    const room = new Room(code, this.options)
    this.rooms.set(code, room)
    return { room }
  }

  /** A null code means "give me a room", which is how the create button reaches the server. */
  resolve(code) {
    if (code === null) return this.create()
    const room = this.rooms.get(code)
    return room ? { room } : { error: 'no-room' }
  }

  sweep(idleSeconds) {
    for (const [code, room] of this.rooms) {
      if (room.expired(idleSeconds)) this.rooms.delete(code)
    }
  }
}
