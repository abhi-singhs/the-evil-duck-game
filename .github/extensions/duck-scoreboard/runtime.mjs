import { createServer } from 'node:http'
import { renderHtml } from './renderer.mjs'

const normalizeCode = (value) => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^[A-Z0-9]{4}$/.test(code) ? code : null
}

const failure = (code, message) => Object.assign(new Error(message), { code })

/**
 * Owns one loopback HTTP server, poll timer, and SSE heartbeat per panel. No SDK registration.
 *
 * createScoreboardRuntime({ origin, pollMs = 1000, fetchTimeoutMs = 2500, heartbeatMs = 20000 })
 * requires an explicit HTTP(S) origin. Tests can supply a local fixture server.
 *
 * openPanel(instanceId, input = {}) -> Promise<{ title, status, url }>
 *   Reuses the panel URL. A truthy input.code selects a room; omitted/empty input preserves it.
 * watchRoom(instanceId, code) -> Promise<State>
 *   Selects a room and fetches it. Invalid/blank codes show "Pick a room" without fetching.
 * readState(instanceId) -> Promise<State>
 *   Fetches now, sharing an in-flight request for the same room.
 * closePanel(instanceId) -> Promise<void>
 *   Idempotently closes the panel. The same id can be opened again after close completes.
 * dispose() -> Promise<void>
 *   Closes every panel and prevents future opens. Call this on adapter shutdown.
 *
 * State is { code, origin, endpoint, fetchedAt, error, body }. fetchedAt is an ISO timestamp
 * for the latest decoded HTTP response, or null if none was decoded. Errors stay visible in
 * error = { kind: 'empty' | 'error', title, detail }; body preserves decoded error responses.
 * Superseded requests return the current room's state without publishing the old response.
 * Closed-panel operations reject with error.code = 'canvas_not_open'. After dispose,
 * openPanel rejects with error.code = 'runtime_disposed'. The adapter can map these to CanvasError.
 * GET /state reads cached state; GET /events streams it; POST /config accepts { code }.
 */
