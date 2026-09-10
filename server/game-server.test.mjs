import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { ROOM_CAP } from './core/game-core.mjs'
import { attachGameServer, refuseWithoutUpgrade } from './game-server.mjs'

let http
let game
let url

/** Mirrors how server/index.mjs routes, using the same function it calls. */
function route(request, response) {
  const { pathname } = new URL(request.url, 'http://localhost')
  if (refuseWithoutUpgrade(pathname, response)) return
  response.writeHead(404).end()
}

/** A socket that queues everything it receives, so a test can wait for one message type. */
function client() {
  const socket = new WebSocket(url)
  const inbox = []
  const waiters = []
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString())
    if (message.t === 'ping') return socket.send(JSON.stringify({ t: 'pong' }))
    const index = waiters.findIndex((waiter) => waiter.type === message.t)
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message)
    else inbox.push(message)
  })
  return {
    socket,
    send: (message) => socket.send(JSON.stringify(message)),
    next(type, timeout = 4000) {
      const found = inbox.findIndex((message) => message.t === type)
      if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0])
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeout)
        waiters.push({ type, resolve: (message) => { clearTimeout(timer); resolve(message) } })
      })
    },
    open: () => new Promise((resolve) => socket.once('open', resolve)),
    close: () => socket.close(),
  }
}

async function join(room = null, name = 'Bot') {
  const bot = client()
  await bot.open()
  bot.send({ t: 'join', room, name, token: null })
  return bot
}

beforeAll(async () => {
  http = createServer(route)
  game = attachGameServer(http)
  await new Promise((resolve) => http.listen(0, resolve))
  url = `ws://localhost:${http.address().port}/ws`
})

afterAll(async () => {
  game.close()
  await new Promise((resolve) => http.close(resolve))
})

describe('the websocket endpoint', () => {
  it('creates a room on a join with no code and hands back a code and a token', async () => {
    const host = await join()
    const welcome = await host.next('welcome')
    expect(welcome.room).toMatch(/^[A-Z0-9]{4}$/)
    expect(welcome.token).toEqual(expect.any(String))
    expect(welcome.cap).toBe(ROOM_CAP)
    host.close()
  })

  it('refuses a code nobody is hosting', async () => {
    const lost = await join('QQQQ')
    expect(await lost.next('error')).toMatchObject({ code: 'no-room' })
    lost.close()
  })

  it('rejects a code built from characters it never issues', async () => {
    // The alphabet leaves out B, I, O, S, and Z so a code read aloud cannot be misheard.
    const lost = await join('ZZZZ')
    expect(await lost.next('error')).toMatchObject({ code: 'bad-message' })
    lost.close()
  })

  it('puts two players in the same room and shows each the other', async () => {
    const host = await join()
    const { room } = await host.next('welcome')
    const guest = await join(room, 'Guest')
    await guest.next('welcome')
    const lobby = await guest.next('lobby')
    expect(lobby.members.map((member) => member.name)).toContain('Guest')
    expect(lobby.members).toHaveLength(2)
    host.close()
    guest.close()
  })

  it('lets only the host start the hunt', async () => {
    const host = await join()
    const { room } = await host.next('welcome')
    const guest = await join(room, 'Guest')
    await guest.next('welcome')
    guest.send({ t: 'start' })
    expect(await guest.next('error')).toMatchObject({ code: 'not-host' })
    host.send({ t: 'start' })
    const snapshot = await host.next('snapshot')
    expect(snapshot.run.status).toBe('running')
    expect(snapshot.you).toBeTruthy()
    expect(snapshot.mates).toHaveLength(1)
    host.close()
    guest.close()
  })

  it('runs one duck for everyone in the room', async () => {
    const host = await join()
    const { room } = await host.next('welcome')
    const guest = await join(room, 'Guest')
    await guest.next('welcome')
    host.send({ t: 'start' })
    const [a, b] = await Promise.all([host.next('snapshot'), guest.next('snapshot')])
    expect(a.run.duck.maxHp).toBe(b.run.duck.maxHp)
    // Fixed health regardless of party size: two players share one 26,000 HP duck.
    expect(a.run.duck.maxHp).toBe(26_000)
    host.close()
    guest.close()
  })

  it('rejects a malformed message without dropping the connection', async () => {
    const bot = await join()
    await bot.next('welcome')
    bot.socket.send('{"t":"cmd","aim":"over there"}')
    expect(await bot.next('error')).toMatchObject({ code: 'bad-message' })
    bot.send({ t: 'ready', value: true })
    expect(await bot.next('lobby')).toMatchObject({ status: 'lobby' })
    bot.close()
  })

  it('accepts fifty players and turns the fifty-first away', async () => {
    const host = await join(null, 'Bot 0')
    const { room } = await host.next('welcome')
    const others = []
    for (let i = 1; i < ROOM_CAP; i++) {
      const bot = await join(room, `Bot ${i}`)
      await bot.next('welcome')
      others.push(bot)
    }
    const refused = await join(room, 'Too many')
    expect(await refused.next('error')).toMatchObject({ code: 'room-full' })

    host.send({ t: 'start' })
    const snapshot = await host.next('snapshot')
    expect(snapshot.mates).toHaveLength(ROOM_CAP - 1)
    expect(snapshot.run.players).toBe(ROOM_CAP)

    refused.close()
    host.close()
    for (const bot of others) bot.close()
  }, 20_000)

  it('hands a reconnecting player back the same seat', async () => {
    const host = await join()
    const welcome = await host.next('welcome')
    const guest = await join(welcome.room, 'Guest')
    const guestWelcome = await guest.next('welcome')
    host.send({ t: 'start' })
    await host.next('snapshot')
    guest.close()

    const back = client()
    await back.open()
    back.send({ t: 'join', room: welcome.room, name: 'Guest', token: guestWelcome.token })
    const rejoined = await back.next('welcome')
    expect(rejoined.rejoined).toBe(true)
    expect(rejoined.playerId).toBe(guestWelcome.playerId)
    host.close()
    back.close()
  })

  it('closes a socket that says it is leaving, so it cannot outlive the heartbeat', async () => {
    const bot = await join()
    await bot.next('welcome')
    bot.send({ t: 'leave' })
    await new Promise((resolve) => bot.socket.once('close', resolve))
    expect(bot.socket.readyState).toBe(WebSocket.CLOSED)
  })

  it('answers a plain GET on the game endpoint with 426 rather than the page', async () => {
    // Serving index.html here would make a failed handshake look like a working endpoint, which
    // is exactly how an HTTP/2 client reads it.
    const response = await fetch(`http://localhost:${http.address().port}/ws`)
    expect(response.status).toBe(426)
    expect(response.headers.get('upgrade')).toBe('websocket')
  })

  it('refuses an upgrade on any path but the game endpoint', async () => {
    const stray = new WebSocket(`ws://localhost:${http.address().port}/nope`)
    await new Promise((resolve) => stray.once('error', resolve))
    expect(stray.readyState).toBe(WebSocket.CLOSED)
  })
})
