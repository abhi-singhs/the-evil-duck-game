import {
  ATTACK_INTERVAL, ATTACK_TRAVEL, BOSS_HP, DUCK_RADIUS, PLAYER_HP, ROCKET_RADIUS,
  RUN_DURATION, SHOTGUN_OFFSETS, STEP, THREAT_RADIUS, WEAPONS, WEAPON_ORDER, WORLD,
} from './config'
import type {
  GameEvent, GameState, PlayerCommand, PlayerState, Point, Threat, WeaponId,
} from './types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const copyPoint = (point: Point): Point => ({ x: point.x, y: point.y })

function random(state: GameState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0
  return state.rng / 4294967296
}

export function threatRadius(threat: Threat): number {
  const progress = clamp(threat.age / threat.travel, 0, 1)
  return THREAT_RADIUS.start + (THREAT_RADIUS.end - THREAT_RADIUS.start) * progress
}

export function createPlayer(id: string): PlayerState {
  return {
    id, sequence: -1, aim: { x: WORLD.width / 2, y: WORLD.height / 2 }, trigger: false,
    weapon: 'pistol', cooldowns: { pistol: 0, shotgun: 0, blaster: 0, rocket: 0 },
    heat: 0, overheated: false, unlocked: ['pistol'], damage: 0, shots: 0, hits: 0,
    hp: PLAYER_HP, maxHp: PLAYER_HP, blocked: 0,
  }
}

export function createGame(seed = 42, playerIds = ['local']): GameState {
  const players: Record<string, PlayerState> = Object.create(null)
  for (const id of playerIds) players[id] = createPlayer(id)
  return {
    status: 'ready', seed, rng: seed >>> 0, tick: 0, elapsed: 0, duration: RUN_DURATION,
    duck: {
      x: WORLD.width / 2, y: 205, hp: BOSS_HP, maxHp: BOSS_HP, phase: 0,
      vulnerable: true, dashing: false, warning: false, facing: 1,
    },
    players, projectiles: [], threats: [],
    attackTimer: ATTACK_INTERVAL[0], nextProjectileId: 0, nextThreatId: 0,
  }
}

export function clearTriggers(state: GameState) {
  for (const player of Object.values(state.players)) player.trigger = false
}

export function applyCommand(state: GameState, command: PlayerCommand): boolean {
  const player = Object.hasOwn(state.players, command.playerId) ? state.players[command.playerId] : undefined
  if (!player || state.status !== 'running' || !Number.isSafeInteger(command.sequence)
    || command.sequence <= player.sequence || !Number.isFinite(command.aim.x)
    || !Number.isFinite(command.aim.y) || !player.unlocked.includes(command.weapon)) return false
  player.sequence = command.sequence
  player.aim = { x: clamp(command.aim.x, 0, WORLD.width), y: clamp(command.aim.y, 0, WORLD.height) }
  player.trigger = command.trigger
  player.weapon = command.weapon
  return true
}

export function moveDuck(state: GameState) {
  const duck = state.duck
  const phase = duck.phase
  const t = state.elapsed
  const seedOffset = (state.seed % 997) / 997 * Math.PI * 2
  // Integrating the phase speeds keeps the flight path continuous at phase boundaries.
  let flight = 0
  const speeds = [0.82, 1.12, 1.42, 1.8]
  for (let i = 0; i <= phase; i++) flight += clamp(t - i * 30, 0, 30) * speeds[i]
  const cycle = t % (phase === 3 ? 4 : 5.5)
  duck.warning = phase > 0 && cycle >= 3.15 && cycle < 3.75
  duck.dashing = phase > 0 && cycle >= 3.75 && cycle < 4
  duck.vulnerable = phase < 2 || t % 4.5 < 1.6
  const dash = phase > 0 ? Math.sin(Math.PI * clamp((cycle - 3.75) / 0.25, 0, 1)) * 65 : 0
  const previousX = duck.x
  duck.x = WORLD.width / 2 + Math.sin(flight + seedOffset) * 285 + dash
  duck.y = 211 + Math.sin(flight * 1.55 + seedOffset) * 83 + Math.cos(flight * 0.7) * 22
  duck.facing = duck.x >= previousX ? 1 : -1
}

function endRun(state: GameState, won: boolean, events: GameEvent[]) {
  state.status = won ? 'won' : 'lost'
  clearTriggers(state)
  events.push({ type: 'end', won })
}

export function applyDamage(state: GameState, player: PlayerState, raw: number, events: GameEvent[]) {
  if (state.status !== 'running' || raw <= 0) return
  const resistance = state.duck.vulnerable ? 1 : state.duck.phase === 3 ? 0.6 : 0.75
  const amount = Math.min(state.duck.hp, Math.round(raw * resistance))
  state.duck.hp -= amount
  player.damage += amount
  player.hits++
  events.push({ type: 'damage', playerId: player.id, amount, position: copyPoint(state.duck) })
  for (const weapon of WEAPON_ORDER) {
    if (!player.unlocked.includes(weapon) && player.damage >= state.duck.maxHp * WEAPONS[weapon].unlock) {
      player.unlocked.push(weapon)
      events.push({ type: 'unlock', playerId: player.id, weapon })
    }
  }
  if (state.duck.hp === 0) endRun(state, true, events)
}

function spawnAttack(state: GameState, events: GameEvent[]) {
  const targets = Object.values(state.players).filter((player) => player.hp > 0)
  if (!targets.length) return
  const target = targets[Math.min(targets.length - 1, Math.floor(random(state) * targets.length))]
  const position = {
    x: clamp(state.duck.x + (random(state) - 0.5) * 320, 70, WORLD.width - 70),
    y: clamp(state.duck.y + random(state) * 150 - 20, 70, WORLD.height - 90),
  }
  state.threats.push({
    id: state.nextThreatId++, playerId: target.id, position,
    age: 0, travel: ATTACK_TRAVEL[state.duck.phase],
  })
  events.push({ type: 'attack', position: copyPoint(position) })
}

