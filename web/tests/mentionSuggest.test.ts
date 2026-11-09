/**
 * What `@` offers in an editor that writes about work, and which chosen tasks a
 * comment tells.
 *
 * The expectations come from the decision that `@` offers both tasks and the
 * project's files, a file written as a Markdown link from the project's root, and
 * from the connection contract's "Mentions": a number in a comment's text tells
 * nobody, the items in `mentions` are told, and the interface names at most 20.
 */
import { nextTick, ref } from 'vue'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { searchSpaceDocuments } from '@/shared/api/documentApi.ts'
import { activePlanningWorkItems, searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import { fileLink, mentionSuggest, useCommentMentions } from '@/shared/lib/mentionSuggest.ts'
import { documentLink, documentParts } from '@/shared/lib/textReferences.ts'
import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'

vi.mock('@/shared/api/planningSearchApi.ts', () => ({
  activePlanningWorkItems: vi.fn(),
  searchPlanningWorkItems: vi.fn(),
}))
vi.mock('@/shared/api/documentApi.ts', () => ({ searchSpaceDocuments: vi.fn() }))
// A task's state is named by the one function the interface names states with; its own
// rules are `stateNames.test.ts`'s, so here it only marks what passed through it.
vi.mock('@/shared/lib/useStateName.ts', () => ({
  useStateName: () => (state: { name: string }) => `named ${state.name}`,
}))

const SPACE = '00000000-0000-4000-8000-000000000001'
const OWN = '00000000-0000-4000-8000-000000000099'
const signal = new AbortController().signal

const item = (number: number) => ({
  work_item_id:
    number === 99 ? OWN : `00000000-0000-4000-8000-0000000001${String(number).padStart(2, '0')}`,
  planning_space_id: SPACE,
  reference: `MAIN-${number}`,
  title: `Task ${number}`,
  state: { name: 'Doing' },
  claim_ref: '',
})
const found = (path: string, line = 0, text = '') => ({ path, line, text })
type Found = Awaited<ReturnType<typeof searchPlanningWorkItems>>

const items = (...numbers: number[]) => numbers.map((number) => item(number)) as unknown as Found
const kinds = (kind: string, count: number) => Array.from({ length: count }, () => kind)

describe('mentionSuggest', () => {
  beforeEach(() => {
    vi.mocked(searchPlanningWorkItems).mockResolvedValue(items(1, 2))
    vi.mocked(activePlanningWorkItems).mockResolvedValue(items(3))
    vi.mocked(searchSpaceDocuments).mockResolvedValue([found('docs/plan.md')])
  })

  it('offers the tasks and then the files of the space, each as its kind', async () => {
    const rows = await mentionSuggest(() => SPACE)('pl', signal)
    expect(rows.map(({ kind, name, reference }) => [kind, name, reference])).toEqual([
      ['task', 'MAIN-1', 'MAIN-1'],
      ['task', 'MAIN-2', 'MAIN-2'],
      ['file', 'plan.md', '[plan.md](docs/plan.md)'],
    ])
    expect(rows.filter((row) => row.kind === 'task').map((row) => row.detail)).toEqual([
      'named Doing',
      'named Doing',
    ])
    expect(searchPlanningWorkItems).toHaveBeenCalledWith('pl', SPACE, signal)
    expect(searchSpaceDocuments).toHaveBeenCalledWith(SPACE, 'pl', signal)
  })

  it('with nothing typed offers what is being worked on and no file', async () => {
    const rows = await mentionSuggest(() => SPACE)('', signal)
    expect(rows.map((row) => row.reference)).toEqual(['MAIN-3'])
    expect(searchSpaceDocuments).not.toHaveBeenCalled()
  })

  it('leaves out the item being written on', async () => {
    vi.mocked(searchPlanningWorkItems).mockResolvedValue(items(1, 99))
    const rows = await mentionSuggest(
      () => SPACE,
      () => OWN,
    )('ma', signal)
    expect(rows.filter((row) => row.kind === 'task').map((row) => row.reference)).toEqual([
      'MAIN-1',
    ])
  })

  it('gives each kind its share of eight rows, and a share one leaves goes to the other', async () => {
    vi.mocked(searchPlanningWorkItems).mockResolvedValue(
      items(...Array.from({ length: 10 }, (_, n) => n + 1)),
    )
    vi.mocked(searchSpaceDocuments).mockResolvedValue(
      Array.from({ length: 10 }, (_, n) => found(`docs/page-${n}.md`)),
    )
    const even = await mentionSuggest(() => SPACE)('p', signal)
    expect(even.map((row) => row.kind)).toEqual([...kinds('task', 4), ...kinds('file', 4)])
    vi.mocked(searchSpaceDocuments).mockResolvedValue([found('docs/plan.md')])
    const filled = await mentionSuggest(() => SPACE)('p', signal)
    expect(filled.map((row) => row.kind)).toEqual([...kinds('task', 7), 'file'])
  })

  it('keeps the rows of a source that answered when another failed, and fails when all did', async () => {
    vi.mocked(searchSpaceDocuments).mockRejectedValue(new Error('refused'))
    const rows = await mentionSuggest(() => SPACE)('pl', signal)
    expect(rows.map((row) => row.kind)).toEqual(['task', 'task'])
    vi.mocked(searchPlanningWorkItems).mockRejectedValue(new Error('gone'))
    await expect(mentionSuggest(() => SPACE)('pl', signal)).rejects.toThrow('gone')
  })
})

describe('fileLink', () => {
  it('names a file by its name and addresses it from the project root, as a link the text reads back', () => {
    for (const path of [
      'docs/plan.md',
      'docs/a plan (draft).md',
      'docs/100%.md',
      'docs/план_[1].md',
    ]) {
      const link = fileLink(path)
      const address = /\]\((?<address>[^)]*)\)$/u.exec(link)?.groups?.address ?? ''
      const reference = documentLink(address)
      expect(reference, link).not.toBeNull()
      if (reference) expect(documentParts(reference).paths, link).toEqual([path])
    }
    expect(fileLink('docs/plan.md')).toBe('[plan.md](docs/plan.md)')
    expect(fileLink('docs/a plan (draft).md')).toBe(
      '[a plan (draft).md](docs/a%20plan%20%28draft%29.md)',
    )
    expect(fileLink('docs/план_[1].md')).toBe(String.raw`[план\_\[1\].md](docs/план_[1].md)`)
  })
})

