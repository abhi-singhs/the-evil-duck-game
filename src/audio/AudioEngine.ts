type AudioSettings = {
  musicVolume: number
  sfxVolume: number
  muted: boolean
}

type Voice = {
  source: OscillatorNode | AudioBufferSourceNode
  nodes: AudioNode[]
  started: boolean
  terminal: boolean
}

type PlayAttempt = { cancelled: boolean }
type ContextOperation = { active: boolean }

export class AudioEngine {
  private readonly onError: (message: string) => void
  private readonly reportedErrors = new Set<string>()
  private readonly voices = new Set<Voice>()
  private music: HTMLAudioElement | null = null
  private context: AudioContext | null = null
  private output: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private playAttempt: PlayAttempt | null = null
  private contextOperation: ContextOperation | null = null
  private settings: AudioSettings = { musicVolume: 0.18, sfxVolume: 0.35, muted: false }
  private playing = false
  private disposed = false

  constructor(onError: (message: string) => void) {
    this.onError = onError
  }

  unlock(): void {
    if (this.disposed) return

    if (!this.music) {
      try {
        const music = new Audio(`${import.meta.env.BASE_URL}audio/chibi-ninja.mp3`)
        music.loop = true
        music.preload = 'auto'
        music.addEventListener('error', this.handleMusicError)
        this.music = music
        this.applyVolumes()
      } catch (error) {
        this.report('Background music could not initialize.', error)
      }
    }

    if (!this.context) {
      try {
        const AudioContextClass = window.AudioContext
          ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioContextClass) {
          this.report('This browser does not support Web Audio sound effects.')
        } else {
          this.context = new AudioContextClass()
          this.output = this.context.createGain()
          this.output.connect(this.context.destination)
          this.applyVolumes()
        }
      } catch (error) {
        this.report('Sound effects could not initialize.', error)
        this.output?.disconnect()
        this.output = null
        const context = this.context
        this.context = null
        if (context) this.closeContext(context)
      }
    }

