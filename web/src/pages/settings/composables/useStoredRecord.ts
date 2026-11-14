import { computed, ref, shallowRef } from 'vue'

/** Where a record is kept: how it is read, how it is written, and how a failure is said. */
interface RecordStore<R> {
  failureText: (error: unknown) => string
  read: () => Promise<R>
  /** Writes the whole record and answers with what the server kept. */
  write: (record: R) => Promise<R>
}

/**
 * A record the server keeps, and writes that keep the screen answering.
 *
 * What is shown is what was asked for last; `saved` is what the server last
 * confirmed, and a write that fails puts it back. No control is disabled while a
 * write is out, because a disabled control drops the keyboard's focus, so presses
 * can arrive during one. The record is written whole, so only the newest one needs
 * to go next, and writes never overlap, so an older one cannot land last.
 *
 * A failure is told against the row whose change was refused (`Row`), so that it
 * stands beside what was changed.
 */
export function useStoredRecord<R, Row extends string>(store: RecordStore<R>) {
  const saved = shallowRef<R | null>(null)
  const shown = shallowRef<R | null>(null)
  const loadFailed = ref(false)
  const failure = shallowRef<{ row: Row; text: string } | null>(null)
  let next: { record: R; row: Row } | null = null
  let writing = false

  async function load() {
    loadFailed.value = false
    try {
      const record = await store.read()
      saved.value = record
      shown.value = record
    } catch {
      loadFailed.value = true
    }
  }

  async function drain() {
    if (writing) return
    writing = true
    while (next !== null) {
      const { row, record } = next
      next = null
      try {
        const stored = await store.write(record)
        saved.value = stored
        if (next === null) shown.value = stored
      } catch (error) {
        // A newer record carries this change too and is about to answer for it.
        if (next === null) {
          shown.value = saved.value
          failure.value = { row, text: store.failureText(error) }
        }
      }
    }
    writing = false
  }

  /** Show `record` at once and write it, as the change of `row`. */
  function put(row: Row, record: R) {
    shown.value = record
    failure.value = null
    next = { row, record }
    void drain()
  }

  /** Why the last change of `row` did not hold, or nothing. */
  function failureOf(row: Row): string {
    return failure.value?.row === row ? failure.value.text : ''
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
