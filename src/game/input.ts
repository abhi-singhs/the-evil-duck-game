import { WORLD } from './config'
import type { Point } from './types'

export type ArenaRect = { left: number; top: number; width: number; height: number }

export function worldPoint(client: Point, rect: ArenaRect): Point | null {
  const scale = Math.min(rect.width / WORLD.width, rect.height / WORLD.height)
  if (scale <= 0) return null
  const offsetX = (rect.width - WORLD.width * scale) / 2
  const offsetY = (rect.height - WORLD.height * scale) / 2
  const x = (client.x - rect.left - offsetX) / scale
  const y = (client.y - rect.top - offsetY) / scale
  return x < 0 || x > WORLD.width || y < 0 || y > WORLD.height ? null : { x, y }
}
