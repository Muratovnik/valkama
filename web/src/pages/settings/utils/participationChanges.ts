/**
 * How one change of a participation scope shows before the server answers, and which row it
 * belongs to.
 *
 * What is shown here stands only until the answer: the answer is the server's read of the
 * scope, and it replaces this guess whatever it says.
 */
import type {
  Participation,
  ParticipationChange,
  ParticipationEdit,
  ParticipationKey,
  ParticipationValue,
} from '@/shared/api/participationApi.ts'

/** A row of the participation tab, which is also its place in the write queue. */
export type ParticipationRow = 'set' | `key:${ParticipationKey}` | `label:${string}`

export function rowOf(change: ParticipationEdit): ParticipationRow {
  if ('key' in change) return `key:${change.key}`
  if ('label' in change) return `label:${change.label}`
  return 'set'
}

/** A value the scope sets itself (`value`), or with null the value it inherits. */
function withValue(row: ParticipationValue, value: string | number | null): ParticipationValue {
  return value === null
    ? { ...row, value: row.inherited, own: false }
    : { ...row, value, own: true }
}

function withLabel(
  record: Participation,
  change: { description: string | null; label: string; ready: boolean | null },
): Participation['labels'] {
  const known = record.labels.find((rule) => rule.label === change.label)
  const inherited = known?.inherited ?? { ready: false, description: null }
  const others = record.labels.filter((rule) => rule.label !== change.label)
  const removed = change.ready === null && change.description === null
  // In a space a label whose own rule goes still reads the shared one, when there is one.
  const shared = inherited.ready || inherited.description !== null
  // A rule that leaves the list goes with the answer: until then its row stands as it was,
  // so a refusal has the row to stand under and the focus is not dropped before it is known.
  if (removed && !(record.scope !== null && shared)) return record.labels
  // A field the change leaves null is the one above, and not the scope's own.
  const rule = {
    label: change.label,
    ready: change.ready ?? inherited.ready,
    description: change.description ?? inherited.description,
    own: { ready: change.ready !== null, description: change.description !== null },
    inherited,
  }
  return [...others, rule].sort((left, right) => (left.label < right.label ? -1 : 1))
}

/** The scope with `change` shown in it. */
export function applyParticipation(
  record: Participation,
  change: ParticipationChange,
): Participation {
  if ('key' in change)
    return {
      ...record,
      values: record.values.map((row) =>
        row.key === change.key ? withValue(row, change.value) : row,
      ),
    }
  if ('label' in change) return { ...record, labels: withLabel(record, change) }
  const { set } = change
  const chosen = set === null ? null : record.sets[set]
  return {
    ...record,
    values: record.values.map((row) => {
      if (chosen === null) return row.key in record.sets.default ? withValue(row, null) : row
      const value = chosen[row.key]
      return value === undefined ? row : withValue(row, value)
    }),
  }
}
