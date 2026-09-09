import { STEP } from './config'
import { applyCommand, clearTriggers, createGame, stepGame } from './simulation'
import type { GameEvent, GameState, PlayerCommand } from './types'

export interface GameSession {
  /** The id this browser's commands carry. Solo play is always `local`. */
  readonly playerId: string
  /** Solo can stop the world. A shared fight cannot, so co-op only drops the trigger. */
  readonly canPause: boolean
  command(command: PlayerCommand): boolean
  snapshot(): GameState
  advance(seconds: number): GameEvent[]
  start(): void
  restart(): void
  pause(): void
  resume(): void
  dispose(): void
}

export class LocalSession implements GameSession {
  readonly playerId = 'local'
  readonly canPause = true
  private state: GameState
  private accumulator = 0

  constructor(seed = Math.floor(Math.random() * 1_000_000)) {
    this.state = createGame(seed)
  }

  snapshot(): GameState {
    return structuredClone(this.state)
  }

  command(command: PlayerCommand) {
    return applyCommand(this.state, command)
  }

  start() {
    if (this.state.status === 'ready') this.state.status = 'running'
  }

  restart() {
    this.state = createGame(Math.floor(Math.random() * 1_000_000))
    this.accumulator = 0
    this.state.status = 'running'
  }

  pause() {
    if (this.state.status === 'running') {
      this.state.status = 'paused'
      clearTriggers(this.state)
      this.accumulator = 0
    }
  }

  resume() {
    if (this.state.status === 'paused') this.state.status = 'running'
  }

  dispose() {}

  advance(seconds: number): GameEvent[] {
    if (this.state.status !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return []
    // A stalled frame pauses instead of dropping time or firing a backlog of invisible shots.
    if (seconds > 0.5) {
      this.pause()
      return []
    }
    this.accumulator += seconds
    const events: GameEvent[] = []
    while (this.accumulator + 1e-9 >= STEP && this.state.status === 'running') {
      this.accumulator -= STEP
      events.push(...stepGame(this.state))
    }
    return events
  }
}
