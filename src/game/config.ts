import type { WeaponConfig, WeaponId } from './types'

export const WORLD = { width: 960, height: 540 }
export const STEP = 1 / 60
export const RUN_DURATION = 120
export const BOSS_HP = 26_000
export const DUCK_RADIUS = 47
export const ROCKET_RADIUS = 112

export const PLAYER_HP = 5
// Per phase: seconds between attacks, and how long each one takes to reach you.
export const ATTACK_INTERVAL = [6, 4.6, 3.6, 2.8]
export const ATTACK_TRAVEL = [2.4, 2.1, 1.8, 1.5]
export const THREAT_RADIUS = { start: 16, end: 42 }

export const WEAPON_ORDER: WeaponId[] = ['pistol', 'shotgun', 'blaster', 'rocket']
export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  pistol: {
    id: 'pistol', name: 'Pistol',
    description: 'Accurate, reliable, deeply insulting.',
    damage: 80, cooldown: 0.3, unlock: 0,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun',
    description: 'Seven pellets. A wider margin for error.',
    damage: 50, cooldown: 0.8, unlock: 0.1,
  },
  blaster: {
    id: 'blaster', name: 'Blaster',
    description: 'Hold to shred. Watch the heat.',
    damage: 62, cooldown: 0.1, unlock: 0.25,
  },
  rocket: {
    id: 'rocket', name: 'Rocket',
    description: 'Lead your shot. Make a big splash.',
    damage: 900, cooldown: 1.4, unlock: 0.45,
  },
}

export const SHOTGUN_OFFSETS = [
  { x: 0, y: 0 }, { x: -30, y: -13 }, { x: 30, y: 13 },
  { x: -17, y: 27 }, { x: 17, y: -27 }, { x: -48, y: 9 }, { x: 48, y: -9 },
]
