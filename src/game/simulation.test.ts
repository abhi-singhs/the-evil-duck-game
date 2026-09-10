import { describe, expect, it } from 'vitest'
import { ATTACK_INTERVAL, BOSS_HP, PLAYER_HP, STEP, THREAT_RADIUS, WEAPONS } from './config'
import {
  applyCommand, applyDamage, bestAvailableWeapon, createGame, moveDuck, setConnected, stepGame,
  threatRadius,
} from './simulation'
import type { GameEvent, GameState, WeaponId } from './types'

function running(ids = ['local']) {
  const state = createGame(42, ids)
  state.status = 'running'
  return state
}

function aim(state: GameState, weapon: WeaponId = 'pistol', playerId = 'local') {
  const player = state.players[playerId]
  return applyCommand(state, { playerId, sequence: player.sequence + 1, aim: state.duck, trigger: true, weapon })
}

/** No attacks, for tests that isolate duck combat from defence. */
function peaceful(ids = ['local']) {
  const state = running(ids)
  state.attackTimer = Infinity
  return state
}

/** Plays the fight: swats the most urgent incoming egg with the pistol, otherwise works the duck. */
function runStrategy(accuracy: number, seed: number, defend = true) {
  const state = createGame(seed)
  state.status = 'running'
  let random = seed
  while (state.status === 'running') {
    const player = state.players.local
    const urgent = defend
      ? [...state.threats].sort((a, b) => b.age / b.travel - a.age / a.travel)[0]
      : undefined
    const defending = !!urgent && urgent.age / urgent.travel > 0.4
    const weapon = defending ? 'pistol' : bestAvailableWeapon(player)
    const predicted = structuredClone(state)
    predicted.elapsed += weapon === 'rocket' ? Math.hypot(state.duck.x - 480, state.duck.y - 504) / 1000 : STEP
    moveDuck(predicted)
    if (state.tick % 15 === 0) random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    const target = defending && urgent ? urgent.position : predicted.duck
    applyCommand(state, {
      playerId: 'local', sequence: state.tick, trigger: true, weapon,
      aim: random / 4294967296 < accuracy ? target : { x: 0, y: 0 },
    })
    stepGame(state)
  }
  return state
}

describe('combat rules', () => {
  it('starts with a high-health duck, one weapon, and full player health', () => {
    const state = createGame()
    expect(state.status).toBe('ready')
    expect(state.duck.hp).toBe(BOSS_HP)
    expect(state.players.local.unlocked).toEqual(['pistol'])
    expect(state.players.local.hp).toBe(PLAYER_HP)
    expect(state.threats).toEqual([])
    expect(state.duration).toBe(120)
  })

  it('applies aimed hits and enforces cooldowns across switching', () => {
    const state = peaceful()
    moveDuck(state)
    aim(state)
    stepGame(state)
    expect(state.duck.hp).toBe(BOSS_HP - WEAPONS.pistol.damage)
    aim(state)
    stepGame(state)
    expect(state.players.local.shots).toBe(1)
    state.players.local.unlocked.push('shotgun')
    aim(state, 'shotgun')
    stepGame(state)
    aim(state, 'pistol')
    stepGame(state)
    expect(state.players.local.shots).toBe(2)
    expect(state.players.local.cooldowns.pistol).toBeGreaterThan(0)
  })

  it('unlocks weapons by actual damage, not attempted damage', () => {
    const state = peaceful()
    state.duck.phase = 3
    state.duck.vulnerable = false
    const events: GameEvent[] = []
    applyDamage(state, state.players.local, 4000, events)
    expect(state.players.local.damage).toBe(2400)
    expect(state.players.local.unlocked).toEqual(['pistol'])
    applyDamage(state, state.players.local, 1000, events)
    expect(state.players.local.damage).toBe(3000)
    expect(events).toContainEqual({ type: 'unlock', playerId: 'local', weapon: 'shotgun' })
  })

  it('resolves shotgun pellets as a single hit with summed damage', () => {
    const state = peaceful()
    moveDuck(state)
    state.players.local.unlocked.push('shotgun')
    aim(state, 'shotgun')
    const events = stepGame(state)
    const damage = events.find((event) => event.type === 'damage')
    expect(damage?.amount).toBeGreaterThanOrEqual(WEAPONS.shotgun.damage * 4)
    expect(damage?.amount).toBeLessThanOrEqual(WEAPONS.shotgun.damage * 7)
    expect(state.players.local.hits).toBe(1)
  })

  it('resolves rockets on arrival and removes the projectile', () => {
    const state = peaceful()
    const predicted = structuredClone(state)
    predicted.elapsed = STEP
    moveDuck(predicted)
    state.projectiles.push({ id: 0, playerId: 'local', position: { x: predicted.duck.x, y: predicted.duck.y }, target: { x: predicted.duck.x, y: predicted.duck.y }, speed: 1000 })
    const events = stepGame(state)
    expect(state.duck.hp).toBe(BOSS_HP - WEAPONS.rocket.damage)
    expect(state.projectiles).toHaveLength(0)
    expect(events.some((event) => event.type === 'explosion')).toBe(true)
  })

  it('overheats the blaster and keeps its heat when another weapon is selected', () => {
    const state = peaceful()
    const player = state.players.local
    player.unlocked.push('blaster')
    let overheated = false
    for (let i = 0; i < 300; i++) {
      aim(state, 'blaster')
      stepGame(state)
      if (player.overheated) { overheated = true; break }
    }
    expect(overheated).toBe(true)
    expect(player.heat).toBe(100)
    aim(state, 'pistol')
    stepGame(state)
    expect(player.heat).toBeGreaterThan(90)
    for (let i = 0; i < 150; i++) stepGame(state)
    expect(player.overheated).toBe(false)
    expect(player.heat).toBeLessThan(20)
  })

  it('rejects stale, locked, unknown-player, and invalid-coordinate commands', () => {
    const state = peaceful()
    expect(aim(state)).toBe(true)
    const command = { playerId: 'local', sequence: 0, aim: { x: 10, y: 10 }, trigger: true, weapon: 'pistol' as const }
    expect(applyCommand(state, command)).toBe(false)
    expect(applyCommand(state, { ...command, sequence: 10, weapon: 'rocket' })).toBe(false)
    expect(applyCommand(state, { ...command, sequence: 10, playerId: '__proto__' })).toBe(false)
    expect(applyCommand(state, { ...command, sequence: 10, aim: { x: NaN, y: 0 } })).toBe(false)
    expect(applyCommand(state, { ...command, sequence: 10, aim: { x: Infinity, y: 0 } })).toBe(false)
  })

  it('tracks player weapons independently while sharing duck health', () => {
    const state = peaceful(['alice', 'bob'])
    moveDuck(state)
    aim(state, 'pistol', 'alice')
    stepGame(state)
    expect(state.players.bob.cooldowns.pistol).toBe(0)
    const aliceDamage = state.players.alice.damage
    state.players.alice.trigger = false
    aim(state, 'pistol', 'bob')
    stepGame(state)
    expect(state.duck.maxHp - state.duck.hp).toBe(aliceDamage + state.players.bob.damage)
    expect(state.players.alice.cooldowns.pistol).toBeLessThan(state.players.bob.cooldowns.pistol)
  })
})

