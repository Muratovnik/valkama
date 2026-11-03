/**
 * What pressing a path does, that a press always ends in something said, and where
 * the layer stands among the others.
 */
import { h } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppReferenceLinks } from '@/app/composables/useAppReferenceLinks.ts'

import InspectorReferenceScope from '@/widgets/work-item-inspector/components/InspectorReferenceScope.vue'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import { resolveDocuments } from '@/shared/api/documentApi.ts'
import type { ResolvedPath } from '@/shared/api/documentApi.ts'
import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'

import { workItemFixture } from '../fixtures/workItem.ts'
import {
  clipboard,
  CODE,
  drawn,
  FILE,
  FOLDER,
  server,
  SPACE,
  strong,
  underShell,
  unmountAll,
  weak,
} from '../support/documentLinks.ts'
import { firstAnswer, requestEntry } from '../support/inputRequests.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  resolveDocuments: vi.fn(),
}))

const resolve = vi.mocked(resolveDocuments)
const status = (wrapper: { get: (selector: string) => { text: () => string } }) =>
  wrapper.get('[role="status"]').text()

beforeEach(() => {
  resolve.mockReset()
  clipboard()
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

describe('what a press does', () => {
  it('copies a path it cannot open as written, keeps focus and says so in the status region', async () => {
    const writeText = clipboard()
    server()
    const { wrapper } = drawn([strong('docs/x.md:42')])
    expect(status(wrapper)).toBe('')
    await flushPromises()
    const button = wrapper.get<HTMLButtonElement>('button.rich-reference')
    button.element.focus()
    await button.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('docs/x.md:42')
    expect(document.activeElement).toBe(button.element)
    expect(status(wrapper)).toBe('Путь скопирован')
  })

  it('copies a tailed candidate without its tail', async () => {
    const writeText = clipboard()
    server()
    const { wrapper } = drawn([strong('docs/x.md.')])
    await flushPromises()
    await wrapper.get('button.rich-reference').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('docs/x.md')
  })

  it('says when the clipboard refuses', async () => {
    clipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    server()
    const { wrapper } = drawn([strong('docs/x.md')])
    await flushPromises()
    await wrapper.get('button.rich-reference').trigger('click')
    await flushPromises()
    expect(status(wrapper)).toBe('Не удалось скопировать — выделите путь вручную')
  })

  it('says the result of every press, the same sentence as well', async () => {
    server()
    const { wrapper, spoken } = drawn([strong('docs/x.md')])
    await flushPromises()
    const button = wrapper.get('button.rich-reference')
    await button.trigger('click')
    await flushPromises()
    await button.trigger('click')
    await flushPromises()
    expect(spoken()).toEqual(['Путь скопирован', 'Путь скопирован'])
  })

  it('waits for the answer when pressed early, and acts once for two presses', async () => {
    const writeText = clipboard()
    const answers: ((paths: ResolvedPath[]) => void)[] = []
    resolve.mockImplementation(
      () =>
        new Promise((settle) => {
          answers.push(settle)
        }),
    )
    const opened = vi.fn(() => true)
    const { wrapper } = drawn([strong('docs/a.md')], { openDocument: opened })
    await flushPromises()
    const button = wrapper.get('button.rich-reference')
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('title')).toContain('ещё проверяет')
    await button.trigger('click')
    await button.trigger('click')
    expect(opened).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
    answers[0]?.([{ path: 'docs/a.md', ...FILE }])
    await flushPromises()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
    expect(wrapper.get('button.rich-reference').attributes('aria-busy')).toBeUndefined()
  })

  it('passes each confirmed target to its opener, by the names the server gave', async () => {
    server({ 'docs/a.md': FILE, 'src/a.ts': CODE, 'docs/': FOLDER })
    const openDocument = vi.fn(() => true)
    const openFile = vi.fn(() => true)
    const openFolder = vi.fn(() => true)
    const { wrapper } = drawn(
      [strong('docs/a.md#kb:a7f3'), strong('src/a.ts:42'), strong('docs/')],
      { openDocument, openFile, openFolder },
    )
    await flushPromises()
    for (const button of wrapper.findAll('button.rich-reference')) await button.trigger('click')
    await flushPromises()
    expect(openDocument).toHaveBeenCalledExactlyOnceWith({
      project: 'demo',
      path: 'docs/a.md',
      suffix: '#kb:a7f3',
      line: null,
    })
    expect(openFile).toHaveBeenCalledExactlyOnceWith({
      project: 'demo',
      path: 'src/a.ts',
      suffix: ':42',
      line: 42,
    })
    expect(openFolder).toHaveBeenCalledExactlyOnceWith({
      project: 'demo',
      path: 'docs',
      suffix: '',
      line: null,
    })
  })

  it('copies a confirmed path while nothing opens it yet, and says why before the press', async () => {
    const writeText = clipboard()
    server({ 'src/a.ts': CODE, 'web/src': FOLDER })
    const { wrapper } = drawn([strong('src/a.ts:42'), weak('web/src')])
    await flushPromises()
    const buttons = wrapper.findAll('button.rich-reference')
    expect(buttons[0]?.attributes('title')).toBe(
      'Скопировать путь src/a.ts:42 — Valkama пока не умеет его открыть',
    )
    expect(buttons[0]?.classes()).toContain('copies')
    await buttons[0]?.trigger('click')
    await flushPromises()
    await buttons[1]?.trigger('click')
    await flushPromises()
    expect(writeText.mock.calls).toEqual([['src/a.ts:42'], ['web/src']])
  })

  it.each([
    ['refuses', () => false],
    [
      'throws',
      () => {
        throw new Error('gone')
      },
    ],
  ])('copies and says so when opening %s after the path was confirmed', async (_name, openFile) => {
    const writeText = clipboard()
    server({ 'src/a.ts': CODE })
    const { wrapper } = drawn([strong('src/a.ts')], { openFile })
    await flushPromises()
    await wrapper.get('button.rich-reference').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('src/a.ts')
    expect(status(wrapper)).toBe('Не удалось открыть — путь скопирован')
  })
})

/** A layer that says everything is text, the way a new task's preview does. */
const previewText = () => h(RichInlines, { nodes: [strong('docs/a.md'), weak('web/src')] })
const Preview = {
  setup() {
    provideReferenceLinks(() => null)
    return previewText
  },
}

/** The shell's layer with nothing below it that knows a space. */
const shellText = () => h({ render: () => h(RichInlines, { nodes: [strong('docs/a.md')] }) })
const ShellAlone = {
  setup() {
    useAppReferenceLinks({
      projects: () => [],
      openTarget: vi.fn(),
      openSession: vi.fn(),
      say: vi.fn(),
    })
    return shellText
  },
}

describe('where the layer stands', () => {
  it('is text under a layer that says everything is, as a new task preview is', async () => {
    server()
    const { wrapper } = underShell(Preview)
    await flushPromises()
    expect(wrapper.find('button.rich-reference').exists()).toBe(false)
    expect(wrapper.text()).toContain('docs/a.md')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('is text under the shell alone, which knows no space', async () => {
    const { wrapper } = underShell(ShellAlone)
    await flushPromises()
    expect(wrapper.find('button.rich-reference').exists()).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('in a card links a path and the card still links its own commit', async () => {
    server({ 'docs/a.md': FILE })
    const item = {
      ...workItemFixture('Task', 1),
      refs: [
        {
          kind: 'commit' as const,
          value: 'repo@a1b2c3d4e5',
          label: 'fix: one thing',
          author: 'agent',
          at: '2026-08-27T18:00:00Z',
        },
      ],
    }
    const nodes: RichInline[] = [
      strong('docs/a.md'),
      { kind: 'reference', code: false, reference: { kind: 'commit', value: 'a1b2c3d' } },
    ]
    const { wrapper } = underShell({
      render: () =>
        h(
          InspectorReferenceScope,
          { item, space: SPACE },
          { default: () => h(RichInlines, { nodes }) },
        ),
    })
    await flushPromises()
    const buttons = wrapper.findAll('button.rich-reference')
    expect(buttons.map((button) => button.text())).toEqual(['docs/a.md', 'a1b2c3d'])
    expect(buttons[1]?.attributes('title')).toBe('Показать коммит')
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ space: SPACE }, ['docs/a.md'])
  })

  it('in a question asks with the space of its own task, not the one open', async () => {
    server()
    const entry = requestEntry()
    entry.request.prompt = 'План лежит в docs/a.md.'
    underShell({
      render: () =>
        h(
          InspectorReferenceScope,
          { item: workItemFixture('Open card', 1), space: 'the-open-card' },
          { default: () => h(RequestCard, { entry, draft: EMPTY_DRAFT }) },
        ),
    })
    await flushPromises()
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      { space: planningSpaceEntity(entry.target.space_ref).resource_id },
      ['docs/a.md', 'docs/a.md.'],
    )
  })
})

/** A question whose options say where their plans are, in one line each. */
const route: InputRequestField = {
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options: [
    { id: 'keep', label: 'Keep', description: 'The plan is docs/a.md' },
    { id: 'merge', label: 'Merge', description: 'See [the merge plan](docs/b.md)' },
  ],
}

function question(answered: boolean): InputRequestEntry {
  const entry = requestEntry()
  entry.request.fields = [route]
  if (answered)
    entry.request = {
      ...entry.request,
      ...firstAnswer,
      status: 'answered',
      answers: { route: 'keep' },
      answered_by: 'user',
      by_person: true,
      resolved_at: '2026-10-24T12:00:00Z',
      revision: 2,
    }
  return entry
}

describe('a path in an option of a question', () => {
  // A control inside the option's label would both choose the option and act on the path.
  it('is text inside the label, and opens on the chevron, outside it', async () => {
    server()
    const { wrapper } = underShell({
      render: () => h(RequestCard, { entry: question(false), draft: EMPTY_DRAFT }),
    })
    await flushPromises()
    for (const label of wrapper.findAll('label'))
      expect(label.find('button').exists(), label.text()).toBe(false)
    const toggles = wrapper.findAll('button.request-option-toggle')
    expect(toggles).toHaveLength(2)
    for (const toggle of toggles) await toggle.trigger('click')
    await flushPromises()
    const details = wrapper.findAll('.request-option-detail button.rich-reference')
    expect(details.map((button) => button.text())).toEqual(['docs/a.md', 'the merge plan'])
    expect(details.every((button) => !button.element.closest('label'))).toBe(true)
    const asked = resolve.mock.calls.flatMap(([, paths]) => paths)
    expect(asked).toEqual(expect.arrayContaining(['docs/a.md', 'docs/b.md']))
  })

  it('in an answered question opens on the same chevron, as a link in a description does', async () => {
    server()
    const { wrapper } = underShell({
      render: () => h(RequestCard, { entry: question(true), draft: EMPTY_DRAFT }),
    })
    await flushPromises()
    expect(wrapper.find('label').exists()).toBe(false)
    const toggle = wrapper.find('.request-option button.request-option-toggle')
    await toggle.trigger('click')
    await flushPromises()
    const paths = wrapper.findAll('.request-option-detail button.rich-reference')
    expect(paths.map((button) => button.text())).toEqual(['docs/a.md'])
  })
})
