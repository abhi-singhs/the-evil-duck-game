import { BOSS_HP, PLAYER_HP, RUN_DURATION, WEAPON_ORDER, WORLD } from '../game/config'
import type { GameSession } from '../game/session'
import type {
  DuckState, GameEvent, GameState, PlayerCommand, PlayerState, Projectile, Threat, WeaponId,
} from '../game/types'
import {
  COMMAND_HZ, ERROR_TEXT, ROOM_CAP, SNAPSHOT_HZ,
  parseServerMessage,
} from './protocol'
import type { LobbyMember, MateTuple, RunView, ServerMessage } from './protocol'

/**
 * Snapshots land at 20 Hz and the screen redraws at 60, so the client renders slightly in the past
 * and interpolates between the two frames that bracket that moment. Two snapshot intervals of slack
 * absorbs ordinary jitter without the duck ever visibly stepping.
 */
const INTERPOLATION_DELAY = 2000 / SNAPSHOT_HZ
const COMMAND_INTERVAL = 1000 / COMMAND_HZ
const RECONNECT_STEPS = [500, 1000, 2000, 4000, 8000]
const TOKEN_KEY = 'evil-duck-coop'

export type CoopPhase = 'connecting' | 'lobby' | 'running' | 'complete' | 'error' | 'closed'

export type CoopStatus = {
  phase: CoopPhase
  /** True from the moment a run starts until the room drops back to the lobby, reconnects included. */
  inRun: boolean
  room: string | null
  playerId: string | null
  hostId: string | null
  members: LobbyMember[]
  /** True when a run this player did not join is still in progress. */
  waiting: boolean
  error: string | null
  cap: number
  teamDamage: number
  alive: number
}

type Frame = { at: number; run: RunView; you: PlayerState | null; mates: MateTuple[] }

