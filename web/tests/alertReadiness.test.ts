import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  readinessOfCheck,
  readinessOfStatus,
  readinessOfTrial,
} from '@/pages/settings/utils/alertReadiness.ts'

const windows = (state: string, setting: number | null = null, reason: string | null = null) => ({
  state,
  setting,
  reason,
})

const status = (shortcut: boolean, answer: ReturnType<typeof windows>) => ({
  shortcut,
  windows: answer,
  helper: true,
  autostart: 'disabled',
})

const trial = (state: string, shown: boolean) => ({ ...windows(state), shown })

test('each answer from Windows names its own readiness and tone', () => {
  const answers: [string, string, string][] = [
    ['enabled', 'ready', 'ready'],
    ['no-shortcut', 'no-shortcut', 'unavailable'],
    ['disabled-for-application', 'disabled-for-application', 'unavailable'],
    ['disabled-for-user', 'disabled-for-user', 'unavailable'],
    ['disabled-by-group-policy', 'disabled-by-group-policy', 'unavailable'],
    ['disabled-by-manifest', 'disabled-by-manifest', 'unavailable'],
    ['unavailable', 'unavailable', 'unavailable'],
    ['failed', 'failed', 'degraded'],
    ['switched-off', 'switched-off', 'not-observed'],
    ['unsupported', 'unsupported', 'not-observed'],
  ]
  for (const [state, code, tone] of answers) {
    const readiness = readinessOfStatus(status(true, windows(state)))
    assert.equal(readiness.code, code, state)
    assert.equal(readiness.state, tone, state)
  }
})

test('a state this build has no words for is a failed check, never a working one', () => {
  const readiness = readinessOfCheck(windows('setting-9', 9, null))
  assert.equal(readiness.code, 'failed')
  assert.equal(readiness.state, 'degraded')
})

test('the server keeps its own words for why a check failed', () => {
  assert.equal(readinessOfCheck(windows('failed', null, 'no answer')).reason, 'no answer')
})

test('a missing shortcut is the first thing to fix, whatever Windows says of the app', () => {
  for (const state of ['enabled', 'disabled-for-application', 'failed'])
    assert.equal(readinessOfStatus(status(false, windows(state))).code, 'no-shortcut')
})

test('a test toast counts as sent only once its helper has started', () => {
  assert.equal(readinessOfTrial(trial('enabled', true), 'not started').code, 'ready')
  const stopped = readinessOfTrial(trial('enabled', false), 'not started')
  assert.equal(stopped.code, 'failed')
  assert.equal(stopped.reason, 'not started')
  assert.equal(readinessOfTrial(trial('no-shortcut', false), 'not started').code, 'no-shortcut')
})

test('a process that shows nothing on purpose does not ask for a shortcut', () => {
  for (const state of ['switched-off', 'unsupported'])
    assert.equal(readinessOfStatus(status(false, windows(state))).code, state)
})
