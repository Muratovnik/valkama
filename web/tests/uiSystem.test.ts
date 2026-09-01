import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  iconPolicy,
  selectionMode,
  stateColor,
  statePresentation,
  surfacePolicy,
} from '@/shared/lib/uiSystem.ts'

test('state presentation is dimension-aware instead of guessing from labels', () => {
  assert.deepEqual(statePresentation('integration-health', 'ready'), {
    tone: 'success',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('integration-intake', 'disabled'), {
    tone: 'neutral',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('session', 'failed'), {
    tone: 'danger',
    emphasis: 'strong',
  })
  assert.deepEqual(statePresentation('work-item-state', 'active'), {
    tone: 'success',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('skill-readiness', 'partial'), {
    tone: 'info',
    emphasis: 'quiet',
  })
  assert.deepEqual(statePresentation('skill-readiness', 'invalid'), {
    tone: 'danger',
    emphasis: 'strong',
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
  assert.deepEqual(statePresentation('case', 'unknown-future-state'), {
    tone: 'neutral',
    emphasis: 'quiet',
  })
})

test('canvas visualizations use the same semantic colors as component states', () => {
  // Keyed by category, so a workflow that renames Dev keeps its colour and a
  // second active state gets the same one.
  assert.equal(stateColor('work-item-state', 'backlog'), '#8f8f8f')
  assert.equal(stateColor('work-item-state', 'queued'), '#7cacf8')
  assert.equal(stateColor('work-item-state', 'active'), '#7bd6a1')
  assert.equal(stateColor('work-item-state', 'review'), '#d9b06a')
  assert.equal(stateColor('work-item-state', 'completed'), '#7bd6a1')
  assert.equal(stateColor('work-item-state', 'blocked'), '#ef8479')
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
