import { WORLD } from './config'
import { threatRadius } from './simulation'
import { drawDuck, readPalette } from './sprites'
import type { Palette } from './sprites'
import type { GameEvent, GameState, Point, Threat } from './types'

type Effect = {
  kind: 'hit' | 'miss' | 'explosion' | 'number' | 'block'
  x: number; y: number; age: number; amount: number; mine: boolean
}

export class GameRenderer {
  private context: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement
  private palette: Palette
  private effects: Effect[] = []
  private flash = 0
  private hurt = 0
  private clock = 0
  private phaseBanner = 0
  private reducedMotion = false
  private localId = 'local'

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not start the 2D game canvas.')
    this.context = context
    this.palette = readPalette()
  }

  setReducedMotion(reduced: boolean) { this.reducedMotion = reduced }
  setLocalPlayer(id: string) { this.localId = id }
  refreshPalette() { this.palette = readPalette() }

  push(events: GameEvent[]) {
    for (const event of events) {
      if (event.type === 'shot') {
        const mine = event.playerId === this.localId
        this.effects.push({ kind: event.hit ? 'hit' : 'miss', ...event.aim, age: 0, amount: 0, mine })
      } else if (event.type === 'damage') {
        this.flash = 0.07
        const mine = event.playerId === this.localId
        this.effects.push({ kind: 'number', ...event.position, age: 0, amount: event.amount, mine })
      } else if (event.type === 'explosion') {
        this.effects.push({ kind: 'explosion', ...event.position, age: 0, amount: 0, mine: true })
      } else if (event.type === 'intercept') {
        const mine = event.playerId === this.localId
        this.effects.push({ kind: 'block', ...event.position, age: 0, amount: 0, mine })
      } else if (event.type === 'hurt') {
        // Only your own hits shake the screen. Forty-nine teammates taking eggs would be unplayable.
        if (event.playerId === this.localId) this.hurt = 0.5
        this.effects.push({ kind: 'explosion', ...event.position, age: 0, amount: 0, mine: event.playerId === this.localId })
      } else if (event.type === 'phase') this.phaseBanner = 2.2
    }
    // A full room produces far more effects than one player, so the tail is longer but still bounded.
    this.effects = this.effects.slice(-220)
  }

  reset() { this.effects = []; this.flash = 0; this.hurt = 0; this.phaseBanner = 0; this.clock = 0 }

  draw(state: GameState, seconds: number, aim: Point | null) {
    const ctx = this.context
    const p = this.palette
    const rect = this.canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(rect.width * ratio)
    const height = Math.round(rect.height * ratio)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const animate = state.status === 'running' || state.status === 'ready'
    const dt = animate ? Math.min(seconds, 0.05) : 0
    this.clock += dt
    this.flash = Math.max(0, this.flash - dt)
    this.hurt = Math.max(0, this.hurt - dt)
    this.phaseBanner = Math.max(0, this.phaseBanner - dt)
    for (const effect of this.effects) effect.age += dt
    this.effects = this.effects.filter((effect) => effect.age < (effect.kind === 'number' ? 0.8 : 0.45))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = p.surface
    ctx.fillRect(0, 0, width, height)
    const scale = Math.min(width / WORLD.width, height / WORLD.height)
    const bleedX = (width - WORLD.width * scale) / 2 / scale
    const bleedY = (height - WORLD.height * scale) / 2 / scale
    const shake = this.reducedMotion ? 0 : this.hurt * this.hurt * 34 * scale
    ctx.translate(
      (width - WORLD.width * scale) / 2 + Math.sin(this.clock * 62) * shake,
      (height - WORLD.height * scale) / 2 + Math.cos(this.clock * 51) * shake,
    )
    ctx.scale(scale, scale)
    ctx.imageSmoothingEnabled = false
    // The scene paints past the playfield so letterbox bars never show as empty margins.
    this.background(bleedX, bleedY)

    const ready = state.status === 'ready'
    const duck = state.duck
    const duckX = ready ? 708 : duck.x
    const duckY = ready ? 235 + (this.reducedMotion ? 0 : Math.sin(this.clock * 2) * 13) : duck.y
    if (state.status !== 'won') {
      if (duck.phase >= 2 && !duck.vulnerable) {
        ctx.strokeStyle = p.warning
        ctx.globalAlpha = 0.4
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(duckX, duckY, 68, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      if (duck.warning) {
        ctx.fillStyle = p.warning
        ctx.font = 'bold 18px Consolas, "Courier New", monospace'
        ctx.textAlign = 'center'
        ctx.fillText('!', duckX, duckY - 78)
      }
      drawDuck(ctx, duckX, duckY, p, {
        scale: ready ? 5.6 : 3.2, time: this.reducedMotion ? 0 : this.clock,
        phase: ready ? 1 : duck.phase, facing: ready ? -1 : duck.facing,
        flash: this.flash > 0 && !this.reducedMotion,
      })
    }

    for (const projectile of state.projectiles) {
      ctx.fillStyle = p.warning
      ctx.fillRect(projectile.position.x - 4, projectile.position.y - 9, 8, 17)
      ctx.fillStyle = p.accent
      ctx.fillRect(projectile.position.x - 3, projectile.position.y + 8, 6, 12)
      ctx.globalAlpha = 0.3
      ctx.strokeStyle = p.warning
      ctx.beginPath()
      ctx.arc(projectile.target.x, projectile.target.y, 14, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    for (const threat of state.threats) this.drawThreat(threat)
    this.drawEffects()
    // Teammates first, so your own crosshair always sits on top of the swarm.
    if (state.coop && state.status === 'running') this.drawTeammates(state)
    if (state.status === 'running' && aim) this.crosshair(aim)
    if (this.hurt > 0) {
      ctx.globalAlpha = Math.min(0.6, this.hurt)
      ctx.strokeStyle = p.danger
      ctx.lineWidth = 24
      ctx.strokeRect(-bleedX, -bleedY, 960 + bleedX * 2, 540 + bleedY * 2)
      ctx.globalAlpha = 1
    }
    if (this.phaseBanner > 0 && state.status === 'running') {
      ctx.globalAlpha = Math.min(1, this.phaseBanner * 2)
      ctx.fillStyle = p.surface
      ctx.fillRect(340, 21, 280, 40)
      ctx.fillStyle = p.accent
      ctx.font = 'bold 17px Consolas, "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`PHASE ${duck.phase + 1}`, 480, 47)
      ctx.globalAlpha = 1
    }
  }

  private background(bleedX: number, bleedY: number) {
    const ctx = this.context
    const p = this.palette
    const left = -bleedX
    const top = -bleedY
    const spanX = 960 + bleedX * 2
    const bottom = 540 + bleedY
    const horizon = 362
    const scatter = (index: number, step: number) => left + (index * step) % spanX
    const drift = this.reducedMotion ? 0 : this.clock

    const sky = ctx.createLinearGradient(0, top, 0, horizon)
    sky.addColorStop(0, p.skyTop)
    sky.addColorStop(1, p.skyBottom)
    ctx.fillStyle = sky
    ctx.fillRect(left, top, spanX, horizon - top)

    if (p.night) {
      ctx.fillStyle = p.star
      for (let i = 0; i < 54; i++) {
        ctx.globalAlpha = 0.35 + (i % 4) * 0.2
        ctx.fillRect(scatter(i, 151), top + (i * 37 + 23) % (270 + bleedY), i % 5 === 0 ? 3 : 2, 2)
      }
      ctx.globalAlpha = 1
    }

    ctx.fillStyle = p.sun
    ctx.globalAlpha = 0.22
    ctx.beginPath()
    ctx.arc(760, 99, 96, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(760, 99, 58, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = p.cloud
    ctx.globalAlpha = p.night ? 0.85 : 0.95
    for (let i = 0; i < 6; i++) {
      const x = left + (i * 235 + drift * 4) % spanX
      const y = 62 + i % 3 * 46
      ctx.fillRect(x, y, 92, 12)
      ctx.fillRect(x + 18, y - 11, 52, 11)
      ctx.fillRect(x + 34, y - 20, 26, 9)
    }
    ctx.globalAlpha = 1

    ctx.fillStyle = p.hillFar
    for (let i = 0; i < 9; i++) {
      const x = left + i * (spanX / 8)
      ctx.beginPath()
      ctx.moveTo(x - 130, horizon)
      ctx.lineTo(x, 246 - (i % 3) * 22)
      ctx.lineTo(x + 130, horizon)
      ctx.closePath()
      ctx.fill()
    }
    ctx.fillStyle = p.hill
    ctx.fillRect(left, 322, spanX, horizon - 322)

    for (let i = 0; i < 17; i++) {
      const x = scatter(i, 97) + 14
      const h = 40 + (i * 79) % 78
      const sway = this.reducedMotion ? 0 : Math.sin(this.clock * 1.4 + i) * 2
      ctx.fillStyle = p.reed
      ctx.fillRect(x + sway, horizon - h, 5, h)
      ctx.fillStyle = p.reedHead
      ctx.fillRect(x - 1 + sway, horizon - h - 3, 7, 16)
    }

    const water = ctx.createLinearGradient(0, horizon, 0, bottom)
    water.addColorStop(0, p.waterTop)
    water.addColorStop(1, p.waterBottom)
    ctx.fillStyle = water
    ctx.fillRect(left, horizon, spanX, bottom - horizon)
    ctx.fillStyle = p.foam
    ctx.globalAlpha = 0.55
    ctx.fillRect(left, horizon, spanX, 3)
    for (let i = 0; i < 46; i++) {
      const x = scatter(i, 119) + (this.reducedMotion ? 0 : Math.sin(this.clock * 0.9 + i) * 11)
      const y = 378 + (i * 41) % 150
      ctx.globalAlpha = 0.2 + (i % 3) * 0.16
      ctx.fillRect(x, y, 16 + i % 4 * 16, 2)
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = p.lily
    for (let i = 0; i < 18; i++) {
      const x = scatter(i, 193)
      const y = 396 + (i * 31) % 112
      ctx.fillRect(x, y, 28, 5)
      ctx.fillRect(x + 5, y - 4, 20, 4)
      ctx.fillRect(x + 9, y + 5, 12, 3)
    }
    ctx.fillStyle = p.bank
    ctx.fillRect(left, bottom - 16, spanX, 16)
    for (let i = 0; i < 52; i++) {
      const x = left + i * 25
      ctx.fillRect(x, bottom - 22, 14, 6)
      ctx.fillRect(x + 16, bottom - 19, 8, 3)
    }
  }

  private drawThreat(threat: Threat) {
    const ctx = this.context
    const p = this.palette
    const { x, y } = threat.position
    const radius = threatRadius(threat)
    const progress = Math.min(1, threat.age / threat.travel)
    const urgent = progress > 0.62
    ctx.strokeStyle = urgent ? p.eggWarn : p.beak
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.5 + progress * 0.5
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.stroke()
    // A second ring closes in on the hit ring so the landing moment is readable without a number.
    ctx.globalAlpha = 0.3
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, radius + (1 - progress) * 46, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
    const s = radius * 0.42
    ctx.fillStyle = p.duckLine
    ctx.fillRect(x - s * 0.85, y - s * 1.25, s * 1.7, s * 2.5)
    ctx.fillRect(x - s * 1.25, y - s * 0.75, s * 2.5, s * 1.7)
    ctx.fillStyle = urgent ? p.eggWarn : p.egg
    ctx.fillRect(x - s * 0.7, y - s * 1.1, s * 1.4, s * 2.2)
    ctx.fillRect(x - s * 1.1, y - s * 0.6, s * 2.2, s * 1.4)
    ctx.fillStyle = p.duck
    ctx.fillRect(x - s * 0.55, y - s * 0.75, s * 0.5, s * 0.9)
  }

  private crosshair(point: Point) {
    const ctx = this.context
    ctx.strokeStyle = this.palette.accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(point.x, point.y, 15, 0, Math.PI * 2)
    ctx.moveTo(point.x - 22, point.y); ctx.lineTo(point.x - 8, point.y)
    ctx.moveTo(point.x + 8, point.y); ctx.lineTo(point.x + 22, point.y)
    ctx.moveTo(point.x, point.y - 22); ctx.lineTo(point.x, point.y - 8)
    ctx.moveTo(point.x, point.y + 8); ctx.lineTo(point.x, point.y + 22)
    ctx.stroke()
  }

  /**
   * Teammates are drawn as small dimmed marks rather than full crosshairs. With a full room the
   * arena has to stay readable, and your own aim must never be the hardest thing on screen to find.
   */
  private drawTeammates(state: GameState) {
    const ctx = this.context
    const p = this.palette
    ctx.lineWidth = 2
    for (const player of Object.values(state.players)) {
      if (player.id === this.localId) continue
      const down = player.hp === 0
      ctx.globalAlpha = down ? 0.16 : player.trigger ? 0.62 : 0.34
      ctx.strokeStyle = down ? p.muted : player.trigger ? p.warning : p.success
      const { x, y } = player.aim
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, Math.PI * 2)
      ctx.moveTo(x - 13, y); ctx.lineTo(x - 10, y)
      ctx.moveTo(x + 10, y); ctx.lineTo(x + 13, y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  private drawEffects() {
    const ctx = this.context
    const p = this.palette
    for (const effect of this.effects) {
      const duration = effect.kind === 'number' ? 0.8 : 0.45
      const fade = Math.max(0, 1 - effect.age / duration)
      if (effect.kind === 'number') {
        // Only your own damage gets a number. Fifty players' worth would bury the duck in text.
        if (!effect.mine) continue
        ctx.globalAlpha = fade
        ctx.font = 'bold 20px Consolas, "Courier New", monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = p.accent
        ctx.fillText(`-${effect.amount}`, effect.x, effect.y - 62 - (this.reducedMotion ? 0 : effect.age * 55))
      } else {
        ctx.globalAlpha = effect.mine ? fade : fade * 0.4
        ctx.fillStyle = effect.kind === 'miss' ? p.muted : effect.kind === 'block' ? p.success : p.warning
        const radius = this.reducedMotion ? 10 : effect.kind === 'explosion' ? 15 + effect.age * 185 : 7 + effect.age * 45
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4
          const size = (effect.kind === 'explosion' ? 8 : 4) * (effect.mine ? 1 : 0.6)
          ctx.fillRect(effect.x + Math.cos(angle) * radius, effect.y + Math.sin(angle) * radius, size, size)
        }
      }
    }
    ctx.globalAlpha = 1
  }
}
