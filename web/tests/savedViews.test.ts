/**
 * Saved views: the address state under a name, listed per planning space, written back
 * as it was kept, deleted on request, and read as no views where what was stored cannot
 * be read — including through the settings reader every stored value passes.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  activeView,
  deleteView,
  readSavedViews,
  saveView,
  VIEW_NAME_CHARS,
  viewsOf,
  viewState,
} from '@/shared/lib/savedViews.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/lib/settings.ts'

const MAIN = 'scope-a:MAIN'
const OTHER = 'scope-b:MAIN'
const MINE = { view: 'list', held: true, labels: 'ui,%-old' }
const GROUPED = { group: 'epic', query: 'MAIN-2' }

describe('saved views', () => {
  test('a saved view is listed in its own space and in no other', () => {
    const views = saveView({}, MAIN, 'Mine', MINE)
    assert.deepEqual(
      viewsOf(views, MAIN).map((view) => view.name),
      ['Mine'],
    )
    assert.deepEqual(viewsOf(views, OTHER), [])
    // The same name in another space is that space's own view.
    const both = saveView(views, OTHER, 'Mine', GROUPED)
    assert.deepEqual(viewState(both, MAIN, 'Mine'), MINE)
    assert.deepEqual(viewState(both, OTHER, 'Mine'), GROUPED)
  })

  test('the views keep the order they were saved in, and a name saved again takes the new state in place', () => {
    let views = saveView({}, MAIN, 'Mine', MINE)
    views = saveView(views, MAIN, '  Grouped ', GROUPED)
    assert.deepEqual(
      viewsOf(views, MAIN).map((view) => view.name),
      ['Mine', 'Grouped'],
    )
    views = saveView(views, MAIN, 'Mine', GROUPED)
    assert.deepEqual(
      viewsOf(views, MAIN).map((view) => view.name),
      ['Mine', 'Grouped'],
    )
    assert.deepEqual(viewState(views, MAIN, 'Mine'), GROUPED)
    // A name of nothing but spaces is no name, and a long one is cut to the bound.
    assert.equal(saveView(views, MAIN, '   ', MINE), views)
    const long = saveView({}, MAIN, 'x'.repeat(VIEW_NAME_CHARS + 5), MINE)
    assert.equal(viewsOf(long, MAIN)[0]?.name.length, VIEW_NAME_CHARS)
  })

  test('applying a view returns the state it kept, which a later change of the address does not touch', () => {
    const address: Record<string, string | number | boolean> = { ...MINE }
    const views = saveView({}, MAIN, 'Mine', address)
    address.view = 'graph'
    const applied = viewState(views, MAIN, 'Mine')
    assert.deepEqual(applied, MINE)
    // What is handed out is a copy: writing it does not change the saved view.
    if (applied) applied.view = 'kanban'
    assert.deepEqual(viewState(views, MAIN, 'Mine'), MINE)
    assert.equal(viewState(views, MAIN, 'Nobody saved this'), null)
    assert.equal(viewState(views, OTHER, 'Mine'), null)
  })

  test('the view the address holds now is the active one, whatever order its keys come in', () => {
    const views = saveView(saveView({}, MAIN, 'Mine', MINE), MAIN, 'Grouped', GROUPED)
    assert.equal(activeView(views, MAIN, { labels: 'ui,%-old', held: true, view: 'list' }), 'Mine')
    assert.equal(activeView(views, MAIN, GROUPED), 'Grouped')
    assert.equal(activeView(views, MAIN, { ...GROUPED, held: true }), null)
    assert.equal(activeView(views, MAIN, undefined), null)
    assert.equal(activeView(views, OTHER, MINE), null)
  })

  test('deleting a view removes it from its space only, and a space left with none is dropped', () => {
    let views = saveView(saveView({}, MAIN, 'Mine', MINE), OTHER, 'Mine', MINE)
    views = saveView(views, MAIN, 'Grouped', GROUPED)
    views = deleteView(views, MAIN, 'Mine')
    assert.deepEqual(
      viewsOf(views, MAIN).map((view) => view.name),
      ['Grouped'],
    )
    assert.deepEqual(viewState(views, OTHER, 'Mine'), MINE)
    views = deleteView(views, MAIN, 'Grouped')
    assert.deepEqual(Object.keys(views), [OTHER])
  })

  test('what was stored is read back as it was saved', () => {
    const views = saveView(saveView({}, MAIN, 'Mine', MINE), OTHER, 'Grouped', GROUPED)
    assert.deepEqual(readSavedViews(JSON.parse(JSON.stringify(views))), views)
  })

  test('a missing or corrupt stored value reads as no views', () => {
    for (const raw of [undefined, null, 'views', 7, [], [{ name: 'Mine', state: MINE }]])
      assert.deepEqual(readSavedViews(raw), {}, JSON.stringify(raw))
    // A space whose list is no list, and views without a name or a readable state.
    const read = readSavedViews({
      [MAIN]: { name: 'Mine', state: MINE },
      [OTHER]: [
        null,
        'Mine',
        { name: '', state: MINE },
        { name: 'No state' },
        { name: 'Nested', state: { view: { deep: true } } },
        { name: 'Listed', state: [1, 2] },
        { name: 7, state: MINE },
        { name: 'Kept', state: GROUPED },
        { name: 'Kept', state: MINE },
      ],
    })
    assert.deepEqual(read, { [OTHER]: [{ name: 'Kept', state: GROUPED }] })
  })

  test('the settings reader keeps saved views and reads a corrupt or missing value as none', () => {
    const views = saveView({}, MAIN, 'Mine', MINE)
    assert.deepEqual(mergeSettings({ views }).views, views)
    assert.deepEqual(mergeSettings({}).views, {})
    assert.deepEqual(mergeSettings({ views: 'garbage' }).views, {})
    assert.deepEqual(DEFAULT_SETTINGS.views, {})
  })
})
