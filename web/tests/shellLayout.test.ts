import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  BOARD_ROOM_BESIDE_DOCUMENT,
  clampDrawerWidth,
  DIALOG_ROOM_BESIDE_DOCUMENT,
  DIALOG_WIDTH,
  documentFitsBeside,
  documentPaneRoom,
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

// The plan's own figures, written out: a formula tested with itself proves nothing.
test.each([
  ['the narrowest card', 360, BOARD_ROOM_BESIDE_DOCUMENT, 1200],
  ['the card as it opens', 620, BOARD_ROOM_BESIDE_DOCUMENT, 1460],
  ['the questions waiting for an answer', DIALOG_WIDTH, DIALOG_ROOM_BESIDE_DOCUMENT, 1160],
])('a document stands beside %s from exactly its threshold', (_name, surface, room, threshold) => {
  assert.equal(documentFitsBeside(surface, room, threshold), true)
  assert.equal(documentFitsBeside(surface, room, threshold - 1), false)
})

test('a document beside a surface takes what the threshold leaves it', () => {
  assert.equal(documentPaneRoom(620, BOARD_ROOM_BESIDE_DOCUMENT, 1460), DRAWER_MIN_WIDTH)
  assert.equal(documentPaneRoom(620, BOARD_ROOM_BESIDE_DOCUMENT, 1500), 480)
  assert.equal(documentPaneRoom(DIALOG_WIDTH, DIALOG_ROOM_BESIDE_DOCUMENT, 1500), 780)
})
