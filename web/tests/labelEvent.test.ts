/**
 * The `labels_changed` event of store schema 15, read through the card's own validator. Its
 * detail is both label sets as JSON, which a full set of long labels takes past the 512
 * characters every other event's detail is held to; the card reads it whole, and still
 * refuses another event that long, so a server that loosens a detail is noticed.
 */

import { describe, expect, it } from 'vitest'

import { EVENT_DETAIL_MAX, LABELS_DETAIL_MAX } from '@/shared/api/planningEventActions.ts'
import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import { en } from '@/shared/i18n/locales/en.ts'
import { ru } from '@/shared/i18n/locales/ru.ts'

import { workItemFixture } from './fixtures/workItem.ts'

const identity = { state: 'confirmed', source: 'codex-meta', session_id: 's', agent_id: null }
const event = (action: string, detail: string) => ({
  action,
  detail,
  author: 'codex',
  at: '2026-11-11T12:00:00.000000Z',
  identity,
})
const card = (events: unknown[]) => ({ ...workItemFixture('Labels', 5), events })
/** The longest set the server writes: 32 labels of 64 characters, each a JSON escape. */
const longest = Array.from({ length: 32 }, () => '\u{1}'.repeat(64))

describe('a change of labels in a card', () => {
  it('is read with both sets, the way the server writes it', () => {
    const detail = JSON.stringify({ from: ['bug'], to: ['bug', 'ux'] })
    const read = validateWorkItemRecord(card([event('labels_changed', detail)]))
    expect(read.events.map((entry) => [entry.action, entry.detail])).toEqual([
      ['labels_changed', detail],
    ])
  })

  it('is read whole at the server’s longest detail, and refused past it', () => {
    const detail = JSON.stringify({ from: longest, to: longest })
    expect(detail).toHaveLength(LABELS_DETAIL_MAX)
    expect(() => validateWorkItemRecord(card([event('labels_changed', detail)]))).not.toThrow()
    expect(() => validateWorkItemRecord(card([event('labels_changed', `${detail} `)]))).toThrow()
  })

  it('leaves every other event held to its own limit', () => {
    const line = 'x'.repeat(EVENT_DETAIL_MAX)
    expect(() => validateWorkItemRecord(card([event('transitioned', line)]))).not.toThrow()
    expect(() => validateWorkItemRecord(card([event('transitioned', `${line}x`)]))).toThrow()
  })

  it('has a title in both languages', () => {
    expect(en.activity.labels_changed).toBe('Labels changed')
    expect(ru.activity.labels_changed).toBe('Метки изменены')
  })
})
