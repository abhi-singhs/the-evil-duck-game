import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from '../audio/AudioEngine'
import type { Settings } from '../storage'
import { WEAPONS, WEAPON_ORDER, WORLD } from './config'
import { worldPoint } from './input'
import { GameRenderer } from './renderer'
import { LocalSession } from './session'
import type { GameSession } from './session'
import { createPlayer } from './simulation'
import type { GameEvent, GameState, Point, WeaponId } from './types'

const READY_NOTICE = 'The duck is waiting. It does not look patient.'

export function useGame(
  settings: Settings,
  onComplete: (state: GameState) => void,
  provided?: GameSession,
) {
  // A co-op session is created by an event handler and owned by the caller, so this hook never
  // opens or closes a socket. Solo play gets a local session and keeps it for the component's life.
  const [active] = useState<GameSession>(() => provided ?? new LocalSession())
  const [state, setState] = useState(() => active.snapshot())
  const [notice, setNotice] = useState(READY_NOTICE)
  const [error, setError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<GameRenderer | null>(null)
  const audio = useRef<AudioEngine | null>(null)
  const sequence = useRef(0)
  const input = useRef({ aim: { x: WORLD.width / 2, y: 240 }, trigger: false, weapon: 'pistol' as WeaponId })
  const visibleAim = useRef<Point | null>(null)
  const activePointer = useRef<number | null>(null)
  const keys = useRef(new Set<string>())
  const settingsRef = useRef(settings)

  const localPlayer = useCallback((snapshot: GameState) => {
    const id = active.playerId
    return Object.hasOwn(snapshot.players, id) ? snapshot.players[id] : createPlayer(id)
  }, [active])

  const clearInput = useCallback(() => {
    input.current.trigger = false
    activePointer.current = null
    keys.current.clear()
  }, [])

  const pause = useCallback(() => {
    active.pause()
    clearInput()
    if (active.canPause) audio.current?.setPlaying(false)
    setState(active.snapshot())
  }, [active, clearInput])

  const resetInput = useCallback(() => {
    sequence.current = 0
    input.current = { aim: { x: WORLD.width / 2, y: 240 }, trigger: false, weapon: 'pistol' }
    clearInput()
    visibleAim.current = null
    renderer.current?.reset()
  }, [clearInput])

  const start = useCallback(() => {
    audio.current?.unlock()
    const status = active.snapshot().status
    if (status === 'paused') {
      active.resume()
    } else if (status === 'ready') {
      resetInput()
      active.start()
      setNotice('Hunt started. Aim at the duck and hold to fire.')
    } else {
      resetInput()
      active.restart()
      setNotice('Hunt started. Aim at the duck and hold to fire.')
    }
    audio.current?.setPlaying(true)
    setState(active.snapshot())
    canvas.current?.focus({ preventScroll: true })
  }, [active, resetInput])

  const selectWeapon = useCallback((weapon: WeaponId) => {
    const snapshot = active.snapshot()
    if (snapshot.status !== 'running') return
    if (!localPlayer(snapshot).unlocked.includes(weapon)) {
      setNotice(`${WEAPONS[weapon].name} unlocks at ${Math.round(WEAPONS[weapon].unlock * 100)}% damage.`)
      return
    }
    input.current.weapon = weapon
    setNotice(`${WEAPONS[weapon].name} equipped. ${WEAPONS[weapon].description}`)
  }, [active, localPlayer])

  useEffect(() => {
    settingsRef.current = settings
    audio.current?.setSettings(settings)
    renderer.current?.setReducedMotion(settings.reducedMotion)
  }, [settings])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    if (!element.getContext('2d')) {
      setError('Your browser could not start the game canvas. Try a browser with Canvas 2D support.')
      return
    }
    const view = new GameRenderer(element)
    view.setReducedMotion(settingsRef.current.reducedMotion)
    view.setLocalPlayer(active.playerId)
    renderer.current = view
    const sound = new AudioEngine(setError)
    sound.setSettings(settingsRef.current)
    audio.current = sound
    let animationId = 0
    let previous = performance.now()
    let lastHud = 0

    const handleEvents = (events: GameEvent[]) => {
      const me = active.playerId
      view.push(events)
      for (const event of events) {
        // In a fifty-player room every teammate's shot would arrive as noise, so audio and
        // messages stay personal while the arena still shows everyone's work.
        if (event.type === 'shot' && event.playerId === me) sound.playShot(event.weapon)
        if (event.type === 'intercept' && event.playerId === me) sound.playCue('block')
        if (event.type === 'hurt' && event.playerId === me) {
          sound.playCue('hurt')
          setNotice(event.hp > 0
            ? `Hit. ${event.hp} health left. Shoot the duck's attacks before they reach you.`
            : 'You are down.')
        }
        if (event.type === 'unlock' && event.playerId === me) {
          sound.playCue('unlock')
          setNotice(`${WEAPONS[event.weapon].name} unlocked. Select it below or press ${WEAPON_ORDER.indexOf(event.weapon) + 1}.`)
        }
        if (event.type === 'phase') {
          sound.playCue('phase')
          setNotice(`Phase ${event.phase + 1}. ${event.phase >= 2 ? 'Armor is up. Watch for vulnerable windows.' : 'The duck is getting faster.'}`)
        }
        if (event.type === 'end') {
          const final = active.snapshot()
          sound.playCue(event.won ? 'win' : 'lose')
          sound.setPlaying(false)
          clearInput()
          onComplete(final)
          setNotice(event.won
            ? 'Duck defeated. The pond is yours.'
            : localPlayer(final).hp === 0 ? 'You were shot down.' : 'Time expired. The duck wins this round.')
        }
      }
    }

    const tick = (now: number) => {
      const seconds = (now - previous) / 1000
      previous = now
      const current = active.snapshot()
      if (current.status === 'running') {
        const speed = 440 * Math.min(seconds, 0.05)
        const held = keys.current
        if (held.size) {
          const aim = input.current.aim
          aim.x = Math.max(0, Math.min(WORLD.width, aim.x + (Number(held.has('d') || held.has('arrowright')) - Number(held.has('a') || held.has('arrowleft'))) * speed))
          aim.y = Math.max(0, Math.min(WORLD.height, aim.y + (Number(held.has('s') || held.has('arrowdown')) - Number(held.has('w') || held.has('arrowup'))) * speed))
          visibleAim.current = { ...aim }
        }
        active.command({ playerId: active.playerId, sequence: sequence.current++, ...input.current })
      }
      const events = active.advance(seconds)
      handleEvents(events)
      const snapshot = active.snapshot()
      if (snapshot.status === 'paused' && current.status === 'running') {
        clearInput()
        sound.setPlaying(false)
        setNotice('The game paused after a frame interruption. Resume when ready.')
      }
      view.draw(snapshot, seconds, visibleAim.current)
      if (now - lastHud > 80 || events.length || snapshot.status !== current.status) {
        setState(snapshot)
        lastHud = now
      }
      animationId = requestAnimationFrame(tick)
    }
    animationId = requestAnimationFrame(tick)

    const aimAt = (event: PointerEvent) => {
      const point = worldPoint({ x: event.clientX, y: event.clientY }, element.getBoundingClientRect())
      if (point) {
        input.current.aim = point
        visibleAim.current = point
      }
      return point
    }
    const down = (event: PointerEvent) => {
      if (active.snapshot().status !== 'running' || activePointer.current !== null
        || (event.pointerType === 'mouse' && event.button !== 0) || !aimAt(event)) return
      event.preventDefault()
      element.focus({ preventScroll: true })
      audio.current?.unlock()
      activePointer.current = event.pointerId
      element.setPointerCapture(event.pointerId)
      input.current.trigger = true
    }
    const move = (event: PointerEvent) => {
      if (activePointer.current === event.pointerId || (event.pointerType === 'mouse' && activePointer.current === null)) {
        if (!aimAt(event)) input.current.trigger = false
      }
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId !== activePointer.current) return
      input.current.trigger = false
      activePointer.current = null
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    }
    const leave = () => { if (activePointer.current === null) visibleAim.current = null }
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || event.target instanceof HTMLInputElement) return
      const key = event.key.toLowerCase()
      if (key === 'escape' || (key === ' ' && (event.target === element || event.target === document.body))) {
        event.preventDefault()
        if (event.repeat) return
        const status = active.snapshot().status
        if (status === 'running') pause()
        else if (status === 'paused') start()
        return
      }
      if (active.snapshot().status !== 'running') return
      const weapon = WEAPON_ORDER[Number(key) - 1]
      if (weapon) selectWeapon(weapon)
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'f'].includes(key)) {
        event.preventDefault()
        keys.current.add(key)
        if (key === 'f') input.current.trigger = true
      }
    }
    const keyup = (event: KeyboardEvent) => {
      keys.current.delete(event.key.toLowerCase())
      if (event.key.toLowerCase() === 'f') input.current.trigger = false
    }
    const visibility = () => { if (document.hidden) pause() }
    const themeObserver = new MutationObserver(() => view.refreshPalette())
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('lostpointercapture', up)
    element.addEventListener('pointerleave', leave)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      cancelAnimationFrame(animationId)
      clearInput()
      sound.dispose()
      themeObserver.disconnect()
      renderer.current = null
      audio.current = null
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('lostpointercapture', up)
      element.removeEventListener('pointerleave', leave)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', pause)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [active, clearInput, localPlayer, onComplete, pause, selectWeapon, start])

  return {
    state,
    player: localPlayer(state),
    session: active,
    canvas,
    notice,
    error,
    start,
    pause,
    selectWeapon,
  }
}
