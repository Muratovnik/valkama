/** Ordering and search over recorded values, without deriving additional telemetry. */
function recordedText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((entry) => recordedText(entry)).join(' ')
  if (typeof value === 'object')
    return Object.values(value)
      .map((entry) => recordedText(entry))
      .join(' ')
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''
}

export function matchesRecorded(value: unknown, query: string): boolean {
  return recordedText(value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}

export function groupHistory<T>(records: readonly T[], timestamp: (record: T) => string) {
  const sorted = records
    .map((record, index) => ({ record, index, time: Date.parse(timestamp(record)) }))
    .sort((left, right) => {
      const a = Number.isNaN(left.time) ? Number.NEGATIVE_INFINITY : left.time
      const b = Number.isNaN(right.time) ? Number.NEGATIVE_INFINITY : right.time
      return (a === b ? 0 : b - a) || left.index - right.index
    })
  const groups = new Map<string, { date: Date | null; key: string; records: T[] }>()
  for (const { record, time } of sorted) {
    const date = Number.isNaN(time) ? null : new Date(time)
    const key = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'unknown'
    const group = groups.get(key) ?? { key, date, records: [] }
    group.records.push(record)
    groups.set(key, group)
  }
  return [...groups.values()]
}
