import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  iconPolicy,
  selectionMode,
  STATE_PRESENTATION,
  stateColor,
  statePresentation,
  surfacePolicy,
} from '@/shared/lib/uiSystem.ts'

test('state presentation is dimension-aware instead of guessing from labels', () => {
  assert.deepEqual(statePresentation('integration-health', 'ready'), {
    tone: 'success',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('session', 'failed'), {
    tone: 'danger',
    emphasis: 'strong',
  })
  assert.deepEqual(statePresentation('work-item-state', 'active'), {
    tone: 'info',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('platform-ui-state', 'degraded'), {
    tone: 'warning',
    emphasis: 'strong',
  })
  assert.deepEqual(statePresentation('connection-lifecycle', 'live'), {
    tone: 'success',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('work-item-priority', 'urgent'), {
    tone: 'danger',
    emphasis: 'strong',
  })
  assert.deepEqual(statePresentation('session-feed-result', 'normal'), {
    tone: 'neutral',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('work-item-node-marker', 'blocked'), {
    tone: 'danger',
    emphasis: 'strong',
  })
  assert.deepEqual(statePresentation('activity-action', 'checklist_released'), {
    tone: 'success',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('activity-action', 'provider-defined-action'), {
    tone: 'neutral',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('execution', 'unknown-future-state'), {
    tone: 'neutral',
    emphasis: 'quiet',
  })
})

test('canvas visualizations use the same semantic colors as component states', () => {
  // Keyed by category, so a workflow that renames Dev keeps its colour and a
  // second active state gets the same one.
  assert.equal(stateColor('work-item-state', 'backlog'), '#a8a8a8')
  assert.equal(stateColor('work-item-state', 'queued'), '#a8a8a8')
  assert.equal(stateColor('work-item-state', 'active'), '#7cacf8')
  assert.equal(stateColor('work-item-state', 'review'), '#d9b06a')
  assert.equal(stateColor('work-item-state', 'completed'), '#7bd6a1')
  assert.equal(stateColor('work-item-state', 'blocked'), '#f99a8f')
})

/**
 * What a hue means on a work item, as a set of facts a reader learns once.
 *
 * Before this held, green meant in progress, finished and workable at once,
 * and blue meant the queue and the focus ring; a reader could not learn the
 * colours because they did not mean anything, which is how a board with five
 * hues on it still read as grey.
 */
test('a hue on a work item means one thing, and ordinary work carries none', () => {
  const tone = (category: string) => statePresentation('work-item-state', category).tone
  // The four categories that ask something of a reader each have their own.
  const asking = ['active', 'review', 'blocked', 'completed'].map((category) => tone(category))
  assert.equal(new Set(asking).size, asking.length, `state hues collide: ${asking.join(', ')}`)
  assert.ok(!asking.includes('neutral'), 'a category that asks something is grey')
  // Where work only waits, nothing is said.
  for (const quiet of ['backlog', 'queued', 'cancelled']) assert.equal(tone(quiet), 'neutral')
  // Priority speaks only above the default.
  const priority = (level: 'low' | 'medium' | 'high' | 'urgent') =>
    statePresentation('work-item-priority', level).tone
  assert.equal(priority('medium'), 'neutral')
  assert.equal(priority('low'), 'neutral')
  assert.notEqual(priority('high'), 'neutral')
  assert.notEqual(priority('urgent'), 'neutral')
  assert.notEqual(priority('high'), priority('urgent'))
  // Workable is the norm of open backlog; only its exception is coloured.
  assert.equal(statePresentation('work-item-readiness', 'ready').tone, 'neutral')
  assert.equal(statePresentation('work-item-readiness', 'blocked').tone, tone('blocked'))
  // A chain and the graph use the board's hue for the same category.
  for (const [group, category] of [
    ['done', 'completed'],
    ['active', 'active'],
    ['review', 'review'],
    ['blocked', 'blocked'],
    ['queued', 'queued'],
    ['backlog', 'backlog'],
  ] as const) {
    assert.equal(statePresentation('work-item-chain-group', group).tone, tone(category), group)
  }
  assert.equal(statePresentation('work-item-node-marker', 'claimed').tone, tone('active'))
})

test('a dimension with more than one state tells its states apart', () => {
  // `control-selection` had two states that both read as neutral and quiet:
  // a switch bound it and nothing could ever vary. A dimension of one state is
  // the declared answer "no colour" for a facet; two alike say nothing twice.
  // An open dimension also reads every state it does not list, as neutral.
  for (const [dimension, states] of Object.entries(STATE_PRESENTATION)) {
    const readings = Object.values(states as Record<string, unknown>).map((reading) =>
      JSON.stringify(reading),
    )
    try {
      readings.push(JSON.stringify(statePresentation(dimension as never, 'an-unlisted-state')))
    } catch {
      // A closed dimension refuses a state it does not list.
    }
    if (readings.length < 2) continue
    assert.ok(new Set(readings).size > 1, `${dimension}: every state reads the same`)
  }
  assert.equal('control-selection' in STATE_PRESENTATION, false)
})

test('a done step keeps the green of finished work', () => {
  // A checklist step is work rather than a control, so its own dimension says
  // finished — the same hue a completed item's state takes.
  assert.equal(
    statePresentation('checklist-step', 'done').tone,
    statePresentation('work-item-state', 'completed').tone,
  )
  assert.equal(statePresentation('checklist-step', 'open').tone, 'neutral')
})

test('selection policy uses one custom accessible implementation on every screen', () => {
  assert.equal(selectionMode({ optionCount: 4 }), 'combobox')
  assert.equal(selectionMode({ optionCount: 4, hasIcons: true }), 'combobox')
  assert.equal(selectionMode({ optionCount: 30 }), 'combobox')
  assert.equal(selectionMode({ optionCount: 4, searchable: true }), 'combobox')
})

test('surface family keeps focus ownership separate from presentation anatomy', () => {
  assert.deepEqual(surfacePolicy('dialog'), { modal: true, resizable: false, placement: 'center' })
  assert.deepEqual(surfacePolicy('drawer'), { modal: true, resizable: true, placement: 'right' })
  assert.deepEqual(surfacePolicy('inspector'), {
    modal: false,
    resizable: true,
    placement: 'workspace',
  })
})

test('generic action icons and domain glyphs have explicit ownership', () => {
  assert.equal(iconPolicy('close'), 'lucide')
  assert.equal(iconPolicy('settings'), 'lucide')
  assert.equal(iconPolicy('client'), 'lucide')
})