const task = (reference: string): EditorSuggestion => ({
  key: reference,
  kind: 'task',
  name: reference,
  reference,
  title: '',
  detail: '',
})

describe('useCommentMentions', () => {
  const host = { item: { planning_space_id: SPACE, work_item_id: OWN } }

  it('tells the tasks chosen from the list while their number stands in the text, and no other', async () => {
    const text = ref('')
    const mentions = useCommentMentions(host, text)
    mentions.chose(task('MAIN-1'))
    mentions.chose(task('MAIN-2'))
    mentions.chose({ ...task('docs/plan.md'), kind: 'file' })
    // MAIN-3 was typed, not chosen; MAIN-2 was chosen and then deleted.
    text.value = 'See MAIN-1 and MAIN-3, and MAIN-1 again'
    await nextTick()
    expect(mentions.told()).toEqual({ mentions: ['MAIN-1'] })
    text.value = 'MAIN-12 is another number'
    await nextTick()
    expect(mentions.told()).toEqual({})
    // A text emptied, as sending it or leaving for another item does, forgets the choice.
    text.value = ''
    await nextTick()
    text.value = 'See MAIN-1'
    await nextTick()
    expect(mentions.told()).toEqual({})
  })

  it('tells at most the twenty the interface may name, and offers from the item space', async () => {
    const references = Array.from({ length: 25 }, (_, n) => `MAIN-${n + 1}`)
    const text = ref(references.join(' '))
    const mentions = useCommentMentions(host, text)
    for (const reference of references) mentions.chose(task(reference))
    expect(mentions.told().mentions).toHaveLength(20)
    vi.mocked(searchPlanningWorkItems).mockResolvedValue(items(1))
    vi.mocked(searchSpaceDocuments).mockResolvedValue([])
    await mentions.suggest('ma', signal)
    expect(searchPlanningWorkItems).toHaveBeenCalledWith('ma', SPACE, signal)
  })
})
