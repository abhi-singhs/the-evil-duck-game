import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveVersion } from './version.mjs'

const revision = 'c858a2e77e3cb94ab2095f14ceacf1ab85e468c0'
let server
let origin

beforeAll(async () => {
  server = createServer((request, response) => {
    if (!serveVersion(request.url, request, response, revision)) response.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

describe('build identity', () => {
  it('returns the exact built revision without caching', async () => {
    const response = await fetch(`${origin}/version`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ revision })
  })

  it('supports HEAD without a body', async () => {
    const response = await fetch(`${origin}/version`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0)
    expect(await response.text()).toBe('')
  })

  it('does not accept writes or claim other routes', async () => {
    const response = await fetch(`${origin}/version`, { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expect((await fetch(`${origin}/not-version`)).status).toBe(404)
  })
})
