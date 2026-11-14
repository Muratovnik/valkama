/**
 * The reader's fold choices: what is kept, what is forgotten because the rule
 * says the same, and how much storage keeps.
 */
import { effectScope, nextTick, shallowRef } from 'vue'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFoldChoices } from '@/shared/lib/useFoldChoices.ts'

const KEY = 'valkama-test-folds'

function open(space = shallowRef('space-a')) {
  const scope = effectScope()
  const folds = scope.run(() => useFoldChoices(KEY, () => space.value))
  if (!folds) throw new Error('no fold choices')
  return { folds, scope, space }
}

/** What storage holds now, as written. */
const stored = (): Record<string, Record<string, boolean>> =>
  JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Record<string, boolean>>

describe('useFoldChoices', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('keeps a choice against the rule, in its space, and reads it again after a reload', async () => {
    const first = open()
    first.folds.choose('goal-1', true, false)
    await nextTick()
    expect(first.folds.choices.value).toEqual({ 'goal-1': true })
    expect(stored()).toEqual({ 'space-a': { 'goal-1': true } })
    first.scope.stop()

    const again = open()
    expect(again.folds.choices.value).toEqual({ 'goal-1': true })
    // Another space has choices of its own.
    again.space.value = 'space-b'
    expect(again.folds.choices.value).toEqual({})
    again.scope.stop()
  })

  it('forgets a choice that comes back to what the rule says', async () => {
    const { folds, scope } = open()
    folds.choose('goal-1', true, false)
    folds.choose('goal-2', false, true)
    // Opened again, as the rule would have it: nothing of goal-1 is kept.
    folds.choose('goal-1', false, false)
    await nextTick()
    expect(folds.choices.value).toEqual({ 'goal-2': false })
    expect(stored()['space-a']).toEqual({ 'goal-2': false })
    scope.stop()
  })

  it('keeps any choice where no rule is asked about', async () => {
    const { folds, scope } = open()
    folds.choose('goal-1', false)
    folds.choose('goal-2', true)
    await nextTick()
    expect(folds.choices.value).toEqual({ 'goal-1': false, 'goal-2': true })
    scope.stop()
  })

  it('remembers the newest 400 choices of a space and the newest 24 spaces', async () => {
    const space = shallowRef('space-0')
    const { folds, scope } = open(space)
    for (let at = 0; at < 401; at += 1) folds.choose(`item-${at}`, true, false)
    await nextTick()
    const kept = Object.keys(folds.choices.value)
    expect(kept).toHaveLength(400)
    expect(kept).not.toContain('item-0')
    expect(kept).toContain('item-400')

    for (let at = 1; at <= 24; at += 1) {
      space.value = `space-${at}`
      folds.choose('item', true, false)
    }
    await nextTick()
    const spaces = Object.keys(stored())
    expect(spaces).toHaveLength(24)
    // The space chosen in longest ago is the one let go.
    expect(spaces).not.toContain('space-0')
    expect(spaces).toContain('space-24')
    scope.stop()
  })

  it('drops whatever in storage is not a choice', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        'space-a': { 'goal-1': true, 'goal-2': 'yes' },
        'space-b': [1],
        'other': 3,
      }),
    )
    const { folds, scope } = open()
    expect(folds.choices.value).toEqual({ 'goal-1': true })
    scope.stop()
  })

  it('keeps the choice for the page when storage refuses it', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { folds, scope } = open()
    folds.choose('goal-1', true, false)
    await nextTick()
    expect(folds.choices.value).toEqual({ 'goal-1': true })
    scope.stop()
  })
})