export function createScoreboardRuntime({
  origin,
  pollMs = 1000,
  fetchTimeoutMs = 2500,
  heartbeatMs = 20_000,
} = {}) {
  if (!origin) throw new Error('Set GAME_ORIGIN to the Azure demo origin before opening a scoreboard.')
  const parsedOrigin = new URL(origin)
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)
    || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== '/'
    || parsedOrigin.search || parsedOrigin.hash) {
    throw new Error('The scoreboard origin must be an HTTP(S) origin without a path or credentials.')
  }
  origin = parsedOrigin.origin
  for (const value of [pollMs, fetchTimeoutMs, heartbeatMs]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Scoreboard timer settings must be positive.')
  }

  const instances = new Map()
  let disposal

  const endpointFor = (instance) => `${origin}/api/rooms/${instance.code ?? ':code'}/players`
  const stateOf = (instance) => ({
    code: instance.code,
    origin,
    endpoint: endpointFor(instance),
    fetchedAt: instance.fetchedAt,
    error: instance.error,
    body: instance.body,
  })

  function assertOpen(instance) {
    if (instance.closed) throw failure('canvas_not_open', `No open scoreboard for ${instance.id}`)
  }

  function instanceFor(instanceId) {
    const instance = instances.get(instanceId)
    if (!instance) throw failure('canvas_not_open', `No open scoreboard for ${instanceId}`)
    assertOpen(instance)
    return instance
  }

  function publish(instance) {
    if (instance.closed) return
    const frame = `data: ${JSON.stringify(stateOf(instance))}\n\n`
    for (const client of instance.clients) client.write(frame)
  }

  function cancelRequest(instance) {
    const pending = instance.pending
    instance.pending = null
    if (pending) {
      clearTimeout(pending.timeout)
      pending.controller.abort()
    }
  }

  function selectRoom(instance, value) {
    const code = normalizeCode(value)
    if (instance.code === code) return
    cancelRequest(instance)
    instance.code = code
    instance.body = null
    instance.fetchedAt = null
    instance.error = code
      ? { kind: 'empty', title: `Loading room ${code}`, detail: 'Waiting for the game server response.' }
      : { kind: 'empty', title: 'Pick a room', detail: 'Enter the four-character join code the host is sharing.' }
    publish(instance)
  }

  function refresh(instance) {
    if (instance.closed || !instance.code) return Promise.resolve(stateOf(instance))
    if (instance.pending) return instance.pending.promise
    const code = instance.code
    const url = endpointFor(instance)
    const pending = { controller: new AbortController() }
    instance.pending = pending
    pending.promise = (async () => {
      let body = null
      let error = null
      let fetchedAt = null
      let timedOut = false
      pending.timeout = setTimeout(() => {
        timedOut = true
        pending.controller.abort()
      }, fetchTimeoutMs)
      pending.timeout.unref()
      try {
        const response = await fetch(url, { signal: pending.controller.signal })
        body = await response.json()
        fetchedAt = new Date().toISOString()
        if (response.status === 404) {
          error = {
            kind: 'empty',
            title: `No room called ${code}`,
            detail: 'Codes expire a minute after the last player leaves.',
          }
        } else if (!response.ok) {
          error = { kind: 'error', title: `The server answered ${response.status}`, detail: url }
        } else if (!body || !Array.isArray(body.players)) {
          error = { kind: 'error', title: 'Invalid scoreboard response', detail: `Expected a players array from ${url}.` }
        }
      } catch (cause) {
        error = {
          kind: 'error',
          title: cause instanceof SyntaxError ? 'Invalid JSON from the game server' : 'Cannot reach the game server',
          detail: `${timedOut ? 'The request timed out' : cause.message} (${origin}).`,
        }
      } finally {
        clearTimeout(pending.timeout)
      }
      // A cancelled fetch can finish parsing after a room switch or panel close.
      if (!instance.closed && instance.pending === pending) {
        instance.pending = null
        Object.assign(instance, { body, error, fetchedAt })
        publish(instance)
      }
      return stateOf(instance)
    })()
    return pending.promise
  }

  async function readState(instanceId) {
    const instance = instanceFor(instanceId)
    await instance.ready
    assertOpen(instance)
    await refresh(instance)
    assertOpen(instance)
    return stateOf(instance)
  }

  async function watchRoom(instanceId, code) {
    const instance = instanceFor(instanceId)
    selectRoom(instance, code)
    return readState(instanceId)
  }

  async function route(instance, request, response) {
    try {
      const { pathname } = new URL(request.url, 'http://127.0.0.1')
      if (pathname === '/' || pathname === '/index.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderHtml())
      } else if (pathname === '/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        })
        response.write(`data: ${JSON.stringify(stateOf(instance))}\n\n`)
        instance.clients.add(response)
        response.on('close', () => instance.clients.delete(response))
      } else if (pathname === '/state') {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        }).end(JSON.stringify(stateOf(instance)))
      } else if (pathname === '/config' && request.method === 'POST') {
        let raw = ''
        for await (const chunk of request) raw += chunk
        const input = JSON.parse(raw)
        const state = await watchRoom(instance.id, input?.code)
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          .end(JSON.stringify(state))
      } else {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
      }
    } catch (error) {
      if (response.destroyed) return
      response.writeHead(error instanceof SyntaxError ? 400 : 500, {
        'content-type': 'application/json; charset=utf-8',
      }).end(JSON.stringify({ error: { kind: 'error', title: 'Scoreboard request failed', detail: error.message } }))
    }
  }

  async function startInstance(instance) {
    const server = createServer((request, response) => { void route(instance, request, response) })
    instance.server = server
    server.on('connection', (socket) => {
      instance.sockets.add(socket)
      socket.on('close', () => instance.sockets.delete(socket))
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    if (instance.closed) return
    instance.url = `http://127.0.0.1:${server.address().port}/`
    instance.timer = setInterval(() => { void refresh(instance) }, pollMs)
    instance.timer.unref()
    instance.heartbeat = setInterval(() => {
      for (const client of instance.clients) client.write(': ping\n\n')
    }, heartbeatMs)
    instance.heartbeat.unref()
  }

  async function openPanel(instanceId, input = {}) {
    if (disposal) throw failure('runtime_disposed', 'The scoreboard runtime has been disposed.')
    let instance = instances.get(instanceId)
    const isNew = !instance
    if (isNew) {
      instance = {
        id: instanceId,
        body: null,
        fetchedAt: null,
        clients: new Set(),
        sockets: new Set(),
        closed: false,
      }
      selectRoom(instance, input?.code)
      instances.set(instanceId, instance)
      instance.ready = startInstance(instance)
    } else {
      assertOpen(instance)
      if (input?.code) selectRoom(instance, input.code)
    }
    try {
      await instance.ready
      assertOpen(instance)
      if (isNew || input?.code) await refresh(instance)
      assertOpen(instance)
      return {
        title: instance.code ? `Room ${instance.code}` : 'Duck scoreboard',
        status: instance.code ? endpointFor(instance) : 'Waiting for a room code',
        url: instance.url,
      }
    } catch (error) {
      if (!instance.closed) await closePanel(instanceId)
      throw error
    }
  }

  async function closePanel(instanceId) {
    const instance = instances.get(instanceId)
    if (!instance) return
    if (instance.closing) return instance.closing
    instance.closed = true
    clearInterval(instance.timer)
    clearInterval(instance.heartbeat)
    const pending = instance.pending?.promise
    cancelRequest(instance)
    for (const client of instance.clients) client.end()
    instance.clients.clear()
    for (const socket of instance.sockets) socket.destroy()
    instance.closing = (async () => {
      try {
        await instance.ready
        await pending
      } finally {
        try {
          await new Promise((resolve, reject) => {
            instance.server.close((error) => {
              if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
              else resolve()
            })
            instance.server.closeAllConnections()
          })
        } finally {
          instances.delete(instanceId)
        }
      }
    })()
    return instance.closing
  }

  function dispose() {
    disposal ??= Promise.all([...instances.keys()].map(closePanel)).then(() => {})
    return disposal
  }

  return { openPanel, watchRoom, readState, closePanel, dispose }
}
