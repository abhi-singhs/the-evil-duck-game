import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension'
import { GAME_ORIGIN } from './config.mjs'
import { createScoreboardRuntime } from './runtime.mjs'

const panels = new Map()

function panelFor(instanceId) {
  const panel = panels.get(instanceId)
  if (!panel) throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
  return panel
}

await joinSession({
  canvases: [
    createCanvas({
      id: 'duck-scoreboard',
      displayName: 'Duck scoreboard',
      description: 'Live scores and health from the configured duck game server.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Four-character room code. Leave empty to pick a room later.' },
          origin: { type: 'string', description: 'Optional HTTP(S) origin override. Open a new panel to change servers.' },
        },
        additionalProperties: false,
      },
      actions: [
        {
          name: 'watch_room',
          description: 'Watch another room. An empty code clears the scoreboard.',
          inputSchema: {
            type: 'object',
            properties: { code: { type: 'string' } },
            required: ['code'],
            additionalProperties: false,
          },
          handler: (ctx) => panelFor(ctx.instanceId).runtime.watchRoom(ctx.instanceId, ctx.input.code),
        },
        {
          name: 'read_scoreboard',
          description: 'Fetch and return the current room scoreboard.',
          handler: (ctx) => panelFor(ctx.instanceId).runtime.readState(ctx.instanceId),
        },
      ],
      open: async (ctx) => {
        let panel = panels.get(ctx.instanceId)
        const origin = ctx.input?.origin || panel?.origin || GAME_ORIGIN
        if (!origin) throw new CanvasError('missing_origin', 'Configure GAME_ORIGIN or supply an origin when opening the canvas.')
        if (panel && panel.origin !== origin) {
          throw new CanvasError('origin_changed', 'Open a new scoreboard panel to watch a different server.')
        }
        if (!panel) {
          panel = { origin, runtime: createScoreboardRuntime({ origin }) }
          panels.set(ctx.instanceId, panel)
        }
        try {
          return await panel.runtime.openPanel(ctx.instanceId, ctx.input)
        } catch (error) {
          if (panels.get(ctx.instanceId) === panel) panels.delete(ctx.instanceId)
          await panel.runtime.dispose()
          throw error
        }
      },
      onClose: async (ctx) => {
        const panel = panels.get(ctx.instanceId)
        if (!panel) return
        panels.delete(ctx.instanceId)
        await panel.runtime.dispose()
      },
    }),
  ],
})