describe('progression and terminal states', () => {
  it.each([30, 60, 90])('evolves at %i seconds without restoring health', (elapsed) => {
    const state = peaceful()
    state.tick = elapsed * 60 - 1
    state.duck.hp = 15000
    const events = stepGame(state)
    expect(state.duck.phase).toBe(elapsed / 30)
    expect(state.duck.hp).toBe(15000)
    expect(events).toContainEqual({ type: 'phase', phase: elapsed / 30 })
  })

  it('opens armor regularly and increases flight speed', () => {
    const first = peaceful()
    const late = peaceful()
    late.duck.phase = 3
    late.elapsed = 92
    moveDuck(late)
    expect(late.duck.vulnerable).toBe(false)
    late.elapsed = 94.5
    moveDuck(late)
    expect(late.duck.vulnerable).toBe(true)
    const travel = (state: GameState, start: number) => {
      state.elapsed = start
      moveDuck(state)
      let length = 0
      for (let i = 1; i <= 300; i++) {
        const previous = { x: state.duck.x, y: state.duck.y }
        state.elapsed = start + i * STEP
        moveDuck(state)
        length += Math.hypot(state.duck.x - previous.x, state.duck.y - previous.y)
      }
      return length
    }
    expect(travel(late, 90)).toBeGreaterThan(travel(first, 0) * 1.4)
  })

  it('declares one victory and caps damage at remaining HP', () => {
    const state = peaceful()
    const events: GameEvent[] = []
    state.duck.hp = 10
    applyDamage(state, state.players.local, 9999, events)
    applyDamage(state, state.players.local, 9999, events)
    expect(state.duck.hp).toBe(0)
    expect(state.players.local.damage).toBe(10)
    expect(events.filter((event) => event.type === 'end')).toHaveLength(1)
    expect(stepGame(state)).toEqual([])
  })

  it('does not accept a killing shot at or after the deadline', () => {
    const state = peaceful()
    state.tick = 7199
    state.duck.hp = 1
    aim(state)
    expect(stepGame(state)).toEqual([{ type: 'end', won: false }])
    expect(state.status).toBe('lost')
    expect(state.duck.hp).toBe(1)
    expect(aim(state)).toBe(false)
  })

  it('pauses all simulation rules', () => {
    const state = peaceful()
    state.status = 'paused'
    const before = structuredClone(state)
    for (let i = 0; i < 100; i++) stepGame(state)
    expect(state).toEqual(before)
  })

  it('keeps the duck inside the logical arena for the whole fight', () => {
    const state = peaceful()
    while (state.status === 'running') {
      stepGame(state)
      expect(state.duck.x).toBeGreaterThan(60)
      expect(state.duck.x).toBeLessThan(900)
      expect(state.duck.y).toBeGreaterThan(60)
      expect(state.duck.y).toBeLessThan(480)
    }
    expect(state.status).toBe('lost')
  })

  it('has reproducible wins for accurate play and losses for poor aim', () => {
    const perfect = runStrategy(1, 42)
    const skilled = runStrategy(0.65, 42)
    const poor = runStrategy(0.2, 42)
    console.info([
      `ideal ${perfect.status} ${perfect.elapsed.toFixed(1)}s hp ${perfect.players.local.hp} blocked ${perfect.players.local.blocked}`,
      `65% aim ${skilled.status} ${skilled.elapsed.toFixed(1)}s hp ${skilled.players.local.hp} duck ${skilled.duck.hp}`,
      `20% aim ${poor.status} ${poor.elapsed.toFixed(1)}s hp ${poor.players.local.hp} duck ${poor.duck.hp}`,
    ].join(' | '))
    expect(perfect.status).toBe('won')
    expect(perfect.players.local.hp).toBeGreaterThan(0)
    expect(perfect.elapsed).toBeLessThan(120)
    expect(skilled.status).toBe('won')
    expect(poor.status).toBe('lost')
    expect(runStrategy(0.65, 42)).toEqual(skilled)
  })

  it("punishes ignoring the duck's attacks, even with perfect aim on the duck", () => {
    const defending = runStrategy(1, 7)
    const reckless = runStrategy(1, 7, false)
    expect(defending.status).toBe('won')
    expect(reckless.status).toBe('lost')
    expect(reckless.players.local.hp).toBe(0)
    expect(reckless.elapsed).toBeLessThan(defending.elapsed)
  })
})

