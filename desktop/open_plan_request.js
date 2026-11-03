'use strict'

const { request: httpRequest } = require('node:http')

// The main process asks the local server what a click opens.
//
// `GET /api/open-plan` answers only a same-origin fetch, because its plan names
// local paths (docs/connection-contract.md, "What a click opens"). A browser
// sets `Sec-Fetch-Site` itself and a page cannot; a local process may send it,
// and the contract names this process as one that does. No credential is sent:
// the route takes none.

const PLAN_PATH = '/api/open-plan'
const TIMEOUT_MS = 5000
const MAX_BYTES = 1024 * 1024

/** `{status, body}` for one plan request; status 0 when the server did not answer. */
function fetchOpenPlan(appUrl, parameters, options = {}) {
  const send = options.request || httpRequest
  const base = new URL(appUrl)
  const query = new URLSearchParams(parameters).toString()
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let outgoing
    try {
      outgoing = send(
        {
          host: base.hostname,
          port: base.port,
          path: `${PLAN_PATH}?${query}`,
          method: 'GET',
          headers: { 'Sec-Fetch-Site': 'same-origin', Accept: 'application/json' },
          timeout: options.timeout || TIMEOUT_MS,
        },
        (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            body += chunk
            if (body.length > MAX_BYTES) {
              response.destroy()
              finish({ status: 0, body: '' })
            }
          })
          response.on('end', () => finish({ status: response.statusCode || 0, body }))
          response.on('error', () => finish({ status: 0, body: '' }))
        },
      )
      outgoing.once('error', () => finish({ status: 0, body: '' }))
      outgoing.once('timeout', () => {
        outgoing.destroy()
        finish({ status: 0, body: '' })
      })
      outgoing.end()
    } catch {
      finish({ status: 0, body: '' })
    }
  })
}

module.exports = { PLAN_PATH, fetchOpenPlan }
