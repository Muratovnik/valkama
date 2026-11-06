import { ref } from 'vue'

/**
 * Which options of one field have their description open in their row. The state is the
 * row's own: a press opens or folds it, and nothing else does.
 */
export function useOpenedOptions() {
  const opened = ref<ReadonlySet<string>>(new Set())
  const isOpen = (option: string) => opened.value.has(option)
  function toggle(option: string) {
    const next = new Set(opened.value)
    if (!next.delete(option)) next.add(option)
    opened.value = next
  }
  return { isOpen, toggle }
}
