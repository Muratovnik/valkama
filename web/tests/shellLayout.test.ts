import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  clampDrawerWidth,
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
  drawerWidthFromKey,
  drawerWidthFromPointer,
} from '@/shared/lib/shellLayout.ts'

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