type MateStats = { hp: number; damage: number; weapon: WeaponId }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function gameServerUrl(): string {
  const override = import.meta.env.VITE_GAME_SERVER
  if (override) return override
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function blankPlayer(id: string, name: string): PlayerState {
  return {
    id, name, connected: true, sequence: 0,
    aim: { x: WORLD.width / 2, y: WORLD.height / 2 }, trigger: false, weapon: 'pistol',
    cooldowns: { pistol: 0, shotgun: 0, blaster: 0, rocket: 0 },
    heat: 0, overheated: false, unlocked: ['pistol'],
    damage: 0, shots: 0, hits: 0, hp: PLAYER_HP, maxHp: PLAYER_HP, blocked: 0,
  }
}

function idleState(playerId: string): GameState {
  return {
    status: 'ready', coop: true, seed: 0, rng: 0, tick: 0, elapsed: 0, duration: RUN_DURATION,
    duck: {
      x: WORLD.width / 2, y: 205, hp: BOSS_HP, maxHp: BOSS_HP, phase: 0,
      vulnerable: true, dashing: false, warning: false, facing: 1,
    },
    teamDamage: 0,
    players: { [playerId]: blankPlayer(playerId, 'You') },
    projectiles: [], threats: [], attackTimer: 0, nextProjectileId: 0, nextThreatId: 0,
  }
}

/**
 * The networked half of `GameSession`. It sends aim, trigger, and weapon, and draws what comes back.
 * It never computes damage or boss health: the server owns those, and a snapshot always wins.
 */
export class RemoteSession implements GameSession {
  readonly canPause = false
  playerId = 'you'

  private socket: WebSocket | null = null
  private frames: Frame[] = []
  /** Health, damage, and weapon per teammate, refreshed on the slower roster message. */
  private stats = new Map<string, MateStats>()
  /** Names come from the lobby roster, so they never ride in a snapshot. */
  private names = new Map<string, string>()
  private events: GameEvent[] = []
  private listeners = new Set<(status: CoopStatus) => void>()
  private status: CoopStatus
  private token: string | null = null
  private closed = false
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private lastSent = 0
  private lastTrigger = false
  private lastCommand: PlayerCommand | null = null
  private sequence = 0
  private fallback: GameState

  private url: string
  private name: string
  private requestedRoom: string | null

  constructor(url: string, name: string, requestedRoom: string | null) {
    this.url = url
    this.name = name
    this.requestedRoom = requestedRoom
    this.status = {
      phase: 'connecting', inRun: false, room: requestedRoom, playerId: null, hostId: null, members: [],
      waiting: false, error: null, cap: ROOM_CAP, teamDamage: 0, alive: 0,
    }
    this.fallback = idleState(this.playerId)
    this.token = this.readToken(requestedRoom)
    this.connect()
  }

  subscribe(listener: (status: CoopStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<CoopStatus>) {
    this.status = { ...this.status, ...patch }
    for (const listener of this.listeners) listener(this.status)
  }

  /** A reconnect within the same room reclaims the same seat, with its damage and lives intact. */
  private readToken(room: string | null): string | null {
    if (!room) return null
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY)
      if (!raw) return null
      const saved = JSON.parse(raw)
      return saved && saved.room === room && typeof saved.token === 'string' ? saved.token : null
    } catch {
      return null
    }
  }

  private saveToken(room: string, token: string) {
    this.token = token
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ room, token }))
    } catch {
      // A browser refusing storage costs a reconnect its seat, nothing more.
    }
  }

  private connect() {
    if (this.closed) return
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.addEventListener('open', () => {
      this.attempt = 0
      this.update({ phase: 'connecting', error: null })
      this.send({
        t: 'join',
        room: this.status.room ?? this.requestedRoom,
        name: this.name,
        token: this.token,
      })
    })
    socket.addEventListener('message', (event) => {
      const message = parseServerMessage(event.data)
      if (message) this.receive(message)
    })
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null
      this.scheduleReconnect()
    })
    socket.addEventListener('error', () => socket.close())
  }

  private scheduleReconnect() {
    if (this.closed || this.retry) return
    // A room code survives the drop, so reconnecting rejoins the same fight rather than a new one.
    if (this.status.phase !== 'error') this.update({ phase: 'connecting' })
    const delay = RECONNECT_STEPS[Math.min(this.attempt, RECONNECT_STEPS.length - 1)]
    this.attempt++
    this.retry = setTimeout(() => {
      this.retry = null
      this.connect()
    }, delay)
  }

  private send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private receive(message: ServerMessage) {
    switch (message.t) {
      case 'welcome':
        this.playerId = message.playerId
        this.fallback = idleState(message.playerId)
        this.saveToken(message.room, message.token)
        this.update({ room: message.room, playerId: message.playerId, cap: message.cap, error: null })
        return
      case 'lobby': {
        const lobby = message.status === 'lobby'
        for (const member of message.members) this.names.set(member.id, member.name)
        this.update({
          phase: lobby ? 'lobby' : message.status === 'running' ? 'running' : 'complete',
          inRun: !lobby && !message.waiting,
          hostId: message.hostId,
          members: message.members,
          waiting: message.waiting,
        })
        if (lobby) {
          this.frames = []
          this.stats.clear()
        }
        return
      }
      case 'snapshot': {
        this.frames.push({
          at: performance.now(),
          run: message.run,
          you: message.you ?? null,
          mates: message.mates,
        })
        if (this.frames.length > 8) this.frames.shift()
        this.update({
          phase: message.run.status === 'running' ? 'running' : 'complete',
          inRun: true,
          teamDamage: message.run.teamDamage,
          alive: message.run.alive,
        })
        return
      }
      case 'roster': {
        this.stats.clear()
        for (const [id, hp, damage, weapon] of message.mates) {
          this.stats.set(id, { hp, damage, weapon: WEAPON_ORDER[weapon] ?? 'pistol' })
        }
        return
      }
      case 'events':
        this.events.push(...message.events)
        return
      case 'ping':
        this.send({ t: 'pong' })
        return
      case 'error':
        // A refused join is terminal. Retrying into a full room only produces the same answer.
        if (message.code === 'no-room' || message.code === 'room-full' || message.code === 'server-full') {
          this.closed = true
          this.socket?.close()
          this.update({ phase: 'error', error: message.message ?? ERROR_TEXT[message.code] })
          return
        }
        this.update({ error: message.message ?? ERROR_TEXT[message.code] })
        return
    }
  }

  command(command: PlayerCommand): boolean {
    this.lastCommand = command
    const now = performance.now()
    // Rate limited to the server's expected cadence, except on a trigger edge: a quick tap that
    // starts and ends inside one interval still has to reach the duck.
    if (now - this.lastSent < COMMAND_INTERVAL && command.trigger === this.lastTrigger) return false
    this.lastSent = now
    this.lastTrigger = command.trigger
    this.send({
      t: 'cmd', sequence: this.sequence++,
      aim: { x: Math.round(command.aim.x), y: Math.round(command.aim.y) },
      trigger: command.trigger, weapon: command.weapon,
    })
    return true
  }

  advance(): GameEvent[] {
    if (!this.events.length) return []
    return this.events.splice(0, this.events.length)
  }

  start() {
    this.send({ t: 'start' })
  }

  restart() {
    this.send({ t: 'start' })
  }

  setReady(value: boolean) {
    this.send({ t: 'ready', value })
  }

  pause() {
    // A shared fight does not stop. Dropping the trigger is the most this client may do.
    if (this.lastCommand) this.command({ ...this.lastCommand, trigger: false })
  }

  resume() {}

  dispose() {
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.send({ t: 'leave' })
    this.socket?.close()
    this.socket = null
    this.listeners.clear()
  }

  snapshot(): GameState {
    const latest = this.frames.at(-1)
    if (!latest) return this.fallback
    const target = performance.now() - INTERPOLATION_DELAY
    let older = this.frames[0]
    let newer = latest
    for (let i = 0; i < this.frames.length - 1; i++) {
      if (this.frames[i].at <= target && this.frames[i + 1].at >= target) {
        older = this.frames[i]
        newer = this.frames[i + 1]
        break
      }
    }
    const span = newer.at - older.at
    const t = span > 0 ? Math.min(1, Math.max(0, (target - older.at) / span)) : 1
    const run = newer.run
    const players: Record<string, PlayerState> = Object.create(null)
    // Your own row comes straight from the newest frame: a stale heat bar or life count reads as a bug.
    players[this.playerId] = latest.you ?? this.fallback.players[this.playerId]
    const previousMates = new Map(older.mates.map((mate) => [mate[0], mate]))
    for (const [id, x, y, firing] of newer.mates) {
      const before = previousMates.get(id)
      const stats = this.stats.get(id)
      const player = blankPlayer(id, this.names.get(id) ?? id)
      player.aim = before
        ? { x: lerp(before[1], x, t), y: lerp(before[2], y, t) }
        : { x, y }
      player.trigger = firing === 1
      if (stats) {
        player.hp = stats.hp
        player.damage = stats.damage
        player.weapon = stats.weapon
      }
      players[id] = player
    }
    return {
      // Status tracks the newest frame so the result screen is not held back by the render delay.
      status: latest.run.status,
      coop: true,
      seed: 0, rng: 0,
      tick: run.tick,
      elapsed: lerp(older.run.elapsed, run.elapsed, t),
      duration: run.duration,
      duck: this.interpolateDuck(older.run.duck, run.duck, t),
      teamDamage: latest.run.teamDamage,
      players,
      projectiles: this.interpolateProjectiles(older.run.projectiles, run.projectiles, t),
      threats: this.interpolateThreats(older.run.threats, run.threats, t),
      attackTimer: 0, nextProjectileId: 0, nextThreatId: 0,
    }
  }
  private interpolateDuck(a: DuckState, b: DuckState, t: number): DuckState {
    return { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
  }

  private interpolateProjectiles(a: Projectile[], b: Projectile[], t: number): Projectile[] {
    const previous = new Map(a.map((item) => [item.id, item]))
    return b.map((item) => {
      const before = previous.get(item.id)
      if (!before) return item
      return {
        ...item,
        position: {
          x: lerp(before.position.x, item.position.x, t),
          y: lerp(before.position.y, item.position.y, t),
        },
      }
    })
  }

  /** A threat's ring closes with its age, so age is the field that has to move every frame. */
  private interpolateThreats(a: Threat[], b: Threat[], t: number): Threat[] {
    const previous = new Map(a.map((item) => [item.id, item]))
    return b.map((item) => {
      const before = previous.get(item.id)
      return before ? { ...item, age: lerp(before.age, item.age, t) } : item
    })
  }
}
