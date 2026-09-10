import { createServer, get } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScoreboardRuntime } from './runtime.mjs'

let game
let origin
let respond
let requests
let runtimes

const room = (code, score = 0) => ({
  code,
  status: 'running',
  duck: { hp: 26_000, maxHp: 26_000 },
  players: [{ id: 'p0', name: 'Host', score }],
})

function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function runtime(settings = {}) {
  const instance = createScoreboardRuntime({
    origin,
    pollMs: 60_000,
    heartbeatMs: 60_000,
    fetchTimeoutMs: 1000,
    ...settings,
  })
  runtimes.push(instance)
  return instance
}

async function cached(panel) {
  const response = await fetch(new URL('state', panel.url))
  expect(response.status).toBe(200)
  return response.json()
}

async function events(panel) {
  return new Promise((resolve, reject) => {
    const request = get(new URL('events', panel.url), (response) => {
      const frames = []
      let buffer = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        buffer += chunk
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end)
          frames.push(frame.startsWith('data: ') ? JSON.parse(frame.slice(6)) : frame)
          buffer = buffer.slice(end + 2)
        }
      })
      const closed = new Promise((done) => response.once('close', done))
      resolve({ frames, closed })
    })
    request.once('error', reject)
  })
}

beforeEach(async () => {
  requests = []
  runtimes = []
  respond = (request, response) => json(response, room(request.url.split('/')[3]))
  game = createServer((request, response) => {
    requests.push(request.url)
    respond(request, response)
  })
  await new Promise((resolve, reject) => {
    game.once('error', reject)
    game.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${game.address().port}`
})

afterEach(async () => {
  try {
    await Promise.all(runtimes.map((instance) => instance.dispose()))
  } finally {
    await new Promise((resolve) => {
      game.close(resolve)
      game.closeAllConnections()
    })
  }
})

describe('scoreboard runtime', () => {
  it('requires an explicit origin instead of falling back to production', () => {
    expect(() => createScoreboardRuntime()).toThrow('Set GAME_ORIGIN')
    expect(() => createScoreboardRuntime({ origin: '' })).toThrow('Set GAME_ORIGIN')
    expect(() => createScoreboardRuntime({ origin: `${origin}/api` })).toThrow('HTTP(S) origin')
    expect(() => createScoreboardRuntime({ origin: 'file:///game' })).toThrow('HTTP(S) origin')
  })

  it('polls room JSON from the configured origin and publishes updates over SSE', async () => {
    const board = runtime({ origin: `${origin}/`, pollMs: 25, heartbeatMs: 25 })
    const panel = await board.openPanel('scoreboard', { code: ' ab12 ' })
    const endpoint = `${origin}/api/rooms/AB12/players`
    expect(panel).toMatchObject({ title: 'Room AB12', status: endpoint })
    expect(new URL(panel.url).hostname).toBe('127.0.0.1')
    expect(await cached(panel)).toEqual({
      code: 'AB12',
      origin,
      endpoint,
      fetchedAt: expect.any(String),
      error: null,
      body: room('AB12'),
    })
    expect(Number.isNaN(Date.parse((await cached(panel)).fetchedAt))).toBe(false)
    const stream = await events(panel)
    respond = (_request, response) => json(response, room('AB12', 321))
    await vi.waitFor(() => {
      expect(stream.frames.some((frame) => frame.body?.players[0].score === 321)).toBe(true)
      expect(stream.frames).toContain(': ping')
    })
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.every((path) => path === '/api/rooms/AB12/players')).toBe(true)
    const html = await fetch(panel.url)
    expect(await html.text()).toContain("new EventSource('events')")
  })

  it('shows a blank room without fetching and clears data when the code becomes invalid', async () => {
    const board = runtime()
    const panel = await board.openPanel('blank')
    expect(panel).toMatchObject({ title: 'Duck scoreboard', status: 'Waiting for a room code' })
    expect(await board.readState('blank')).toEqual({
      code: null,
      origin,
      endpoint: `${origin}/api/rooms/:code/players`,
      fetchedAt: null,
      error: expect.objectContaining({ kind: 'empty', title: 'Pick a room' }),
      body: null,
    })
    expect(requests).toEqual([])
    await board.watchRoom('blank', 'AB12')
    expect(await board.watchRoom('blank', '../not-a-room')).toMatchObject({
      code: null,
      fetchedAt: null,
      body: null,
      error: { kind: 'empty', title: 'Pick a room' },
    })
    expect(requests).toEqual(['/api/rooms/AB12/players'])
  })

  it('keeps missing-room JSON and reports 404 as an empty state', async () => {
    respond = (_request, response) => json(response, { error: 'no-room' }, 404)
    const board = runtime()
    const panel = await board.openPanel('missing', { code: 'LOST' })
    expect(await cached(panel)).toEqual({
      code: 'LOST',
      origin,
      endpoint: `${origin}/api/rooms/LOST/players`,
      fetchedAt: expect.any(String),
      error: expect.objectContaining({ kind: 'empty', title: 'No room called LOST' }),
      body: { error: 'no-room' },
    })
  })

  it('keeps HTTP failures visible with the returned JSON', async () => {
    respond = (_request, response) => json(response, { error: 'unavailable' }, 503)
    const board = runtime()
    const panel = await board.openPanel('unavailable', { code: 'AB12' })
    expect(await cached(panel)).toMatchObject({
      error: { kind: 'error', title: 'The server answered 503', detail: `${origin}/api/rooms/AB12/players` },
      body: { error: 'unavailable' },
      fetchedAt: expect.any(String),
    })
  })

  it('reports invalid JSON instead of keeping a successful response', async () => {
    const board = runtime()
    await board.openPanel('bad-json', { code: 'AB12' })
    respond = (_request, response) => response.writeHead(200).end('<html>Not JSON</html>')
    expect(await board.readState('bad-json')).toMatchObject({
      origin,
      endpoint: `${origin}/api/rooms/AB12/players`,
      fetchedAt: null,
      body: null,
      error: { kind: 'error', title: 'Invalid JSON from the game server', detail: expect.stringContaining(origin) },
    })
  })

  it('reports malformed scoreboard JSON before the renderer can treat it as a room', async () => {
    respond = (_request, response) => json(response, { error: 'wrong-service' })
    const board = runtime()
    const panel = await board.openPanel('bad-body', { code: 'AB12' })
    expect(await cached(panel)).toMatchObject({
      body: { error: 'wrong-service' },
      error: { kind: 'error', title: 'Invalid scoreboard response' },
    })
  })

  it('reports network failures and recovers on the next read', async () => {
    const board = runtime()
    await board.openPanel('network', { code: 'AB12' })
    respond = (_request, response) => response.destroy()
    expect(await board.readState('network')).toMatchObject({
      body: null,
      fetchedAt: null,
      error: { kind: 'error', title: 'Cannot reach the game server', detail: expect.stringContaining(origin) },
    })
    respond = (_request, response) => json(response, room('AB12', 50))
    expect(await board.readState('network')).toMatchObject({ error: null, body: room('AB12', 50) })
  })

  it('aborts timed-out requests and shows the timeout', async () => {
    let disconnected = false
    respond = (_request, response) => {
      response.on('close', () => { disconnected = true })
    }
    const board = runtime({ fetchTimeoutMs: 40 })
    const panel = await board.openPanel('timeout', { code: 'AB12' })
    expect(await cached(panel)).toMatchObject({
      body: null,
      fetchedAt: null,
      error: { kind: 'error', detail: expect.stringContaining('The request timed out') },
    })
    await vi.waitFor(() => expect(disconnected).toBe(true))
  })

  it('switches rooms without allowing an old in-flight body to overwrite state or SSE', async () => {
    const board = runtime()
    const panel = await board.openPanel('switch', { code: 'AB12' })
    const stream = await events(panel)
    let oldResponse
    let disconnected = false
    respond = (request, response) => {
      if (request.url.includes('OLD1')) {
        oldResponse = response
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write('{"code":"OLD1","players":[')
        response.on('close', () => { disconnected = true })
      } else {
        json(response, room('NEW2', 99))
      }
    }
    const oldRead = board.watchRoom('switch', 'OLD1')
    await vi.waitFor(() => expect(oldResponse).toBeDefined())
    expect(await cached(panel)).toMatchObject({
      code: 'OLD1', body: null, fetchedAt: null, error: { title: 'Loading room OLD1' },
    })
    const next = await board.watchRoom('switch', 'NEW2')
    oldResponse.end(']}')
    expect(next).toMatchObject({ code: 'NEW2', error: null, body: room('NEW2', 99) })
    expect((await oldRead).code).toBe('NEW2')
    await vi.waitFor(() => {
      expect(disconnected).toBe(true)
      expect(stream.frames.some((frame) => frame.body?.code === 'NEW2')).toBe(true)
    })
    expect(await cached(panel)).toMatchObject({
      code: 'NEW2',
      endpoint: `${origin}/api/rooms/NEW2/players`,
      error: null,
      body: room('NEW2', 99),
    })
    expect(stream.frames.some((frame) => frame.body?.code === 'OLD1')).toBe(false)
  })

  it('handles concurrent opens, reopens, and closes idempotently', async () => {
    const board = runtime()
    const [first, second] = await Promise.all([
      board.openPanel('same', { code: 'AB12' }),
      board.openPanel('same', { code: 'AB12' }),
    ])
    expect(second).toEqual(first)
    expect(requests).toHaveLength(1)
    await board.watchRoom('same', 'NEW2')
    expect(await board.openPanel('same')).toMatchObject({ url: first.url, title: 'Room NEW2' })
    expect(await board.openPanel('same', { code: '' })).toMatchObject({ title: 'Room NEW2' })
    expect(await board.openPanel('same', { code: 'AB12' })).toMatchObject({ url: first.url, title: 'Room AB12' })
    await Promise.all([board.closePanel('same'), board.closePanel('same')])
    await board.closePanel('same')
    await expect(board.readState('same')).rejects.toMatchObject({ code: 'canvas_not_open' })
    await expect(board.watchRoom('same', 'AB12')).rejects.toMatchObject({ code: 'canvas_not_open' })
    const reopened = await board.openPanel('same')
    expect(reopened.title).toBe('Duck scoreboard')
    expect((await cached(reopened)).error.title).toBe('Pick a room')
  })

  it('accepts renderer room changes and rejects malformed config JSON without changing the room', async () => {
    const board = runtime()
    const panel = await board.openPanel('config', { code: 'AB12' })
    const switched = await fetch(new URL('config', panel.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'new2' }),
    })
    expect(await switched.json()).toMatchObject({ code: 'NEW2', error: null, body: room('NEW2') })
    const malformed = await fetch(new URL('config', panel.url), { method: 'POST', body: '{' })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { kind: 'error', title: 'Scoreboard request failed' } })
    expect((await cached(panel)).code).toBe('NEW2')
  })

  it('cancels an in-flight fetch when the panel closes and rejects the pending read', async () => {
    const board = runtime()
    const panel = await board.openPanel('closing', { code: 'AB12' })
    let pendingResponse
    let disconnected = false
    respond = (_request, response) => {
      pendingResponse = response
      response.on('close', () => { disconnected = true })
    }
    const reading = board.readState('closing')
    const rejected = expect(reading).rejects.toMatchObject({ code: 'canvas_not_open' })
    await vi.waitFor(() => expect(pendingResponse).toBeDefined())
    await board.closePanel('closing')
    await rejected
    await vi.waitFor(() => expect(disconnected).toBe(true))
    pendingResponse.end(JSON.stringify(room('AB12', 1000)))
    await expect(fetch(panel.url)).rejects.toThrow()
    const reopened = await board.openPanel('closing')
    expect(await cached(reopened)).toMatchObject({ code: null, body: null, fetchedAt: null })
  })

  it('closes SSE and HTTP connections and stops polling every panel on disposal', async () => {
    const board = runtime({ pollMs: 25, heartbeatMs: 25 })
    const [first, second] = await Promise.all([
      board.openPanel('one', { code: 'AB12' }),
      board.openPanel('two', { code: 'NEW2' }),
    ])
    const [firstStream, secondStream] = await Promise.all([events(first), events(second)])
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(2))
    await Promise.all([board.dispose(), board.dispose()])
    await Promise.all([firstStream.closed, secondStream.closed])
    const count = requests.length
    await delay(100)
    expect(requests).toHaveLength(count)
    await expect(fetch(first.url)).rejects.toThrow()
    await expect(fetch(second.url)).rejects.toThrow()
    await expect(board.openPanel('one')).rejects.toMatchObject({ code: 'runtime_disposed' })
    await board.closePanel('one')
  })

  it('closes a panel even when its initial open has not finished', async () => {
    const board = runtime()
    const opening = board.openPanel('early', { code: 'AB12' })
    const rejected = expect(opening).rejects.toMatchObject({ code: 'canvas_not_open' })
    await board.closePanel('early')
    await rejected
    expect(requests).toEqual([])
    expect((await board.openPanel('early')).title).toBe('Duck scoreboard')
  })
})
