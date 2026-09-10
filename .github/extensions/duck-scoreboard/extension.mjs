import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension'
import { GAME_ORIGIN } from './config.mjs'
import { createScoreboardRuntime } from './runtime.mjs'

const codeSchema = {
  type: 'string',
  description: 'Four-character room join code, for example ABCD.',
  pattern: '^[A-Za-z0-9]{4}$',
}

let runtime

// The runtime binds loopback servers and timers, so build it on the first open.
function scoreboard() {
  runtime ??= createScoreboardRuntime({ origin: GAME_ORIGIN })
  return runtime
}

function fail(error) {
  if (error instanceof CanvasError) throw error
  throw new CanvasError(error?.code ?? 'scoreboard_failed', error?.message ?? String(error))
}

const canvas = createCanvas({
  id: 'duck-scoreboard',
  displayName: 'Duck scoreboard',
  description: 'Live player scores for one Evil Duck room, polled from the demo game server.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { code: codeSchema },
  },
  actions: [
    {
      name: 'watch_room',
      description: 'Point the open scoreboard at a room code and fetch that room now.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['code'],
        properties: { code: codeSchema },
      },
      handler: async (ctx) => {
        try {
          return await scoreboard().watchRoom(ctx.instanceId, ctx.input?.code)
        } catch (error) {
          fail(error)
        }
      },
    },
    {
      name: 'read_scoreboard',
      description: 'Read the current scoreboard state, including empty and error states.',
      handler: async (ctx) => {
        try {
          return await scoreboard().readState(ctx.instanceId)
        } catch (error) {
          fail(error)
        }
      },
    },
  ],
  open: async (ctx) => {
    try {
      return await scoreboard().openPanel(ctx.instanceId, ctx.input)
    } catch (error) {
      fail(error)
    }
  },
  onClose: async (ctx) => {
    await runtime?.closePanel(ctx.instanceId)
  },
})

await joinSession({
  canvases: [canvas],
  hooks: {
    onSessionEnd: async () => {
      await runtime?.dispose()
    },
  },
})
