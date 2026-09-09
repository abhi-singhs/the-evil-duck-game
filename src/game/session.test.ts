import { describe, expect, it } from 'vitest'
import { BOSS_HP } from './config'
import { LocalSession } from './session'

describe('local session', () => {
  it('does not expose mutable authoritative state', () => {
    const session = new LocalSession(42)
    const snapshot = session.snapshot()
    snapshot.duck.hp = 0
    expect(session.snapshot().duck.hp).toBe(BOSS_HP)
  })

  it('simulates equal active time equally at different frame rates', () => {
    const fast = new LocalSession(42)
    const slow = new LocalSession(42)
    fast.start(); slow.start()
    for (let i = 0; i < 600; i++) fast.advance(1 / 60)
    for (let i = 0; i < 300; i++) slow.advance(1 / 30)
    expect(fast.snapshot()).toEqual(slow.snapshot())
  })

  it('pauses on a frame stall, clears held fire, and resumes without catch-up shots', () => {
    const session = new LocalSession(42)
    session.start()
    session.command({ playerId: 'local', sequence: 0, aim: { x: 480, y: 240 }, trigger: true, weapon: 'pistol' })
    session.advance(2)
    expect(session.snapshot().status).toBe('paused')
    expect(session.snapshot().elapsed).toBe(0)
    expect(session.snapshot().players.local.trigger).toBe(false)
    session.advance(50)
    session.resume()
    session.advance(1 / 60)
    expect(session.snapshot().elapsed).toBe(1 / 60)
    expect(session.snapshot().players.local.shots).toBe(0)
  })

  it('restarting with a new session resets all fight state', () => {
    const previous = new LocalSession(42)
    previous.start()
    previous.advance(0.3)
    const next = new LocalSession(42)
    expect(next.snapshot().tick).toBe(0)
    expect(next.snapshot().players.local.unlocked).toEqual(['pistol'])
    expect(next.snapshot().players.local.heat).toBe(0)
    expect(next.snapshot().projectiles).toEqual([])
  })
})
