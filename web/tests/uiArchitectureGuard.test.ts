import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanImportCycles, scanImportDirection } from '../scripts/ui-system/imports.mjs'

test('a layer may not import one above it', () => {
  const cases = [
    [
      'shared/ui/Thing.vue',
      "import x from '@/entities/session/sessionDerivations.ts'",
      /shared\/ must not import entities\/, which is above it/,
    ],
    [
      'shared/lib/thing.ts',
      "import x from '@/app/App.vue'",
      /shared\/ must not import app\/, which is above it/,
    ],
    [
      'entities/improvement/components/ImprovementStatusBadge.vue',
      "import x from '@/widgets/work-item-views/components/WorkItemColumn.vue'",
      /entities\/ must not import widgets\/, which is above it/,
    ],
    [
      'widgets/app-nav/components/AppNav.vue',
      "import x from '@/pages/skills/components/SkillsView.vue'",
      /widgets\/ must not import pages\/, which is above it/,
    ],
  ]
  for (const [file, source, expected] of cases) {
    const found = scanImportDirection([{ file, source }])
    assert.equal(found.length, 1, file)
    assert.match(found[0], expected)
  }
})

test('a slice may not import a sibling slice of its own layer', () => {
  const cases = [
    [
      'widgets/work-item-inspector/components/WorkItemInspector.vue',
      "import x from '@/widgets/work-item-views/components/WorkItemColumn.vue'",
      /widgets slice work-item-inspector must not import sibling slice work-item-views/,
    ],
    [
      'pages/planning/PlanningWorkspace.vue',
      "import x from '@/pages/skills/components/SkillsView.vue'",
      /pages slice planning must not import sibling slice skills/,
    ],
    [
      'entities/analytics/api/analyticsApi.ts',
      "import x from '@/entities/session/sessionDerivations.ts'",
      /entities slice analytics must not import sibling slice session/,
    ],
  ]
  for (const [file, source, expected] of cases) {
    const found = scanImportDirection([{ file, source }])
    assert.equal(found.length, 1, file)
    assert.match(found[0], expected)
  }
})

test('a cycle inside one layer is reported once, however it is entered', () => {
  const sources = [
    { file: 'shared/lib/a.ts', source: "import x from '@/shared/lib/b.ts'" },
    { file: 'shared/lib/b.ts', source: "import x from '@/shared/lib/c.ts'" },
    { file: 'shared/lib/c.ts', source: "import x from '@/shared/lib/a.ts'" },
  ]
  const found = scanImportCycles(sources)
  assert.equal(found.length, 1)
  assert.match(found[0], /import cycle/)
  for (const file of ['shared/lib/a.ts', 'shared/lib/b.ts', 'shared/lib/c.ts']) {
    assert.ok(found[0].includes(file), file)
  }
  // Entering from the middle of the same cycle must not report it a second time.
  assert.deepEqual(scanImportCycles([sources[1], sources[2], sources[0]]).length, 1)
})

test('a cycle hidden behind an extensionless or index specifier is still found', () => {
  const extensionless = scanImportCycles([
    { file: 'shared/lib/left.ts', source: "import x from '@/shared/lib/right'" },
    { file: 'shared/lib/right.ts', source: "import x from '@/shared/lib/left'" },
  ])
  assert.equal(extensionless.length, 1)

  const directoryIndex = scanImportCycles([
    { file: 'shared/types/index.ts', source: "import x from '@/shared/api/platformApi.ts'" },
    { file: 'shared/api/platformApi.ts', source: "import x from '@/shared/types'" },
  ])
  assert.equal(directoryIndex.length, 1)
})

test('type-only edges are erased and never form a cycle', () => {
  // Two contract modules naming each other's types compile to no edge at all,
  // which is why the shared/api pair does this on purpose.
  const typeOnly = scanImportCycles([
    { file: 'shared/api/left.ts', source: "import type { A } from '@/shared/api/right.ts'" },
    { file: 'shared/api/right.ts', source: "import type { B } from '@/shared/api/left.ts'" },
  ])
  assert.deepEqual(typeOnly, [])

  // One value specifier in a mixed statement keeps the edge, and the cycle.
  const mixed = scanImportCycles([
    {
      file: 'shared/api/left.ts',
      source: "import { validate, type A } from '@/shared/api/right.ts'",
    },
    {
      file: 'shared/api/right.ts',
      source: "import { check, type B } from '@/shared/api/left.ts'",
    },
  ])
  assert.equal(mixed.length, 1)
})

test('a shared diamond without a cycle stays allowed', () => {
  const found = scanImportCycles([
    { file: 'shared/ui/Panel.vue', source: "import x from '@/shared/lib/format.ts'" },
    { file: 'shared/ui/Row.vue', source: "import x from '@/shared/lib/format.ts'" },
    { file: 'shared/lib/format.ts', source: 'export const format = String' },
  ])
  assert.deepEqual(found, [])
})

test('the allowed directions stay allowed', () => {
  const allowed = [
    ['shared/ui/Thing.vue', "import x from '@/shared/lib/uiSystem'"],
    ['pages/planning/PlanningWorkspace.vue', "import x from '@/shared/api/platformRoute.ts'"],
    [
      'widgets/work-item-views/components/WorkItemColumn.vue',
      "import x from '@/entities/session/sessionDerivations.ts'",
    ],
    ['app/App.vue', "import x from '@/pages/sessions/SessionsView.vue'"],
    // shared has segments, not slices, so two of them may refer to each other.
    ['shared/lib/notifications.ts', "import x from '@/shared/api/platformApi.ts'"],
    // One slice's own files are one unit however deeply they are segmented.
    [
      'widgets/work-item-graph/components/GraphView.vue',
      "import x from '@/widgets/work-item-graph/utils/graphLayout.ts'",
    ],
  ]
  for (const [file, source] of allowed) {
    assert.deepEqual(scanImportDirection([{ file, source }]), [], file)
  }
})
