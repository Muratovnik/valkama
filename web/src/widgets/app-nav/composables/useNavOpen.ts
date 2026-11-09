import { useStorage } from '@vueuse/core'

/** Which nodes of the side panel's list the reader folded or opened, kept on this device. */
const STORAGE_KEY = 'valkama-nav-open'

/**
 * What a node of the list is to the memory: the list itself, a space, or the row a space's
 * quiet work is folded under.
 */
export type NavNode = 'work' | `space:${string}` | `quiet:${string}`

/** The quiet work of a space starts folded: the list is there for the work going on now. */
const foldedFirst = (node: NavNode) => node.startsWith('quiet:')

/** Whether each node of the list is open, and the way to fold or open one. */
export interface NavOpen {
  isOpen: (node: NavNode) => boolean
  set: (node: NavNode, open: boolean) => void
}

/**
 * The side panel's folded nodes, on this device as a lane's folding is.
 *
 * A node nobody folded is open, so a space arriving with its first work is seen at once;
 * only a fold is written, and opening a node again takes its entry out, so what is kept is
 * what the reader closed and nothing else. A space's quiet work is the other way round: it
 * starts folded, and only an opening is written. One instance serves the rail and the
 * phone's panel alike, since two readers of one key in a window would not hear each other.
 */
export function useNavOpen(): NavOpen {
  const folded = useStorage<Record<string, boolean>>(
    STORAGE_KEY,
    {},
    typeof localStorage === 'undefined' ? undefined : localStorage,
    {
      writeDefaults: false,
      onError() {
        // Storage that refuses the write keeps the folds for as long as the page.
      },
    },
  )
  return {
    isOpen: (node) =>
      foldedFirst(node) ? folded.value[node] === true : folded.value[node] !== false,
    set(node, open) {
      const next = { ...folded.value }
      if (open === !foldedFirst(node)) delete next[node]
      else next[node] = open
      folded.value = next
    },
  }
}
