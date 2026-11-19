import { computed, ref, shallowRef } from 'vue'

/** Where a record is kept: how it is read, how a change is written, and how a failure is said. */
interface RecordStore<R, C, Row extends string> {
  /**
   * The record with a change shown in it before the server answers. Without it a change is
   * the whole record.
   */
  apply?: (record: R, change: C) => R
  failureText: (error: unknown) => string
  read: () => Promise<R>
  /**
   * Which place in the queue a row's change takes: a newer change replaces the waiting one
   * of the same place only. Without it every row shares one place, which is right for a
   * record written whole, since the newest one carries every change before it.
   */
  slotOf?: (row: Row) => string
  /** Writes one change and answers with the whole record the server kept. */
  write: (change: C) => Promise<R>
}

interface Change<C, Row extends string> {
  change: C
  row: Row
  slot: string
}

/**
 * A record the server keeps, and writes that keep the screen answering.
 *
 * What is shown is the record the server last confirmed with every change still to land
 * shown in it, so a write that fails takes back its own change and leaves the others. No
 * control is disabled while a write is out, because a disabled control drops the keyboard's
 * focus, so presses can arrive during one. Writes never overlap, so an older one cannot land
 * last, and they go in the order they were asked for.
 *
 * Each change waits in a place (`slotOf`): a newer change of the same place replaces the one
 * waiting there and goes last, and a change of another place waits beside it. A record
 * written whole has one place, and the newest record carries every change before it; a
 * record written a row at a time has a place per row, and a change of row B leaves the
 * waiting change of row A to be written too.
 *
 * A failure is told against the row whose change was refused (`Row`), so that it stands
 * beside what was changed. A refusal of a change whose place already holds a newer one is
 * not told: the newer one answers for it.
 */
export function useStoredRecord<R, Row extends string, C = R>(store: RecordStore<R, C, Row>) {
  const apply = store.apply ?? ((_record: R, change: C) => change as unknown as R)
  const slotOf = store.slotOf ?? (() => '')
  const saved = shallowRef<R | null>(null)
  const shown = shallowRef<R | null>(null)
  const loadFailed = ref(false)
  const failures = shallowRef<ReadonlyMap<Row, string>>(new Map())
  let waiting: Change<C, Row>[] = []
  let sending: Change<C, Row> | null = null

  /** The confirmed record with the change on its way and those waiting shown in it. */
  function reshow() {
    const base = saved.value
    if (base === null) return
    let record = base
    for (const { change } of sending === null ? waiting : [sending, ...waiting])
      record = apply(record, change)
    shown.value = record
  }

  function tell(row: Row, text: string | null) {
    const next = new Map(failures.value)
    if (text === null) next.delete(row)
    else next.set(row, text)
    failures.value = next
  }

  async function load() {
    loadFailed.value = false
    try {
      saved.value = await store.read()
      reshow()
    } catch {
      loadFailed.value = true
    }
  }

  async function drain() {
    if (sending !== null) return
    while (waiting.length > 0) {
      const [first, ...rest] = waiting
      sending = first
      waiting = rest
      try {
        saved.value = await store.write(first.change)
      } catch (error) {
        if (!waiting.some(({ slot }) => slot === first.slot))
          tell(first.row, store.failureText(error))
      }
      sending = null
      reshow()
    }
  }

  /** Show `change` at once and write it, as the change of `row`. */
  function put(row: Row, change: C) {
    if (saved.value === null) return
    const slot = slotOf(row)
    for (const [told] of failures.value) if (slotOf(told) === slot) tell(told, null)
    waiting = [...waiting.filter((queued) => queued.slot !== slot), { row, slot, change }]
    reshow()
    void drain()
  }

  /** Why the last change of `row` did not hold, or nothing. */
  function failureOf(row: Row): string {
    return failures.value.get(row) ?? ''
  }

  return {
    /** The record as shown: null until it has been read. */
    record: computed(() => shown.value),
    loadFailed: computed(() => loadFailed.value),
    load,
    put,
    failureOf,
  }
}
