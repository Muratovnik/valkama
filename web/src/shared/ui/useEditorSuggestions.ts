import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'

/** How long typing pauses before the host is asked, and how many rows are shown. */
const SUGGEST_DELAY = 200
const SUGGEST_LIMIT = 8
/** A `#` that starts a word, then the query up to the caret, which may not be begun yet. */
const TRIGGER = /(?:^|[\s([{])#([^\s#]{0,40})$/u

/**
 * The `#` being typed in an editor and what the host offered for it. It reads the
 * text up to the caret and nothing else, so a `#` is a `#` whoever wrote it: the
 * toolbar's mention button opens this by writing one, and so does a keyboard.
 */
export function useEditorSuggestions(options: {
  /** The field's text and its caret, or null while there is no field to read. */
  read: () => { caret: number; text: string } | null
  /** The host's search, or nothing where this text has no space to search in. */
  suggest: () =>
    ((query: string, signal: AbortSignal) => Promise<readonly EditorSuggestion[]>) | undefined
}) {
  /** Where the `#` stands while a query is being typed; null when none is. */
  const trigger = ref<{ query: string; start: number } | null>(null)
  const choices = ref<readonly EditorSuggestion[]>([])
  const searched = ref(false)
  const active = ref(0)
  let request: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const open = computed(() => trigger.value !== null && searched.value)

  function cancel() {
    clearTimeout(timer)
    request?.abort()
    request = null
  }
  function close() {
    cancel()
    trigger.value = null
    choices.value = []
    searched.value = false
  }
  onBeforeUnmount(cancel)

  /** Read the query at the caret, and ask for it once typing pauses. */
  function track() {
    const suggest = options.suggest()
    const field = options.read()
    if (!suggest || !field) return
    const match = TRIGGER.exec(field.text.slice(0, field.caret))
    if (match === null) {
      close()
      return
    }
    const query = match[1] ?? ''
    const start = field.caret - query.length - 1
    if (trigger.value?.query === query && trigger.value.start === start) return
    trigger.value = { query, start }
    cancel()
    timer = setTimeout(() => {
      const controller = new AbortController()
      request = controller
      void suggest(query, controller.signal)
        .then((found) => {
          if (controller.signal.aborted || trigger.value?.query !== query) return
          choices.value = found.slice(0, SUGGEST_LIMIT)
          searched.value = true
          active.value = 0
        })
        .catch(() => {
          if (controller.signal.aborted) return
          choices.value = []
          searched.value = true
        })
    }, SUGGEST_DELAY)
  }

  return { active, choices, close, open, track: () => void nextTick(track), trigger }
}
