import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { attachGameServer, refuseWithoutUpgrade } from './game-server.mjs'

const root = resolve(import.meta.dirname, '..', 'dist')
const port = Number(process.env.PORT ?? 8080)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
}

function cacheFor(pathname) {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  if (pathname.startsWith('/audio/')) return 'public, max-age=86400'
  return 'no-cache'
}

/** Resolves a request path inside dist, or null when it escapes the root. */
function safePath(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const target = resolve(join(root, decoded))
  return target === root || target.startsWith(root + sep) ? target : null
}

async function fileFor(pathname) {
  const target = safePath(pathname === '/' ? '/index.html' : pathname)
  if (!target) return null
  try {
    const info = await stat(target)
    if (info.isFile()) return { target, size: info.size }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
  }
  return null
}

/** Media needs byte ranges: Safari refuses to play the music track without 206 replies. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null
  let start = rawStart ? Number(rawStart) : size - Number(rawEnd)
  let end = rawStart && rawEnd ? Number(rawEnd) : size - 1
  start = Math.max(0, start)
  end = Math.min(size - 1, end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return 'invalid'
  return { start, end }
}

async function handle(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }
  const { pathname } = new URL(request.url, 'http://localhost')
  if (pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  if (refuseWithoutUpgrade(pathname, response)) return

  // Unknown paths fall back to the single page, but a missing asset stays a 404.
  const found = await fileFor(pathname)
    ?? (extname(pathname) ? null : await fileFor('/index.html'))
  if (!found) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
    return
  }

  const headers = {
    'content-type': TYPES[extname(found.target)] ?? 'application/octet-stream',
    'cache-control': cacheFor(pathname),
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  }
  const range = parseRange(request.headers.range, found.size)
  if (range === 'invalid') {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${found.size}` }).end()
    return
  }
  if (range) {
    response.writeHead(206, {
      ...headers,
      'content-range': `bytes ${range.start}-${range.end}/${found.size}`,
      'content-length': range.end - range.start + 1,
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(found.target, { start: range.start, end: range.end }).pipe(response)
    return
  }
  response.writeHead(200, { ...headers, 'content-length': found.size })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  createReadStream(found.target).pipe(response)
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error('request failed', error)
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' })
    response.end('Internal error')
  })
})

// The co-op fight runs in this process, on /ws, beside the files it serves. One origin, one duck.
const game = attachGameServer(server)

server.listen(port, () => console.log(`the evil duck is listening on ${port}`))

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    game.close()
    server.close(() => process.exit(0))
  })
}
