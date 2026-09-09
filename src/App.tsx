import { useState } from 'react'
import { DuckIcon, SoundIcon, WeaponIcon } from './components/Icons'
import { Modal } from './components/Modal'
import { BOSS_HP, WEAPONS, WEAPON_ORDER } from './game/config'
import { useGame } from './game/useGame'
import { formatCountdown } from './game/format'
import { useSave } from './useSave'

type Panel = 'help' | 'settings' | 'credits'
const number = (value: number) => Math.round(value).toLocaleString('en-US')

export default function App() {
  const { settings, best, storageWarning, setSettings, recordResult } = useSave()
  const [panel, setPanel] = useState<Panel | null>(null)
  const { state, canvas, notice, error, start, pause, selectWeapon } = useGame(settings, recordResult)
  const player = state.players.local
  const remaining = state.duration - state.elapsed
  const complete = state.status === 'won' || state.status === 'lost'
  const health = state.duck.hp / state.duck.maxHp

  const open = (kind: Panel) => {
    if (state.status === 'running') pause()
    setPanel(kind)
  }

  return (
    <main className="app">
      <header className="bar">
        <span className="wordmark"><span className="brand-duck"><DuckIcon /></span>THE EVIL DUCK</span>
        <div className="bar-actions">
          <button className="icon-button" onClick={() => open('help')} aria-label="How to play">?</button>
          <button className="icon-button" aria-pressed={settings.muted} aria-label={settings.muted ? 'Unmute' : 'Mute'}
            onClick={() => setSettings({ ...settings, muted: !settings.muted })}><SoundIcon muted={settings.muted} /></button>
          <button className="icon-button" onClick={() => open('settings')} aria-label="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6m8 4v6" /></svg>
          </button>
        </div>
      </header>

      <section className="game">
        <div className="hud">
          <div className="health">
            <div className="health-track" role="progressbar" aria-label="Duck health"
              aria-valuemin={0} aria-valuemax={state.duck.maxHp} aria-valuenow={state.duck.hp}>
              <div className="health-fill" style={{ transform: `scaleX(${health})` }} />
            </div>
            <span className="health-readout">
              <span>{number(state.duck.hp)} HP</span>
              <span className="phase-chip">LV {state.duck.phase + 1}</span>
            </span>
          </div>
          <span className={`timer ${remaining <= 20 ? 'urgent' : ''}`} aria-label={`${Math.ceil(remaining)} seconds left`}>
            {formatCountdown(remaining)}
          </span>
          <span className="lives" role="img" aria-label={`Your health: ${player.hp} of ${player.maxHp}`}>
            {Array.from({ length: player.maxHp }, (_, index) => (
              <span key={index} className={index < player.hp ? 'life' : 'life spent'} />
            ))}
          </span>
          <button className="icon-button" onClick={pause} disabled={state.status !== 'running'} aria-label="Pause">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          </button>
        </div>

        <div className="arena-wrap">
          <canvas ref={canvas} className="arena" tabIndex={0}
            aria-label="Arena. Aim and hold to shoot. Keyboard: arrows to aim, F to shoot." />
          <div className="scanlines" aria-hidden="true" />

          {state.status !== 'running' && <div className={`overlay ${state.status === 'ready' ? 'overlay-start' : ''}`}>
            {state.status === 'ready' && <>
              <h1>Small duck.<br /> Big <span>problem.</span></h1>
              <button className="primary-button" onClick={start}>START</button>
            </>}
            {state.status === 'paused' && <>
              <h1>Paused</h1>
              <button className="primary-button" onClick={start}>RESUME</button>
              <p>Esc to resume</p>
            </>}
            {complete && <>
              <h1>{state.status === 'won' ? 'Duck down.' : player.hp === 0 ? 'Shot down.' : 'Out of time.'}</h1>
              <dl className="stats">
                <div><dt>Damage</dt><dd>{number(player.damage)}</dd></div>
                <div><dt>Blocked</dt><dd>{player.blocked}</dd></div>
                <div>
                  <dt>{state.status === 'won' ? 'Time' : 'Duck left'}</dt>
                  <dd>{state.status === 'won' ? `${state.elapsed.toFixed(1)}s` : `${Math.round(health * 100)}%`}</dd>
                </div>
              </dl>
              <button className="primary-button" onClick={start}>PLAY AGAIN</button>
            </>}
          </div>}

          {player.overheated && state.status === 'running' && <span className="heat-alert">OVERHEATED</span>}
        </div>

        <div className="weapons">
          {WEAPON_ORDER.map((id, index) => {
            const weapon = WEAPONS[id]
            const threshold = BOSS_HP * weapon.unlock
            const unlocked = player.unlocked.includes(id)
            const selected = player.weapon === id
            return (
              <button key={id} className={`weapon ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked'}`}
                aria-pressed={selected} disabled={!unlocked || state.status !== 'running'}
                aria-label={unlocked ? weapon.name : `${weapon.name}, locked until ${number(threshold)} damage`}
                onPointerDown={(event) => { if (event.pointerType === 'touch') { event.preventDefault(); selectWeapon(id) } }}
                onClick={() => selectWeapon(id)}>
                <WeaponIcon weapon={id} />
                <span className="weapon-name">{weapon.name}</span>
                <span className="weapon-note">{unlocked ? <kbd>{index + 1}</kbd> : `${number(threshold)} dmg`}</span>
                {unlocked
                  ? id === 'blaster' && <span className="meter"><span style={{ transform: `scaleX(${player.heat / 100})` }} className="meter-heat" /></span>
                  : <span className="meter"><span style={{ transform: `scaleX(${Math.min(1, player.damage / threshold)})` }} /></span>}
              </button>
            )
          })}
        </div>
      </section>

      <footer className="bar">
        <span className="best">BEST {best.fastest !== null ? `${best.fastest.toFixed(1)}s` : `${number(best.damage)} dmg`}</span>
        <button className="link-button" onClick={() => open('credits')}>Credits</button>
      </footer>

      <p className="sr-only" role="status" aria-live="polite">{notice}</p>
      {(error || storageWarning) && <p className="warning" role="alert">{error ?? storageWarning}</p>}

      {panel && <Modal title={panel === 'help' ? 'How to play' : panel === 'settings' ? 'Settings' : 'Credits'} onClose={() => setPanel(null)}>
        {panel === 'help' && <div className="prose">
          <p>Empty the duck's 26,000 HP before the clock runs out. Five hits and you are done.</p>
          <p>Aim and hold to shoot: mouse, touch, or arrow keys with F. Press 1 to 4 to switch weapons, Esc to pause.</p>
          <p>The duck throws eggs at you. Shoot one before its ring closes or you lose a life. Eggs block your shots, so clear them first.</p>
          <p>Damage unlocks the shotgun, blaster, and rockets. Lead your rockets, and let the blaster cool before it overheats.</p>
          <p>Every 30 seconds the duck evolves: faster, angrier, and armored. Wait for the ring to drop before committing.</p>
        </div>}
        {panel === 'settings' && <div className="settings">
          <label>Music <span>{Math.round(settings.musicVolume * 100)}%</span>
            <input type="range" min="0" max="1" step="0.05" value={settings.musicVolume}
              onChange={(event) => setSettings({ ...settings, musicVolume: Number(event.target.value) })} /></label>
          <label>Effects <span>{Math.round(settings.sfxVolume * 100)}%</span>
            <input type="range" min="0" max="1" step="0.05" value={settings.sfxVolume}
              onChange={(event) => setSettings({ ...settings, sfxVolume: Number(event.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={settings.muted}
            onChange={(event) => setSettings({ ...settings, muted: event.target.checked })} /><span>Mute</span></label>
          <label className="check"><input type="checkbox" checked={settings.reducedMotion}
            onChange={(event) => setSettings({ ...settings, reducedMotion: event.target.checked })} /><span>Reduce motion</span></label>
        </div>}
        {panel === 'credits' && <div className="prose">
          <p>Music: <a href="https://ericskiff.com/music/" target="_blank" rel="noreferrer">Eric Skiff</a>, "Chibi Ninja" from Resistor Anthems, used unchanged under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.</p>
          <p>Pixel art and sound effects are original to this game.</p>
        </div>}
      </Modal>}
    </main>
  )
}