describe('duck attacks and player health', () => {
  it('throws its first attack on schedule and repeats it', () => {
    const state = running()
    const events: GameEvent[] = []
    for (let i = 0; i < Math.round(ATTACK_INTERVAL[0] * 60); i++) events.push(...stepGame(state))
    expect(events.filter((event) => event.type === 'attack')).toHaveLength(1)
    expect(state.threats).toHaveLength(1)
    expect(state.threats[0].playerId).toBe('local')
    for (let i = 0; i < Math.round(ATTACK_INTERVAL[0] * 60); i++) stepGame(state)
    expect(state.nextThreatId).toBe(2)
  })

  it('spawns attacks inside the arena and grows their hit area as they close in', () => {
    const state = running()
    for (let i = 0; i < 3600 && state.status === 'running'; i++) {
      stepGame(state)
      for (const threat of state.threats) {
        expect(threat.position.x).toBeGreaterThanOrEqual(70)
        expect(threat.position.x).toBeLessThanOrEqual(890)
        expect(threat.position.y).toBeGreaterThanOrEqual(70)
        expect(threat.position.y).toBeLessThanOrEqual(450)
        expect(threatRadius(threat)).toBeGreaterThanOrEqual(THREAT_RADIUS.start)
        expect(threatRadius(threat)).toBeLessThanOrEqual(THREAT_RADIUS.end)
      }
    }
  })

  it('costs one life when an attack lands and ends the run at zero', () => {
    const state = running()
    const events: GameEvent[] = []
    while (state.status === 'running') events.push(...stepGame(state))
    const hurt = events.filter((event) => event.type === 'hurt')
    expect(hurt).toHaveLength(PLAYER_HP)
    expect(hurt.at(-1)).toMatchObject({ playerId: 'local', hp: 0 })
    expect(state.players.local.hp).toBe(0)
    expect(state.elapsed).toBeLessThan(state.duration)
    expect(events.filter((event) => event.type === 'end')).toEqual([{ type: 'end', won: false }])
    expect(stepGame(state)).toEqual([])
  })

  it('destroys an attack that is shot, and that shot never reaches the duck', () => {
    const state = running()
    while (!state.threats.length) stepGame(state)
    const threat = state.threats[0]
    state.duck.x = threat.position.x
    state.duck.y = threat.position.y
    applyCommand(state, { playerId: 'local', sequence: 1, aim: threat.position, trigger: true, weapon: 'pistol' })
    const events = stepGame(state)
    expect(state.threats).toHaveLength(0)
    expect(state.duck.hp).toBe(BOSS_HP)
    expect(state.players.local.blocked).toBe(1)
    expect(state.players.local.hp).toBe(PLAYER_HP)
    expect(events).toContainEqual({ type: 'intercept', playerId: 'local', position: threat.position })
  })

  it('clears attacks caught in a rocket blast', () => {
    const state = running()
    while (!state.threats.length) stepGame(state)
    const target = { ...state.threats[0].position }
    state.threats.push({ ...state.threats[0], id: 99, position: { x: target.x + 40, y: target.y } })
    state.projectiles.push({
      id: 0, playerId: 'local', position: { ...target }, target, speed: 1000,
    })
    stepGame(state)
    expect(state.threats).toHaveLength(0)
    expect(state.players.local.blocked).toBe(2)
  })

  it('hurts only the player an attack was aimed at', () => {
    const state = running(['alice', 'bob'])
    while (state.status === 'running' && state.players.alice.hp === PLAYER_HP
      && state.players.bob.hp === PLAYER_HP) stepGame(state)
    const hits = [state.players.alice.hp, state.players.bob.hp].filter((hp) => hp < PLAYER_HP)
    expect(hits).toHaveLength(1)
    expect(state.status).toBe('running')
  })

  it('stops a downed player from firing but keeps the shared duck fight alive', () => {
    const state = running(['alice', 'bob'])
    state.attackTimer = Infinity
    state.players.alice.hp = 0
    moveDuck(state)
    aim(state, 'pistol', 'alice')
    aim(state, 'pistol', 'bob')
    stepGame(state)
    expect(state.players.alice.shots).toBe(0)
    expect(state.players.bob.shots).toBe(1)
    expect(state.status).toBe('running')
    expect(state.duck.hp).toBeLessThan(BOSS_HP)
  })
})

