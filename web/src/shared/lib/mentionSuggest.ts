import { watch } from 'vue'
import type { Ref } from 'vue'

import { searchSpaceDocuments } from '@/shared/api/documentApi.ts'
import type { FoundDocument } from '@/shared/api/documentApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { activePlanningWorkItems, searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import { splitIdentifiers } from '@/shared/lib/textReferences.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'
import { SUGGEST_LIMIT } from '@/shared/ui/useEditorSuggestions.ts'

/** One kind of thing an `@` offers, asked with what was typed after it. */
type MentionSource = (query: string, signal: AbortSignal) => Promise<EditorSuggestion[]>

/** The most items one comment tells through the interface; the server refuses more. */
const MOST_TOLD = 20

/**
 * The tasks of one planning space, found by the same search the related-work picker
 * uses, so a reference written here means the same item a link added there would.
 * With nothing typed yet it offers what is being worked on, so an `@` alone already
 * has rows to take. A row names its state as the owner has states named.
 */
function workItems(
  space: () => string,
  omit: () => string | undefined,
  stateName: ReturnType<typeof useStateName>,
): MentionSource {
  return async (query, signal) => {
    const found = query
      ? await searchPlanningWorkItems(query, space(), signal)
      : await activePlanningWorkItems(space(), signal)
    const own = omit()
    return found
      .filter((entry) => !own || entry.work_item_id !== own)
      .map((entry) => ({
        key: entry.work_item_id,
        kind: 'task' as const,
        name: entry.reference,
        reference: entry.reference,
        title: entry.title,
        detail: stateName(entry.state),
      }))
  }
}

/** The characters a link's address cannot hold as written, which `textReferences` decodes back. */
const UNSAFE_IN_ADDRESS = /[\s%()<>]/gu
/** What would end or mark up a link's text. */
const MARKUP_IN_LABEL = /[\\[\]*_`]/gu

/**
 * A Markdown link to a file of the space's project, named by its file name. Its address
 * is the path from the project's root, which is what a link without a scheme is read
 * from (`documentLink`), so it opens through the same resolver as one typed by hand.
 */
export function fileLink(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replaceAll(MARKUP_IN_LABEL, String.raw`\$&`)
  const address = path.replaceAll(UNSAFE_IN_ADDRESS, (character) =>
    [...new TextEncoder().encode(character)]
      .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
      .join(''),
  )
  return `[${name}](${address})`
}

const fileRow = ({ path, text }: FoundDocument): EditorSuggestion => ({
  key: `file:${path}`,
  kind: 'file',
  name: path.slice(path.lastIndexOf('/') + 1),
  reference: fileLink(path),
  title: path,
  detail: text,
})

/**
 * The Markdown files of the project the space is bound to, by the server's document
 * search. Nothing is offered before something is typed: a project has more files than
 * a list holds, and none of them is the one being worked on.
 */
function projectFiles(space: () => string): MentionSource {
  return async (query, signal) => {
    if (!query) return []
    const found = await searchSpaceDocuments(space(), query, signal)
    return found.map((hit) => fileRow(hit))
  }
}

/**
 * The rows of every source, in the sources' order, each given an even share of what
 * the list shows; a share one source leaves unused goes to the others.
 */
function shared(lists: readonly EditorSuggestion[][]): EditorSuggestion[] {
  const taken = lists.map(() => 0)
  let left = SUGGEST_LIMIT
  let added = true
  while (left > 0 && added) {
    added = false
    for (const [index, list] of lists.entries()) {
      if (left > 0 && (taken[index] ?? 0) < list.length) {
        taken[index] = (taken[index] ?? 0) + 1
        left -= 1
        added = true
      }
    }
  }
  return lists.flatMap((list, index) => list.slice(0, taken[index]))
}

/**
 * What `@` offers in an editor that writes about work: the tasks of one planning space
 * and the files of the project it is bound to, grouped by kind. A source is added to
 * the list below, with its kind's name in the editor's words. A source that fails
 * leaves the others' rows; the search fails only when every source did.
 *
 * `space` is the space's `planning_space_id`. `omit` leaves one item out — the card
 * being written on, since a text that links to its own item says nothing; a task that
 * does not exist yet has nothing to leave out. Called where a component sets up, since
 * the state names follow the interface's language and the owner's choice.
 */
export function mentionSuggest(space: () => string, omit: () => string | undefined = () => '') {
  const sources: readonly MentionSource[] = [
    workItems(space, omit, useStateName()),
    projectFiles(space),
  ]
  return async (query: string, signal: AbortSignal): Promise<EditorSuggestion[]> => {
    const settled = await Promise.allSettled(sources.map((source) => source(query, signal)))
    const found = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    const failed = settled.find((result) => result.status === 'rejected')
    if (!found.length && failed) throw failed.reason
    return shared(found)
  }
}

/**
 * A comment field on one item: its `@` list, and the tasks the comment tells. Those
 * are the tasks chosen from the list while their number still stands in the text. A
 * number typed by hand is a link and tells nobody, as the server reads a comment; a
 * chosen one is a mention, sent in the comment's `mentions`. A text emptied, sent or
 * left for another item's forgets what was chosen in it.
 */
export function useCommentMentions(
  host: { readonly item: Pick<WorkItem, 'planning_space_id' | 'work_item_id'> },
  text: Readonly<Ref<string>>,
) {
  const chosen = new Set<string>()
  watch(text, (value) => {
    if (!value.trim()) chosen.clear()
  })
  return {
    suggest: mentionSuggest(
      () => host.item.planning_space_id,
      () => host.item.work_item_id,
    ),
    chose(row: EditorSuggestion) {
      if (row.kind === 'task') chosen.add(row.reference)
    },
    /** The comment write's `mentions`, or nothing when it tells nobody. */
    told(): { mentions?: string[] } {
      const named = new Set(
        splitIdentifiers(text.value).flatMap((run) =>
          typeof run !== 'string' && run.kind === 'work-item' ? [run.value] : [],
        ),
      )
      const told = [...chosen].filter((reference) => named.has(reference)).slice(0, MOST_TOLD)
      return told.length ? { mentions: told } : {}
    },
  }
}
