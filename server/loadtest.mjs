/**
 * Opens a full room against a running server and reports what fifty players actually cost.
 *
 *   node server/index.mjs
 *   node server/loadtest.mjs            # defaults to 50 clients on ws://localhost:8080/ws
 *   CLIENTS=50 URL=ws://host/ws node server/loadtest.mjs
 */
import { WebSocket } from 'ws'

const url = process.env.URL ?? 'ws://localhost:8080/ws'
const clients = Number(process.env.CLIENTS ?? 50)
const seconds = Number(process.env.SECONDS ?? 20)
const commandHz = Number(process.env.COMMAND_HZ ?? 20)

const stats = { snapshots: 0, bytes: 0, events: 0, errors: [], joined: 0, refused: 0 }
const sockets = []
let room = null

function open(index) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url)
    let id = null
    let sequence = 0
    let timer = null

    socket.on('open', () => socket.send(JSON.stringify({
      t: 'join', room, name: `Bot ${index}`, token: null,
    })))

    socket.on('message', (data) => {
      stats.bytes += data.length
      const message = JSON.parse(data.toString())
      if (message.t === 'welcome') {
        id = message.playerId
        room ??= message.room
        stats.joined++
        socket.send(JSON.stringify({ t: 'ready', value: true }))
        // Every bot sweeps the arena and holds the trigger, which is the worst realistic case.
        timer = setInterval(() => {
          const t = Date.now() / 1000 + index
          socket.send(JSON.stringify({
            t: 'cmd', sequence: sequence++,
            aim: { x: Math.round(480 + Math.sin(t) * 300), y: Math.round(240 + Math.cos(t * 1.3) * 120) },
            trigger: true, weapon: 'pistol',
          }))
        }, 1000 / commandHz)
        resolve({ socket, id })
      }
      if (message.t === 'snapshot') stats.snapshots++
      if (message.t === 'events') stats.events += message.events.length
      if (message.t === 'ping') socket.send(JSON.stringify({ t: 'pong' }))
      if (message.t === 'error') {
        stats.errors.push(message.code)
        if (message.code === 'room-full') stats.refused++
        resolve({ socket, id: null })
      }
    })

    socket.on('close', () => { if (timer) clearInterval(timer) })
    socket.on('error', (error) => {
      stats.errors.push(error.message)
      resolve({ socket, id: null })
    })
    sockets.push(socket)
  })
}

const started = Date.now()
const first = await open(0)
for (let i = 1; i < clients; i++) await open(i)
console.log(`joined ${stats.joined}/${clients} in room ${room} (${Date.now() - started}ms)`)

// The first socket in is the host.
first.socket.send(JSON.stringify({ t: 'start' }))
const measureFrom = Date.now()
stats.snapshots = 0
stats.bytes = 0

await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
const elapsed = (Date.now() - measureFrom) / 1000

console.log([
  `clients          ${stats.joined}`,
  `measured         ${elapsed.toFixed(1)}s`,
  `snapshots        ${stats.snapshots} (${(stats.snapshots / elapsed / Math.max(1, stats.joined)).toFixed(1)} Hz per client)`,
  `events           ${stats.events}`,
  `server to client ${(stats.bytes / elapsed / 1024 / 1024 * 8).toFixed(2)} Mbps total, ` +
  `${(stats.bytes / elapsed / Math.max(1, stats.joined) / 1024).toFixed(1)} KB/s per client`,
  `errors           ${stats.errors.length ? [...new Set(stats.errors)].join(', ') : 'none'}`,
].join('\n'))

for (const socket of sockets) socket.close()
process.exit(0)