describe('co-op rules', () => {
  const coop = (ids: string[]) => {
    const state = createGame(42, ids, true)
    state.status = 'running'
    state.attackTimer = Infinity
    return state
  }

  it('unlocks on team damage in co-op so a large group is not stuck with pistols', () => {
    const state = coop(['alice', 'bob'])
    const events: GameEvent[] = []
    // Bob alone clears the shotgun threshold. Alice has done nothing, but the team has.
    applyDamage(state, state.players.bob, BOSS_HP * WEAPONS.shotgun.unlock, events)
    applyDamage(state, state.players.alice, 1, events)
    expect(state.players.alice.unlocked).toContain('shotgun')
    expect(state.teamDamage).toBeGreaterThan(BOSS_HP * WEAPONS.shotgun.unlock)
  })

  it('keeps unlocks personal in solo', () => {
    const state = running(['alice', 'bob'])
    const events: GameEvent[] = []
    applyDamage(state, state.players.bob, BOSS_HP * WEAPONS.shotgun.unlock, events)
    applyDamage(state, state.players.alice, 1, events)
    expect(state.players.alice.unlocked).toEqual(['pistol'])
    expect(state.players.bob.unlocked).toContain('shotgun')
  })

  it('never aims an attack at a disconnected player and drops the ones already flying', () => {
    const state = coop(['alice', 'bob'])
    state.attackTimer = STEP
    while (!state.threats.length) stepGame(state)
    const targeted = state.threats[0].playerId
    setConnected(state, targeted, false)
    expect(state.threats).toHaveLength(0)
    state.attackTimer = STEP
    for (let i = 0; i < 600 && state.status === 'running'; i++) stepGame(state)
    expect(state.threats.every((threat) => threat.playerId !== targeted)).toBe(true)
  })

  it('stops a disconnected player from firing without ending the run', () => {
    const state = coop(['alice', 'bob'])
    setConnected(state, 'alice', false)
    moveDuck(state)
    expect(aim(state, 'pistol', 'alice')).toBe(false)
    aim(state, 'pistol', 'bob')
    stepGame(state)
    expect(state.players.alice.shots).toBe(0)
    expect(state.players.bob.shots).toBe(1)
    expect(state.status).toBe('running')
  })

  it('ends the run when the last connected player drops', () => {
    const state = coop(['alice', 'bob'])
    setConnected(state, 'alice', false)
    expect(state.status).toBe('running')
    const events = setConnected(state, 'bob', false)
    expect(state.status).toBe('lost')
    expect(events).toContainEqual({ type: 'end', won: false })
  })

  it('gives a reconnecting player their seat back with damage and lives intact', () => {
    const state = coop(['alice', 'bob'])
    applyDamage(state, state.players.alice, 500, [])
    state.players.alice.hp = 3
    setConnected(state, 'alice', false)
    setConnected(state, 'alice', true)
    expect(state.players.alice.damage).toBe(500)
    expect(state.players.alice.hp).toBe(3)
    moveDuck(state)
    expect(aim(state, 'pistol', 'alice')).toBe(true)
  })
})
