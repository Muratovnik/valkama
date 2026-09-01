/**
 * The five kinds of content a declarative contribution may carry.
 *
 * The union is closed on purpose: a provider describes what to render and never
 * supplies markup, so anything outside these five is refused rather than passed
 * through. Each builder reads only the keys its kind declares.
 */

import { validateActionRef } from '@/shared/api/platformActionRef.ts'
import type { ActionRef } from '@/shared/api/platformActionRef.ts'
import {
  contributionInvalid,
  contributionKeys,
  contributionObject,
  contributionText,
} from '@/shared/api/platformContributionGuards.ts'
import { validateEntityRef } from '@/shared/api/platformEntityRef.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'

/** What a contribution renders, as a closed union of described shapes. */
export type DeclarativeContributionContent =
  | { kind: 'text'; text: string }
  | { items: Array<{ label: string; value: string }>; kind: 'definition-list' }
  | {
      kind: 'status'
      label: string
      status: 'ready' | 'degraded' | 'unavailable' | 'error' | 'permission-denied'
    }
  | { kind: 'link'; label: string; target: EntityRef; action?: ActionRef }
  | { columns: string[]; kind: 'table'; rows: Array<Record<string, string | number | null>> }

/** A paragraph of text, bounded so one contribution cannot fill the panel. */
function textContent(
  object: Record<string, unknown>,
  path: string,
): DeclarativeContributionContent {
  contributionKeys(object, ['kind', 'text'], path)
  return { kind: 'text', text: contributionText(object.text, `${path}.text`, 5000) }
}

/** Label/value pairs, at most 64 of them. */
function definitionListContent(
  object: Record<string, unknown>,
  path: string,
): DeclarativeContributionContent {
  contributionKeys(object, ['kind', 'items'], path)
  if (!Array.isArray(object.items) || object.items.length > 64)
    contributionInvalid(`${path}.items`, 'expected bounded list')
  return {
    kind: 'definition-list',
    items: object.items.map((entry, index) => {
      const item = contributionObject(entry, `${path}.items[${index}]`)
      contributionKeys(item, ['label', 'value'], `${path}.items[${index}]`)
      return {
        label: contributionText(item.label, `${path}.items[${index}].label`, 240),
        value: contributionText(item.value, `${path}.items[${index}].value`, 2000),
      }
    }),
  }
}

/** One of the seven states the shell knows how to paint, with its label. */
function statusContent(
  object: Record<string, unknown>,
  path: string,
): DeclarativeContributionContent {
  contributionKeys(object, ['kind', 'status', 'label'], path)
  const status = object.status
  if (
    status !== 'ready' &&
    status !== 'degraded' &&
    status !== 'unavailable' &&
    status !== 'error' &&
    status !== 'permission-denied'
  )
    contributionInvalid(`${path}.status`, 'unknown status')
  return {
    kind: 'status',
    status,
    label: contributionText(object.label, `${path}.label`, 240),
  }
}

/** A labelled target, optionally reached through a declared action. */
function linkContent(
  object: Record<string, unknown>,
  path: string,
): DeclarativeContributionContent {
  contributionKeys(object, ['kind', 'label', 'target'], path, ['action'])
  const action =
    object.action === undefined ? undefined : validateActionRef(object.action, `${path}.action`)
  return {
    kind: 'link',
    label: contributionText(object.label, `${path}.label`, 240),
    target: validateEntityRef(object.target, `${path}.target`),
    ...(action === undefined ? {} : { action }),
  }
}

/** One row's cells, each text, a finite number, or an explicit null. */
function tableCell(
  row: Record<string, unknown>,
  column: string,
  path: string,
): string | number | null {
  const cell = row[column]
  if (cell === null) return null
  if (typeof cell === 'string') return contributionText(cell, `${path}.${column}`, 500)
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell
  return contributionInvalid(`${path}.${column}`, 'expected text, finite number, or null')
}

/**
 * A bounded table: named columns with no duplicate header, and every row
 * carrying exactly those columns.
 */
function tableContent(
  object: Record<string, unknown>,
  path: string,
): DeclarativeContributionContent {
  contributionKeys(object, ['kind', 'columns', 'rows'], path)
  if (!Array.isArray(object.columns) || object.columns.length === 0 || object.columns.length > 32)
    contributionInvalid(`${path}.columns`, 'expected bounded columns')
  const columns = object.columns.map((entry, index) =>
    contributionText(entry, `${path}.columns[${index}]`, 80),
  )
  if (new Set(columns).size !== columns.length)
    contributionInvalid(`${path}.columns`, 'duplicate columns are not allowed')
  if (!Array.isArray(object.rows) || object.rows.length > 256)
    contributionInvalid(`${path}.rows`, 'expected bounded rows')
  const rows = object.rows.map((entry, index) => {
    const rowPath = `${path}.rows[${index}]`
    const row = contributionObject(entry, rowPath)
    contributionKeys(row, columns, rowPath)
    const output: Record<string, string | number | null> = {}
    for (const column of columns) output[column] = tableCell(row, column, rowPath)
    return output
  })
  return { kind: 'table', columns, rows }
}

/** The five declarative content kinds a contribution may carry. */
const CONTRIBUTION_CONTENT: Record<
  string,
  (object: Record<string, unknown>, path: string) => DeclarativeContributionContent
> = {
  'definition-list': definitionListContent,
  'link': linkContent,
  'status': statusContent,
  'table': tableContent,
  'text': textContent,
}

export function contributionContent(value: unknown, path: string): DeclarativeContributionContent {
  const object = contributionObject(value, path)
  const build = typeof object.kind === 'string' ? CONTRIBUTION_CONTENT[object.kind] : undefined
  if (!build) contributionInvalid(`${path}.kind`, 'unsupported declarative contribution content')
  return build(object, path)
}
