/**
 * The side panel over the Analytics page is a part of its view's address (`detail`). The oracle is
 * the requirement: opening the panel is a new place in the history and a reload opens it again,
 * so the address gives back every kind of panel — a value's, that of work with no value, a
 * section's whole table and a quota window's — and an address it cannot read opens no panel and
 * keeps the rest of the view.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_VIEW, readAddress, writeAddress } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'

import { throughTheAddress } from './support/analyticsAddress.ts'

describe('the side panel’s part of the Analytics address', () => {
  it.each([
    [
      'the side panel of work with no task',
      { detail: { kind: 'value', by: 'work_item', value: null } },
    ],
    [
      'the side panel of a model',
      { by: 'model', detail: { kind: 'value', by: 'model', value: 'm-1' } },
    ],
    [
      'the side panel of the section’s whole table',
      { by: 'model', detail: { kind: 'all', by: 'model' } },
    ],
    [
      'the side panel of a quota window',
      {
        by: 'quota_week',
        detail: { kind: 'window', account: 'org/acc', window: 'week_model:m-1' },
      },
    ],
  ] as const)('gives back %s', (_name, part) => {
    const view = { ...DEFAULT_VIEW, ...part } as AnalyticsView
    expect(throughTheAddress(view)).toEqual(view)
  })

  it.each([
    ['text that is no JSON', '{not json'],
    ['a list', '["model","m-1"]'],
    ['a dimension this build has not', '{"by":"colour","value":"x"}'],
    ['a value that is no id', '{"by":"model","value":3}'],
    ['an empty id', '{"by":"model","value":""}'],
    ['no value at all', '{"by":"model"}'],
    ['a window with no account', '{"window":"week"}'],
  ])('opens no side panel for %s, and keeps the rest of the link', (_name, detail) => {
    expect(readAddress({ by: 'model', detail })).toEqual({ ...DEFAULT_VIEW, by: 'model' })
  })

  it('opens a section’s whole table over that section alone', () => {
    const all = JSON.stringify({ by: 'model', all: true })
    expect(readAddress({ by: 'model', detail: all }).detail).toEqual({ kind: 'all', by: 'model' })
    expect(readAddress({ by: 'role', detail: all }).detail).toBeNull()
    expect(readAddress({ detail: all }).detail).toBeNull()
  })

  it('holds one side panel in one address, whatever order its parts were written in', () => {
    const view = { ...DEFAULT_VIEW, detail: { kind: 'value', by: 'model', value: 'm-1' } } as const
    const pasted = readAddress({ detail: '{"value":"m-1","by":"model"}' })
    expect(pasted).toEqual(view)
    expect(writeAddress(pasted)).toEqual(writeAddress(view))
  })
})
