/** The real server's answers, which `tests/test_web_contract_fixtures.py` writes. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The directory of the fixtures, each a file named for the answer it holds. */
export const SERVER_FIXTURES = fileURLToPath(new URL('../fixtures/server/', import.meta.url))

/** One fixture, parsed: what the server answered, before any validator read it. */
export const readServerFixture = (name: string): unknown =>
  JSON.parse(readFileSync(`${SERVER_FIXTURES}${name}`, 'utf8'))
