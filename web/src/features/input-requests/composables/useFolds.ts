import { ref } from 'vue'

/**
 * Which rows of a form stand open, by id: an option's description in a field, a point in a
 * review. The state is the rows' own: a press opens or folds one, and nothing else does, except
 * that a refusal shows the row it is about. Two mechanisms used to do this for the two kinds.
 */
export function useFolds() {
  const opened = ref<ReadonlySet<string>>(new Set())
  const isOpen = (row: string) => opened.value.has(row)
  function toggle(row: string) {
    const next = new Set(opened.value)
    if (!next.delete(row)) next.add(row)
    opened.value = next
  }
  function show(row: string) {
    if (!isOpen(row)) toggle(row)
  }
  return { isOpen, show, toggle }
}
