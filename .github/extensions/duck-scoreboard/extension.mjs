import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension'
import { createScoreboardRuntime } from './runtime.mjs'

const CANVAS_ID = 'duck-scoreboard'
const CANVAS_NAME = 'Duck scoreboard'
const CANVAS_DESCRIPTION = 'Open a live scoreboard for a Duck room.'
const GAME_ORIGIN = process.env.GAME_ORIGIN?.trim() || ''

const runtimeEntries = new Map()
const panelOrigins = new Map()
const queues = new Map()
let session

function queue(instanceId, task) {
  const previous = queues.get(instanceId) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(task)
  const completion = run.then(() => undefined, () => undefined)
  queues.set(instanceId, completion)
  return run.finally(() => {
    if (queues.get(instanceId) === completion) queues.delete(instanceId)
  })
}

function normalizeOrigin(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    return null
  }
  return parsed.origin
}

function originError(message) {
  return new CanvasError('missing_origin', message)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function explicitOrigin(value) {
  if (value === undefined || value === null || value === '') return null
  const normalized = normalizeOrigin(value)
  if (!normalized) {
    throw new CanvasError('invalid_origin', 'Origin must be an HTTP(S) origin like http://127.0.0.1:18082.')
  }
  return normalized
}

function resolveOrigin(instanceId, inputOrigin) {
  return explicitOrigin(inputOrigin)
    ?? panelOrigins.get(instanceId)
    ?? normalizeOrigin(GAME_ORIGIN)
}

function runtimeFor(origin) {
  let entry = runtimeEntries.get(origin)
  if (entry) {
    entry.refs += 1
    return entry
  }
  entry = {
    origin,
    runtime: createScoreboardRuntime({ origin }),
    refs: 1,
  }
  runtimeEntries.set(origin, entry)
  return entry
}

async function releaseRuntime(origin) {
  const entry = runtimeEntries.get(origin)
  if (!entry) return
  entry.refs -= 1
  if (entry.refs > 0) return
  runtimeEntries.delete(origin)
  await entry.runtime.dispose()
}

async function cleanupPanel(instanceId, origin) {
  const entry = runtimeEntries.get(origin)
  if (!entry) return
  try {
    await entry.runtime.closePanel(instanceId)
  } catch (error) {
    if (!(error && typeof error === 'object' && (error.code === 'canvas_not_open' || error.code === 'runtime_disposed'))) {
      throw error
    }
  } finally {
    await releaseRuntime(origin)
  }
}

function openInput(value) {
  const input = typeof value === 'object' && value !== null ? value : {}
  return {
    origin: typeof input.origin === 'string' ? input.origin : undefined,
    code: typeof input.code === 'string' ? input.code : undefined,
  }
}

async function openPanel(instanceId, value) {
  return queue(instanceId, async () => {
    const input = openInput(value)
    const origin = resolveOrigin(instanceId, input.origin)
    if (!origin) {
      throw originError('Provide an origin in the canvas input or set GAME_ORIGIN before opening duck-scoreboard.')
    }

    const existingOrigin = panelOrigins.get(instanceId)
    const code = input.code ? input.code : undefined

    if (existingOrigin === origin) {
      const entry = runtimeEntries.get(origin)
      if (!entry) {
        throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
      }
      return entry.runtime.openPanel(instanceId, code ? { code } : {})
    }

    const entry = runtimeFor(origin)
    try {
      const result = await entry.runtime.openPanel(instanceId, code ? { code } : {})
      panelOrigins.set(instanceId, origin)
      if (existingOrigin) {
        try {
          await cleanupPanel(instanceId, existingOrigin)
        } catch (error) {
          await session?.log?.(`Failed to release the previous scoreboard runtime for ${instanceId}: ${errorMessage(error)}`, { level: 'warning', ephemeral: true })
        }
      }
      return result
    } catch (error) {
      await releaseRuntime(origin)
      throw error
    }
  })
}

async function watchRoom(instanceId, code) {
  return queue(instanceId, async () => {
    const origin = panelOrigins.get(instanceId)
    if (!origin) {
      throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
    }
    const entry = runtimeEntries.get(origin)
    if (!entry) {
      throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
    }
    return entry.runtime.watchRoom(instanceId, code)
  })
}

async function readScoreboard(instanceId) {
  return queue(instanceId, async () => {
    const origin = panelOrigins.get(instanceId)
    if (!origin) {
      throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
    }
    const entry = runtimeEntries.get(origin)
    if (!entry) {
      throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
    }
    return entry.runtime.readState(instanceId)
  })
}

async function closePanel(instanceId) {
  return queue(instanceId, async () => {
    const origin = panelOrigins.get(instanceId)
    if (!origin) return
    panelOrigins.delete(instanceId)
    await cleanupPanel(instanceId, origin)
  })
}

const scoreboardCanvas = createCanvas({
  id: CANVAS_ID,
  displayName: CANVAS_NAME,
  description: CANVAS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      origin: {
        type: 'string',
        description: 'Explicit scoreboard origin, such as http://127.0.0.1:18082.',
      },
      code: {
        type: 'string',
        description: 'Optional room code. Leave blank for a blank scoreboard.',
      },
    },
    additionalProperties: false,
  },
  actions: [
    {
      name: 'watch_room',
      description: 'Switch the scoreboard panel to a room code.',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Room code to watch. Empty string clears the room.',
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
      handler: async ({ instanceId, input }) => watchRoom(instanceId, input?.code),
    },
    {
      name: 'read_scoreboard',
      description: 'Read the current scoreboard state for this panel.',
      handler: async ({ instanceId }) => readScoreboard(instanceId),
    },
  ],
  open: async ({ instanceId, input }) => openPanel(instanceId, input),
  onClose: async ({ instanceId }) => closePanel(instanceId),
})

session = await joinSession({
  canvases: [scoreboardCanvas],
  canvasProvider: {
    id: CANVAS_ID,
    name: CANVAS_NAME,
  },
  requestCanvasRenderer: true,
})