function removeThreat(state: GameState, threat: Threat) {
  state.threats = state.threats.filter((item) => item.id !== threat.id)
}

/** Attacks fly between you and the duck, so a shot that clips one never reaches the duck. */
function intercept(state: GameState, player: PlayerState, aim: Point, events: GameEvent[]): boolean {
  const hit = state.threats.find((threat) =>
    threat.playerId === player.id && distance(aim, threat.position) <= threatRadius(threat))
  if (!hit) return false
  removeThreat(state, hit)
  player.blocked++
  events.push({ type: 'intercept', playerId: player.id, position: copyPoint(hit.position) })
  return true
}

function land(state: GameState, threat: Threat, events: GameEvent[]) {
  removeThreat(state, threat)
  const player = state.players[threat.playerId]
  if (!player || player.hp === 0) return
  player.hp--
  events.push({ type: 'hurt', playerId: player.id, position: copyPoint(threat.position), hp: player.hp })
  if (Object.values(state.players).every((other) => other.hp === 0)) endRun(state, false, events)
}

function fire(state: GameState, player: PlayerState, events: GameEvent[]) {
  const weapon = WEAPONS[player.weapon]
  if (player.cooldowns[weapon.id] > 0.00001 || (weapon.id === 'blaster' && player.overheated)) return
  player.cooldowns[weapon.id] = weapon.cooldown
  player.shots++
  let raw = 0
  let blocked = false
  if (weapon.id === 'rocket') {
    state.projectiles.push({
      id: state.nextProjectileId++, playerId: player.id,
      position: { x: WORLD.width / 2, y: WORLD.height - 36 }, target: copyPoint(player.aim), speed: 1000,
    })
  } else if (weapon.id === 'shotgun') {
    for (const offset of SHOTGUN_OFFSETS) {
      const pellet = { x: player.aim.x + offset.x, y: player.aim.y + offset.y }
      if (intercept(state, player, pellet, events)) blocked = true
      else if (distance(pellet, state.duck) <= DUCK_RADIUS) raw += weapon.damage
    }
  } else {
    if (intercept(state, player, player.aim, events)) blocked = true
    else if (distance(player.aim, state.duck) <= DUCK_RADIUS) raw = weapon.damage
    if (weapon.id === 'blaster') {
      player.heat = Math.min(100, player.heat + 7)
      if (player.heat >= 100) player.overheated = true
    }
  }
  events.push({
    type: 'shot', playerId: player.id, weapon: weapon.id,
    aim: copyPoint(player.aim), hit: raw > 0 || blocked,
  })
  if (raw > 0) applyDamage(state, player, raw, events)
}

export function stepGame(state: GameState): GameEvent[] {
  if (state.status !== 'running') return []
  const events: GameEvent[] = []
  state.tick++
  state.elapsed = Math.min(state.duration, state.tick * STEP)
  if (state.elapsed >= state.duration) {
    endRun(state, false, events)
    return events
  }
  const phase = Math.min(3, Math.floor(state.elapsed / 30))
  if (phase !== state.duck.phase) {
    state.duck.phase = phase
    events.push({ type: 'phase', phase })
  }
  moveDuck(state)

  state.attackTimer -= STEP
  if (state.attackTimer <= 0.00001) {
    state.attackTimer += ATTACK_INTERVAL[phase]
    spawnAttack(state, events)
  }
  for (const threat of [...state.threats]) {
    threat.age += STEP
    if (threat.age >= threat.travel) land(state, threat, events)
  }
  if (state.status !== 'running') return events

  for (const projectile of [...state.projectiles]) {
    const remaining = distance(projectile.position, projectile.target)
    if (remaining <= projectile.speed * STEP) {
      state.projectiles = state.projectiles.filter((item) => item.id !== projectile.id)
      events.push({ type: 'explosion', position: copyPoint(projectile.target) })
      const player = state.players[projectile.playerId]
      if (!player) continue
      for (const threat of [...state.threats]) {
        if (threat.playerId === player.id && distance(projectile.target, threat.position) <= ROCKET_RADIUS) {
          removeThreat(state, threat)
          player.blocked++
          events.push({ type: 'intercept', playerId: player.id, position: copyPoint(threat.position) })
        }
      }
      if (distance(projectile.target, state.duck) <= ROCKET_RADIUS) {
        applyDamage(state, player, WEAPONS.rocket.damage, events)
      }
    } else {
      projectile.position.x += (projectile.target.x - projectile.position.x) / remaining * projectile.speed * STEP
      projectile.position.y += (projectile.target.y - projectile.position.y) / remaining * projectile.speed * STEP
    }
  }
  for (const player of Object.values(state.players)) {
    for (const id of WEAPON_ORDER) player.cooldowns[id] = Math.max(0, player.cooldowns[id] - STEP)
    const cooling = player.weapon !== 'blaster' || !player.trigger || player.overheated
    player.heat = Math.max(0, player.heat - (cooling ? 34 : 16) * STEP)
    if (player.heat <= 20) player.overheated = false
    if (player.trigger && state.status === 'running' && player.hp > 0) fire(state, player, events)
  }
  return events
}

export function bestAvailableWeapon(player: PlayerState): WeaponId {
  return [...player.unlocked].reverse().find((id) => id !== 'blaster' || !player.overheated) ?? 'pistol'
}
