import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension'
import { GAME_ORIGIN } from './config.mjs'
import { createScoreboardRuntime } from './runtime.mjs'

const runtimes = new Map()

const codeInput = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: 'Four-character room code. Blank or invalid values show the room picker.',
    },
  },
  additionalProperties: false,
}

function runtimeFor(instanceId) {
  const runtime = runtimes.get(instanceId)
  if (!runtime) throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
  return runtime
}

function asCanvasError(error) {
  if (error instanceof CanvasError) return error
  const code = typeof error?.code === 'string' ? error.code : 'scoreboard_error'
  const message = error instanceof Error ? error.message : 'The scoreboard request failed.'
  return new CanvasError(code, message)
}

async function openScoreboard(ctx) {
  let runtime = runtimes.get(ctx.instanceId)
  if (!runtime) {
    runtime = createScoreboardRuntime({ origin: GAME_ORIGIN })
    runtimes.set(ctx.instanceId, runtime)
  }

  try {
    return await runtime.openPanel(ctx.instanceId, ctx.input)
  } catch (error) {
    runtimes.delete(ctx.instanceId)
    await runtime.dispose()
    throw asCanvasError(error)
  }
}

async function closeScoreboard(ctx) {
  const runtime = runtimes.get(ctx.instanceId)
  if (!runtime) return
  runtimes.delete(ctx.instanceId)
  await runtime.closePanel(ctx.instanceId)
  await runtime.dispose()
}

await joinSession({
  canvases: [
    createCanvas({
      id: 'duck-scoreboard',
      displayName: 'Duck scoreboard',
      description: 'Watch a live duck game scoreboard by room code.',
      inputSchema: codeInput,
      actions: [
        {
          name: 'watch_room',
          description: 'Switch this scoreboard to a room code. Blank or invalid codes show the room picker.',
          inputSchema: {
            ...codeInput,
            required: ['code'],
          },
          handler: async (ctx) => {
            try {
              return await runtimeFor(ctx.instanceId).watchRoom(ctx.instanceId, ctx.input.code)
            } catch (error) {
              throw asCanvasError(error)
            }
          },
        },
        {
          name: 'read_scoreboard',
          description: 'Fetch and return the latest state for this scoreboard.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
          },
          handler: async (ctx) => {
            try {
              return await runtimeFor(ctx.instanceId).readState(ctx.instanceId)
            } catch (error) {
              throw asCanvasError(error)
            }
          },
        },
      ],
      open: openScoreboard,
      onClose: closeScoreboard,
    }),
  ],
})