    // Both calls must reach the browser before the user gesture ends.
    this.requestContext(true, true)
    this.startMusic(true)
  }

  setPlaying(playing: boolean): void {
    if (this.disposed) return
    const wasPlaying = this.playing
    this.playing = playing
    if (playing) {
      if (!wasPlaying) this.stopVoices()
      this.applyVolumes()
      this.startMusic()
    } else {
      this.pauseMusic()
      // Finish an already scheduled end cue, but stop gameplay sounds immediately.
      this.stopVoices(true)
      this.applyVolumes()
    }
    this.syncContext()
  }

  setSettings(settings: AudioSettings): void {
    if (this.disposed) return
    this.settings = {
      musicVolume: this.volume(settings.musicVolume, this.settings.musicVolume),
      sfxVolume: this.volume(settings.sfxVolume, this.settings.sfxVolume),
      muted: settings.muted,
    }
    this.applyVolumes()
    if (this.settings.muted || this.settings.sfxVolume === 0) this.stopVoices()
    this.syncContext()
  }

  playShot(weapon: 'pistol' | 'shotgun' | 'blaster' | 'rocket'): void {
    if (!this.canPlayEffects()) return
    try {
      switch (weapon) {
        case 'pistol':
          this.tone('square', 380, 95, 0.09, 0.16)
          this.noise(0.055, 0.18, 1800, 'highpass')
          break
        case 'shotgun':
          this.noise(0.19, 0.3, 1400, 'lowpass')
          this.tone('triangle', 130, 38, 0.2, 0.28)
          break
        case 'blaster':
          this.tone('sawtooth', 1200, 180, 0.12, 0.12)
          this.tone('square', 620, 100, 0.075, 0.06)
          break
        case 'rocket':
          this.noise(0.38, 0.3, 650, 'lowpass')
          this.tone('triangle', 160, 28, 0.4, 0.32)
          break
      }
    } catch (error) {
      this.stopVoices()
      this.report('A weapon sound could not play.', error)
    }
  }

  playCue(cue: 'hit' | 'unlock' | 'phase' | 'win' | 'lose' | 'block' | 'hurt'): void {
    if (!this.canPlayEffects()) return
    try {
      const notes = {
        hit: [860, 480],
        block: [980, 1240],
        hurt: [300, 190, 120],
        unlock: [523.25, 659.25, 783.99, 1046.5],
        phase: [220, 277.18, 220, 349.23],
        win: [523.25, 659.25, 783.99, 1046.5, 1318.51],
        lose: [392, 349.23, 293.66, 196],
      }[cue]
      const step = cue === 'hit' || cue === 'block' ? 0.025 : cue === 'lose' ? 0.14 : cue === 'hurt' ? 0.06 : 0.09
      notes.forEach((frequency, index) => {
        this.tone(
          cue === 'lose' || cue === 'hit' || cue === 'hurt' ? 'triangle' : 'square',
          frequency,
          cue === 'hit' ? frequency / 2 : frequency,
          step * 1.4,
          cue === 'hit' ? 0.12 : cue === 'hurt' ? 0.2 : 0.085,
          index * step,
          cue === 'win' || cue === 'lose',
        )
      })
    } catch (error) {
      this.stopVoices()
      this.report('A game cue could not play.', error)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.playing = false
    this.pauseMusic()
    if (this.music) {
      this.music.removeEventListener('error', this.handleMusicError)
      this.music.removeAttribute('src')
      this.music.load()
      this.music = null
    }
    this.stopVoices()
    this.output?.disconnect()
    this.output = null
    this.noiseBuffer = null
    const context = this.context
    this.context = null
    this.contextOperation = null
    if (context) this.closeContext(context)
  }

  private readonly handleMusicError = (): void => {
    if (this.disposed || !this.music?.error) return
    const error = this.music.error
    const reasons: Record<number, string> = {
      1: 'The browser aborted the music download.',
      2: 'The music download failed. Check your connection and reload.',
      3: 'The browser could not decode the music file.',
      4: 'The music file is unavailable or its format is unsupported.',
    }
    this.report(reasons[error.code] ?? 'Background music failed.', error.message)
  }

  private startMusic(prime = false): void {
    const music = this.music
    if (this.disposed || !music || this.playAttempt || (!prime && !this.playing)) return
    if (!music.paused && !music.ended) return
    this.applyVolumes()
    const attempt: PlayAttempt = { cancelled: false }
    this.playAttempt = attempt
    try {
      void music.play().then(
        () => {
          if (this.playAttempt === attempt) this.playAttempt = null
          if (this.disposed || attempt.cancelled || music !== this.music) return
          if (!this.playing) this.pauseMusic()
        },
        (error: unknown) => this.handlePlayFailure(attempt, error),
      )
    } catch (error) {
      this.handlePlayFailure(attempt, error)
    }
  }

  private handlePlayFailure(attempt: PlayAttempt, error: unknown): void {
    if (this.playAttempt === attempt) this.playAttempt = null
    if (this.disposed || (attempt.cancelled && this.errorName(error) === 'AbortError')) return
    this.report(
      this.errorName(error) === 'NotAllowedError'
        ? 'The browser blocked music. Press Start or Resume, or interact with the arena to retry.'
        : 'Background music could not play.',
      error,
    )
  }

  private pauseMusic(): void {
    if (this.playAttempt) {
      this.playAttempt.cancelled = true
      this.playAttempt = null
    }
    this.music?.pause()
  }

  private syncContext(): void {
    this.requestContext(this.effectsActive())
  }

  private requestContext(active: boolean, fromGesture = false): void {
    const context = this.context
    if (this.disposed || !context) return
    if (context.state === 'closed') {
      this.report('The browser closed the sound effects device. Reload to restore sound effects.')
      return
    }
    if (!fromGesture && this.contextOperation?.active === active) return
    if (!fromGesture && !this.contextOperation && context.state === (active ? 'running' : 'suspended')) return
    const operation: ContextOperation = { active }
    this.contextOperation = operation
    try {
      const result = active ? context.resume() : context.suspend()
      void result.then(
        () => {
          if (this.disposed || this.context !== context) return
          if (this.contextOperation === operation) this.contextOperation = null
          this.syncContext()
        },
        (error: unknown) => {
          if (this.contextOperation === operation) this.contextOperation = null
          if (!this.disposed) this.report(`Sound effects could not ${active ? 'resume' : 'pause'}.`, error)
        },
      )
    } catch (error) {
      if (this.contextOperation === operation) this.contextOperation = null
      this.report(`Sound effects could not ${active ? 'resume' : 'pause'}.`, error)
    }
  }

  private applyVolumes(): void {
    if (this.music) {
      this.music.volume = this.settings.musicVolume
      // Unlock may prime playback before setPlaying(true), without an audible start.
      this.music.muted = this.settings.muted || !this.playing
    }
    if (this.output) {
      this.output.gain.value = this.effectsActive() ? this.settings.sfxVolume : 0
    }
  }

  private closeContext(context: AudioContext): void {
    if (context.state === 'closed') return
    try {
      void context.close().catch((error: unknown) => {
        if (this.errorName(error) !== 'InvalidStateError' || context.state !== 'closed') {
          this.report('The audio device could not close.', error)
        }
      })
    } catch (error) {
      this.report('The audio device could not close.', error)
    }
  }

  private canPlayEffects(): boolean {
    return !this.disposed && this.playing && !this.settings.muted
      && this.settings.sfxVolume > 0 && this.context?.state === 'running' && this.output !== null
  }

  private effectsActive(): boolean {
    if (this.disposed || this.settings.muted || this.settings.sfxVolume === 0) return false
    return this.playing || [...this.voices].some((voice) => voice.terminal)
  }

  private tone(
    type: OscillatorType, frequency: number, endFrequency: number,
    duration: number, level: number, delay = 0, terminal = false,
  ): void {
    const context = this.context
    if (!context || !this.output) return
    const source = context.createOscillator()
    source.type = type
    const start = context.currentTime + delay
    source.frequency.setValueAtTime(frequency, start)
    source.frequency.exponentialRampToValueAtTime(endFrequency, start + duration)
    this.scheduleVoice(source, [], start, duration, level, terminal)
  }

  private noise(duration: number, level: number, cutoff: number, type: BiquadFilterType): void {
    const context = this.context
    if (!context || !this.output) return
    if (!this.noiseBuffer) {
      this.noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.5), context.sampleRate)
      const samples = this.noiseBuffer.getChannelData(0)
      for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1
    }
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = context.createBiquadFilter()
    filter.type = type
    filter.frequency.value = cutoff
    this.scheduleVoice(source, [filter], context.currentTime, duration, level)
  }

  private scheduleVoice(
    source: Voice['source'], filters: AudioNode[], start: number, duration: number, level: number,
    terminal = false,
  ): void {
    const context = this.context
    if (!context || !this.output) return
    const oldest = this.voices.values().next().value
    if (this.voices.size >= 32 && oldest) this.stopVoice(oldest)
    const envelope = context.createGain()
    const voice: Voice = { source, nodes: [...filters, envelope], started: false, terminal }
    this.voices.add(voice)
    source.onended = () => this.releaseVoice(voice)
    let previous: AudioNode = source
    for (const node of voice.nodes) {
      previous.connect(node)
      previous = node
    }
    envelope.connect(this.output)
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(level, start + 0.004)
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration)
    envelope.gain.linearRampToValueAtTime(0, start + duration + 0.008)
    source.start(start)
    voice.started = true
    source.stop(start + duration + 0.01)
  }

  private stopVoice(voice: Voice): void {
    if (voice.started) voice.source.stop()
    this.releaseVoice(voice)
  }

  private releaseVoice(voice: Voice): void {
    voice.source.onended = null
    voice.source.disconnect()
    for (const node of voice.nodes) node.disconnect()
    this.voices.delete(voice)
    if (voice.terminal && !this.playing && !this.disposed) {
      this.applyVolumes()
      this.syncContext()
    }
  }

  private stopVoices(preserveTerminal = false): void {
    for (const voice of this.voices) {
      if (!preserveTerminal || !voice.terminal) this.stopVoice(voice)
    }
  }

  private volume(value: number, previous: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : previous
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : ''
  }

  private report(message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    const text = detail ? `${message} ${detail}` : message
    if (this.reportedErrors.has(text)) return
    this.reportedErrors.add(text)
    this.onError(text)
  }
}
