export type WeaponId = 'pistol' | 'shotgun' | 'blaster' | 'rocket'
export type RunStatus = 'ready' | 'running' | 'paused' | 'won' | 'lost'
export type Point = { x: number; y: number }

export type PlayerCommand = {
  playerId: string
  sequence: number
  aim: Point
  trigger: boolean
  weapon: WeaponId
}

export type PlayerState = {
  id: string
  sequence: number
  aim: Point
  trigger: boolean
  weapon: WeaponId
  cooldowns: Record<WeaponId, number>
  heat: number
  overheated: boolean
  unlocked: WeaponId[]
  damage: number
  shots: number
  hits: number
  hp: number
  maxHp: number
  blocked: number
}

export type Threat = {
  id: number
  playerId: string
  position: Point
  age: number
  travel: number
}

export type DuckState = Point & {
  hp: number
  maxHp: number
  phase: number
  vulnerable: boolean
  dashing: boolean
  warning: boolean
  facing: number
}

export type Projectile = {
  id: number
  playerId: string
  position: Point
  target: Point
  speed: number
}

export type GameState = {
  status: RunStatus
  seed: number
  rng: number
  tick: number
  elapsed: number
  duration: number
  duck: DuckState
  players: Record<string, PlayerState>
  projectiles: Projectile[]
  threats: Threat[]
  attackTimer: number
  nextProjectileId: number
  nextThreatId: number
}

export type GameEvent =
  | { type: 'shot'; playerId: string; weapon: WeaponId; aim: Point; hit: boolean }
  | { type: 'damage'; playerId: string; amount: number; position: Point }
  | { type: 'explosion'; position: Point }
  | { type: 'attack'; position: Point }
  | { type: 'intercept'; playerId: string; position: Point }
  | { type: 'hurt'; playerId: string; position: Point; hp: number }
  | { type: 'unlock'; playerId: string; weapon: WeaponId }
  | { type: 'phase'; phase: number }
  | { type: 'end'; won: boolean }

export type WeaponConfig = {
  id: WeaponId
  name: string
  description: string
  damage: number
  cooldown: number
  unlock: number
}
