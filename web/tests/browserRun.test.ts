/**
 * The check a browser run makes before its first spec: the app port has to serve the
 * bundle the run has just built. A preview left on another directory, or a build step
 * that no longer runs, would otherwise test an old bundle and pass.
 */

import { describe, expect, it } from 'vitest'

import { staleAppReason } from './browser/browserRun.ts'

const page = '<script type="module" src="/assets/index-Bx81fQ2a.js"></script>'
const runStartedAt = 1_000_000

describe('the app a browser run serves', () => {
  it('passes when the port serves the page built after the run started', () => {
    expect(
      staleAppReason(page, { html: page, writtenAt: runStartedAt + 1 }, runStartedAt),
    ).toBeNull()
  })

  it('refuses a page another build wrote, even one this run also built', () => {
    const other = '<script type="module" src="/assets/index-C4kq0e1P.js"></script>'
    expect(
      staleAppReason(other, { html: page, writtenAt: runStartedAt + 1 }, runStartedAt),
    ).toMatch(/serves a page other than .*index\.html/)
  })

  it('refuses a build left by an earlier run, even when the port serves it', () => {
    expect(staleAppReason(page, { html: page, writtenAt: runStartedAt - 1 }, runStartedAt)).toMatch(
      /written before this run started/,
    )
  })
})
