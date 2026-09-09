import { WebSocketServer } from 'ws'
import {
  COMMAND_RATE_LIMIT, ERROR_TEXT, MAX_MESSAGE_BYTES, PING_INTERVAL, PING_TIMEOUT, ROOM_CAP, STEP,
  filterEvents, parseClientMessage,
} from './core/game-core.mjs'
import { RoomRegistry } from './rooms.mjs'

const SWEEP_INTERVAL = 30_000

/**
 * The authoritative side of the game. Clients send aim, trigger, and weapon; the server owns the
 * clock, the duck, hit detection, and health. Nothing a client sends carries damage or boss health,
 * so a tampered browser can only lie about where it is pointing.
 */
export function attachGameServer(httpServer, options = {}) {
  const registry = new RoomRegistry(options)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  const sockets = new Map()

  const send = (socket, message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }
  const fail = (socket, code) => send(socket, { t: 'error', code, message: ERROR_TEXT[code] })

  const broadcastLobby = (room) => {
    const message = room.lobbyMessage()
    for (const member of room.members.values()) {
      if (member.send) member.send({ ...message, waiting: member.waiting })
    }
  }

  const leave = (socket) => {
    const context = sockets.get(socket)
    // Always close: a client that sends `leave` and then holds the connection open would otherwise
    // slip out of the `sockets` map and past the heartbeat reaper, one leaked socket per attempt.
    socket.close()
    if (!context) return
    sockets.delete(socket)
    const { room, playerId } = context
    if (!room) return
    room.disconnect(playerId)
    broadcastLobby(room)
  }

  function handleJoin(socket, message) {
    const context = sockets.get(socket)
    if (!context || context.room) return fail(socket, 'already-joined')
    const resolved = registry.resolve(message.room)
    if (resolved.error) return fail(socket, resolved.error)
    const room = resolved.room
    const joined = room.join(message.name, { token: message.token })
    if (joined.error) {
      // A brand new room nobody could use is worse than no room at all.
      if (message.room === null) registry.rooms.delete(room.code)
      return fail(socket, joined.error)
    }
    const member = joined.member
    member.send = (payload) => send(socket, payload)
    context.room = room
    context.playerId = member.id
    send(socket, {
      t: 'welcome', playerId: member.id, room: room.code, cap: ROOM_CAP,
      token: member.token, rejoined: joined.rejoined,
    })
    broadcastLobby(room)
    if (room.status === 'running' && !member.waiting) {
      const snapshot = room.snapshotFor(member.id)
      if (snapshot) send(socket, snapshot)
    }
  }

  wss.on('connection', (socket) => {
    sockets.set(socket, { room: null, playerId: null, alive: true, lastSeen: Date.now() })

    socket.on('message', (data, isBinary) => {
      const context = sockets.get(socket)
      if (!context) return
      context.lastSeen = Date.now()
      if (isBinary) return fail(socket, 'bad-message')
      const message = parseClientMessage(data.toString())
      if (!message) return fail(socket, 'bad-message')
      const { room, playerId } = context
      switch (message.t) {
        case 'join':
          return handleJoin(socket, message)
        case 'pong':
          context.alive = true
          return
        case 'ready':
          if (!room) return
          room.setReady(playerId, message.value)
          return broadcastLobby(room)
        case 'start': {
          if (!room) return
          const result = room.start(playerId)
          if (result.error) return fail(socket, result.error)
          if (result.started) broadcastLobby(room)
          return
        }
        case 'cmd': {
          if (!room) return
          const member = room.member(playerId)
          if (!member) return
          // Commands go out at 20 Hz. Anything far above that is a bug or an attack, not a fast player.
          const now = Date.now()
          const window = member.commandWindow
          if (now - window.start >= 1000) {
            window.start = now
            window.count = 0
          }
          if (++window.count > COMMAND_RATE_LIMIT) {
            if (window.count === COMMAND_RATE_LIMIT + 1) fail(socket, 'rate-limit')
            return
          }
          room.command(playerId, message)
          return
        }
        case 'leave':
          return leave(socket)
        default:
          return fail(socket, 'bad-message')
      }
    })

    socket.on('close', () => leave(socket))
    socket.on('error', () => leave(socket))
  })

  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, 'http://localhost')
    if (pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request))
  })

  // One timer drives every room. Rooms step at a fixed 60 Hz against real elapsed time, so a busy
  // event loop slows the tick rate rather than the fight.
  let previous = process.hrtime.bigint()
  const loop = setInterval(() => {
    const now = process.hrtime.bigint()
    const seconds = Number(now - previous) / 1e9
    previous = now
    for (const room of registry.rooms.values()) {
      const before = room.status
      const events = room.advance(seconds)
      if (events.length) {
        for (const member of room.members.values()) {
          if (!member.send || member.waiting) continue
          // Your own shots, hits, and lives arrive in full. Everyone else's are decoration,
          // and fifty players' decoration is a denial of service on your own connection.
          member.events.push(...filterEvents(events, member.id))
        }
      }
      if (room.shouldBroadcast()) {
        for (const member of room.members.values()) {
          if (!member.send || member.waiting) continue
          const snapshot = room.snapshotFor(member.id)
          if (snapshot) member.send(snapshot)
          if (room.rosterDue) {
            const roster = room.rosterMessage(member.id)
            if (roster) member.send(roster)
          }
          if (member.events.length) {
            member.send({ t: 'events', events: member.events.splice(0, member.events.length) })
          }
        }
      }
      // The run ending and the room returning to the lobby are both roster changes.
      if (room.status !== before) broadcastLobby(room)
    }
  }, Math.round(STEP * 1000))

  const heartbeat = setInterval(() => {
    const cutoff = Date.now() - PING_TIMEOUT
    for (const [socket, context] of sockets) {
      if (context.lastSeen < cutoff) {
        socket.terminate()
        continue
      }
      send(socket, { t: 'ping' })
    }
  }, PING_INTERVAL)

  const sweeper = setInterval(() => registry.sweep(), SWEEP_INTERVAL)

  return {
    registry,
    close() {
      clearInterval(loop)
      clearInterval(heartbeat)
      clearInterval(sweeper)
      for (const socket of sockets.keys()) socket.close(1001, 'server shutting down')
      wss.close()
    },
  }
}
