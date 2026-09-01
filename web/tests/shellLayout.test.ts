import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  ANALYTICS_INSPECTOR_DEFAULT_WIDTH,
  ANALYTICS_INSPECTOR_STORAGE_KEY,
  clampDrawerWidth,
  clampInspectorWidth,
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
  drawerWidthFromKey,
  drawerWidthFromPointer,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  inspectorLayoutForWorkspace,
  inspectorMaximumForWorkspace,
  inspectorWidthFromKey,
  inspectorWidthFromPointer,
  SKILLS_DRAWER_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'

test('analytics tables own a wider preference independent from the card drawer', () => {
  assert.notEqual(ANALYTICS_INSPECTOR_STORAGE_KEY, 'valkama-card-drawer-width')
  assert.ok(ANALYTICS_INSPECTOR_DEFAULT_WIDTH >= 820)
})

test('skill previews persist their drawer width without changing the card drawer preference', () => {
  assert.notEqual(SKILLS_DRAWER_STORAGE_KEY, 'valkama-card-drawer-width')
  assert.notEqual(SKILLS_DRAWER_STORAGE_KEY, ANALYTICS_INSPECTOR_STORAGE_KEY)
})

test('the card drawer keeps a persisted useful width inside the actual viewport', () => {
  assert.equal(clampDrawerWidth(DRAWER_DEFAULT_WIDTH, 1440), DRAWER_DEFAULT_WIDTH)
  assert.equal(clampDrawerWidth(2000, 1440), DRAWER_MAX_WIDTH)
  assert.equal(clampDrawerWidth(100, 1024), DRAWER_MIN_WIDTH)
  assert.equal(clampDrawerWidth(700, 390), 390)
})

test('the card drawer resizes from its left edge by pointer and keyboard', () => {
  assert.equal(drawerWidthFromPointer(650, 900, 820, 1440), 730)
  assert.equal(drawerWidthFromPointer(650, 900, 980, 1440), 570)
  assert.equal(drawerWidthFromKey(650, 'ArrowLeft', 1440), 666)
  assert.equal(drawerWidthFromKey(650, 'ArrowRight', 1440), 634)
  assert.equal(drawerWidthFromKey(650, 'Home', 1440), DRAWER_MIN_WIDTH)
  assert.equal(drawerWidthFromKey(650, 'End', 1440), DRAWER_MAX_WIDTH)
})

test('the right inspector stays readable without consuming the whole work surface', () => {
  assert.equal(clampInspectorWidth(100, 1440), INSPECTOR_MIN_WIDTH)
  assert.equal(clampInspectorWidth(2000, 1440), INSPECTOR_MAX_WIDTH)
  assert.equal(clampInspectorWidth(INSPECTOR_DEFAULT_WIDTH, 800), INSPECTOR_DEFAULT_WIDTH)
  assert.equal(clampInspectorWidth(2000, 800), 480)
})

test('inspector limits belong to the actual workspace, not the browser viewport', () => {
  assert.equal(inspectorMaximumForWorkspace(792), 472)
  assert.deepEqual(inspectorLayoutForWorkspace(792), { mode: 'inline', maximum: 472 })
  assert.deepEqual(inspectorLayoutForWorkspace(668), { mode: 'contained', maximum: 520 })
  assert.equal(clampInspectorWidth(2000, 792), 472)
})

test('dragging the left edge changes a right-side inspector width', () => {
  assert.equal(inspectorWidthFromPointer(440, 1000, 920, 1440), 520)
  assert.equal(inspectorWidthFromPointer(440, 1000, 1080, 1440), 360)
})

test('the resize separator supports keyboard adjustment and hard bounds', () => {
  assert.equal(inspectorWidthFromKey(440, 'ArrowLeft', 1440), 456)
  assert.equal(inspectorWidthFromKey(440, 'ArrowRight', 1440), 424)
  assert.equal(inspectorWidthFromKey(440, 'Home', 1440), INSPECTOR_MIN_WIDTH)
  assert.equal(inspectorWidthFromKey(440, 'End', 1440), INSPECTOR_MAX_WIDTH)
  assert.equal(inspectorWidthFromKey(440, 'Escape', 1440), 440)
})
