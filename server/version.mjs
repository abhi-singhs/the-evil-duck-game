export function serveVersion(pathname, request, response, revision = process.env.SOURCE_REVISION) {
  if (pathname !== '/version') return false
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { ...headers, allow: 'GET, HEAD' }).end()
    return true
  }
  const body = JSON.stringify({ revision: revision || null })
  response.writeHead(200, { ...headers, 'content-length': Buffer.byteLength(body) })
  response.end(request.method === 'HEAD' ? undefined : body)
  return true
}
