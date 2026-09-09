import { describe, expect, it } from 'vitest'
import { formatCountdown } from './format'
import { worldPoint } from './input'

describe('input coordinate conversion', () => {
  it('maps a scaled desktop arena to the same logical world', () => {
    expect(worldPoint({ x: 580, y: 320 }, { left: 100, top: 50, width: 960, height: 540 })).toEqual({ x: 480, y: 270 })
    expect(worldPoint({ x: 340, y: 185 }, { left: 100, top: 50, width: 480, height: 270 })).toEqual({ x: 480, y: 270 })
  })
  it('accounts for portrait letterboxing and rejects touches on its empty margins', () => {
    const rect = { left: 0, top: 0, width: 360, height: 360 }
    expect(worldPoint({ x: 180, y: 180 }, rect)).toEqual({ x: 480, y: 270 })
    expect(worldPoint({ x: 180, y: 20 }, rect)).toBe(null)
    expect(worldPoint({ x: 180, y: 340 }, rect)).toBe(null)
  })
  it('accounts for wide landscape pillarboxing', () => {
    expect(worldPoint({ x: 480, y: 200 }, { left: 0, top: 0, width: 960, height: 400 })).toEqual({ x: 480, y: 270 })
    expect(worldPoint({ x: 0, y: 200 }, { left: 0, top: 0, width: 960, height: 400 })).toBe(null)
  })
})

describe('countdown formatting', () => {
  it.each([[120, '2:00'], [119.9, '2:00'], [119, '1:59'], [60.1, '1:01'], [60, '1:00'], [0.1, '0:01'], [0, '0:00']])('formats %f as %s', (input, output) => {
    expect(formatCountdown(Number(input))).toBe(output)
  })
})
