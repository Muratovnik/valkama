'use strict'

const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const test = require('node:test')
const { fetchOpenPlan } = require('./open_plan_request')

/** A local listener that answers like `/api/open-plan` and keeps what it was sent. */
async function listener(answer) {
  const seen = []
  const server = createServer((request, response) => {
    seen.push({ url: request.url, headers: request.headers })
    const [status, body] = answer(request)
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const appUrl = `http://127.0.0.1:${server.address().port}/`
  return { appUrl, seen, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('the plan is asked for as a same-origin fetch, with the query it was given', async () => {
  const server = await listener((request) =>
    request.headers['sec-fetch-site'] === 'same-origin'
      ? [200, '{"surface":"desktop"}']
      : [403, '{"error":{"code":"fetch_metadata_refused"}}'],
  )
  try {
    const answer = await fetchOpenPlan(server.appUrl, {
      target: 'session',
      session: 'f89d66c7-f023-4169-8d1a-2e69d4b1af68',
      surface: 'desktop',
      fallback: 'vscode',
    })
    assert.deepEqual(answer, { status: 200, body: '{"surface":"desktop"}' })
    assert.equal(
      server.seen[0].url,
      '/api/open-plan?target=session&session=f89d66c7-f023-4169-8d1a-2e69d4b1af68&surface=desktop&fallback=vscode',
    )
    assert.equal(server.seen[0].headers['sec-fetch-site'], 'same-origin')
    assert.equal(server.seen[0].headers.authorization, undefined)
    assert.equal(server.seen[0].headers.origin, undefined)
  } finally {
    await server.close()
  }
})

test('a refusal comes back as its status, and no server as status 0', async () => {
  const server = await listener(() => [400, '{"error":{"code":"invalid_request"}}'])
  try {
    const refused = await fetchOpenPlan(server.appUrl, { target: 'session' })
    assert.equal(refused.status, 400)
  } finally {
    await server.close()
  }
  const closed = await fetchOpenPlan(server.appUrl, { target: 'session' }, { timeout: 500 })
  assert.deepEqual(closed, { status: 0, body: '' })
})
