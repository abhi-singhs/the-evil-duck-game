// Extension: duck-scoreboard
//
// A live view of `GET /api/rooms/:code/players` from the co-op game server. The canvas polls the
// endpoint once a second and pushes the result to its iframe over SSE, so the panel shows the same
// numbers the fight is actually running on, next to the raw JSON that produced them.

import { createServer } from 'node:http'
import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension'
import { renderHtml } from './renderer.mjs'

const DEFAULT_ORIGIN = 'http://127.0.0.1:8080'
const POLL_MS = 1000
const FETCH_TIMEOUT_MS = 2500
/** SSE dies quietly behind some proxies; a comment every so often keeps it honest. */
const HEARTBEAT_MS = 20_000

/** One loopback server, one poll timer, and one set of SSE clients per open panel. */
const instances = new Map()

const normalizeCode = (value) => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^[A-Z0-9]{4}$/.test(code) ? code : null
}

const normalizeOrigin = (value) => {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_ORIGIN
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_ORIGIN
    return url.origin
  } catch {
    return DEFAULT_ORIGIN
  }
}

const endpointFor = (instance) =>
  `${instance.origin}/api/rooms/${instance.code ?? ':code'}/players`

/** What the iframe renders: either a room payload or a reason there isn't one. */
const stateOf = (instance) => ({
  code: instance.code,
  origin: instance.origin,
  endpoint: endpointFor(instance),
  fetchedAt: instance.fetchedAt,
  error: instance.error,
  body: instance.body,
})

function publish(instance) {
  const frame = `data: ${JSON.stringify(stateOf(instance))}\n\n`
  for (const client of instance.clients) client.write(frame)
}

async function poll(instance) {
  if (!instance.code) {
    instance.error = {
      kind: 'empty',
      title: 'Pick a room',
      detail: 'Enter the four-character join code the host is sharing.',
    }
    instance.body = null
    return
  }
  const url = endpointFor(instance)
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    const body = await response.json()
    instance.fetchedAt = new Date().toISOString()
    if (response.status === 404) {
      instance.error = {
        kind: 'empty',
        title: `No room called ${instance.code}`,
        detail: 'Codes expire a minute after the last player leaves.',
      }
      instance.body = body
      return
    }
    if (!response.ok) {
      instance.error = { kind: 'error', title: `The server answered ${response.status}`, detail: url }
      instance.body = body
      return
    }
    instance.error = null
    instance.body = body
  } catch (error) {
    instance.error = {
      kind: 'error',
      title: `Cannot reach ${instance.origin}`,
      detail: `${error.name === 'TimeoutError' ? 'The request timed out' : error.message}. `
        + 'Start the game server with `npm run dev:server`.',
    }
    instance.body = null
  }
}

async function refresh(instance) {
  await poll(instance)
  publish(instance)
  return stateOf(instance)
}

function readBody(request) {
  return new Promise((resolve) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })
  })
}

function route(instance, request, response) {
  const { pathname } = new URL(request.url, 'http://127.0.0.1')

  if (pathname === '/' || pathname === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderHtml())
    return
  }

  if (pathname === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify(stateOf(instance))}\n\n`)
    instance.clients.add(response)
    request.on('close', () => instance.clients.delete(response))
    return
  }

  if (pathname === '/state') {
    response
      .writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      .end(JSON.stringify(stateOf(instance)))
    return
  }

  if (pathname === '/config' && request.method === 'POST') {
    readBody(request).then(async (body) => {
      instance.code = normalizeCode(body.code)
      instance.origin = normalizeOrigin(body.origin)
      const state = await refresh(instance)
      response
        .writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        .end(JSON.stringify(state))
    })
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
}

async function startInstance(instanceId, input) {
  const instance = {
    id: instanceId,
    code: normalizeCode(input?.code),
    origin: normalizeOrigin(input?.origin),
    body: null,
    error: null,
    fetchedAt: null,
    clients: new Set(),
  }
  const server = createServer((request, response) => route(instance, request, response))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  instance.server = server
  instance.url = `http://127.0.0.1:${server.address().port}/`

  // Polling continues while the panel is open, so the view is live without the iframe asking.
  instance.timer = setInterval(() => { refresh(instance).catch(() => {}) }, POLL_MS)
  instance.timer.unref()
  instance.heartbeat = setInterval(() => {
    for (const client of instance.clients) client.write(': ping\n\n')
  }, HEARTBEAT_MS)
  instance.heartbeat.unref()

  await poll(instance)
  return instance
}

/** The panel handle is not the room. Actions and rehydration find the instance, then the room. */
function instanceFor(instanceId) {
  const instance = instances.get(instanceId)
  if (!instance) throw new CanvasError('canvas_not_open', `No open scoreboard for ${instanceId}`)
  return instance
}

await joinSession({
  canvases: [
    createCanvas({
      id: 'duck-scoreboard',
      displayName: 'Duck scoreboard',
      description:
        'Live score and health for everyone in a co-op duck hunt room, read from '
        + 'GET /api/rooms/:code/players on the game server.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Four-character room join code, such as TARH.' },
          origin: {
            type: 'string',
            description: `Game server origin. Defaults to ${DEFAULT_ORIGIN}.`,
          },
        },
        additionalProperties: false,
      },
      actions: [
        {
          name: 'watch_room',
          description: 'Point the open scoreboard at a different room code or game server.',
          inputSchema: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              origin: { type: 'string' },
            },
            additionalProperties: false,
          },
          handler: async (ctx) => {
            const instance = instanceFor(ctx.instanceId)
            if (ctx.input?.code !== undefined) instance.code = normalizeCode(ctx.input.code)
            if (ctx.input?.origin !== undefined) instance.origin = normalizeOrigin(ctx.input.origin)
            return refresh(instance)
          },
        },
        {
          name: 'read_scoreboard',
          description: 'Fetch the room now and return the scoreboard, so the agent can read it too.',
          handler: async (ctx) => refresh(instanceFor(ctx.instanceId)),
        },
      ],
      open: async (ctx) => {
        // Re-entrant: a provider reconnect or a host re-open lands here with the input on file.
        let instance = instances.get(ctx.instanceId)
        if (!instance) {
          instance = await startInstance(ctx.instanceId, ctx.input)
          instances.set(ctx.instanceId, instance)
        } else if (ctx.input?.code) {
          instance.code = normalizeCode(ctx.input.code)
          if (ctx.input.origin) instance.origin = normalizeOrigin(ctx.input.origin)
          await refresh(instance)
        }
        return {
          title: instance.code ? `Room ${instance.code}` : 'Duck scoreboard',
          status: instance.code ? endpointFor(instance) : 'Waiting for a room code',
          url: instance.url,
        }
      },
      onClose: async (ctx) => {
        const instance = instances.get(ctx.instanceId)
        if (!instance) return
        instances.delete(ctx.instanceId)
        clearInterval(instance.timer)
        clearInterval(instance.heartbeat)
        for (const client of instance.clients) client.end()
        await new Promise((resolve) => instance.server.close(() => resolve()))
      },
    }),
  ],
})
