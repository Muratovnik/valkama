import { useStorage } from '@vueuse/core'

/** Which nodes of the side panel's list the reader folded or opened, kept on this device. */
const STORAGE_KEY = 'valkama-nav-open'

/**
 * What a node of the list is to the memory: the list itself, a space, the sessions outside
 * any space, or one of the rows a space's other work is folded under: the items held by a
 * session at work on others, what has waited long, and the items silent for over a day. The
 * sessions outside any space have a long wait of their own, `long:` and no key. A quiet fold
 * keeps the key the one fold of quiet work had, so a device that opened it keeps it open.
 */
export type NavNode =
  'work' | 'elsewhere' | `space:${string}` | `held:${string}` | `long:${string}` | `quiet:${string}`

/** The folded work starts folded: the list is there for the work going on now. */
const foldedFirst = (node: NavNode) => /^(?:held|long|quiet):/u.test(node)

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
 * what the reader closed and nothing else. A space's folded work is the other way round: each
 * fold starts folded, and only an opening is written, each on its own. One instance serves the rail and the
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
