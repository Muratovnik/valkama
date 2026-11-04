/**
 * An item's plan anchor is a path of the card's: the mark in the head and the row in
 * Relations ask the server about it under the card's space, open what it confirmed by
 * what it answered, and otherwise copy the path as written and say so.
 */
import { h } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorIdentity from '@/widgets/work-item-inspector/components/InspectorIdentity.vue'
import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'

import type { DocumentOpener } from '@/entities/project-document/documentLinks.ts'

import { resolveDocuments } from '@/shared/api/documentApi.ts'

import { workItemFixture } from '../fixtures/workItem.ts'
import { clipboard, FILE, Layer, server, underShell, unmountAll } from '../support/documentLinks.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  resolveDocuments: vi.fn(),
}))

const SPACE = 'space-of-the-card'
const SOURCE = 'docs/a.md#kb:a7f3'
/** Written from a project registered inside the space's root, as a path may be. */
const NESTED = { ...FILE, project: 'nested', relative: 'packages/x/docs/a.md' }
const item = (source: string) => ({ ...workItemFixture('Anchored', 12), source })

const mark = (source: string, opener?: Partial<DocumentOpener>) =>
  underShell(
    {
      render: () =>
        h(InspectorIdentity, {
          item: item(source),
          reference: 'MAIN-12',
          resourceRef: { kind: 'planning-space', resource_id: SPACE },
        }),
    },
    opener,
  )

const row = (source: string, opener?: Partial<DocumentOpener>) =>
  underShell(
    {
      render: () =>
        h(
          Layer,
          { base: { space: SPACE } },
          {
            default: () =>
              h(InspectorRelations, {
                item: item(source),
                writable: false,
              }),
          },
        ),
    },
    opener,
  )

const controls = {
  mark: { draw: mark, selector: 'button.identity-source' },
  row: { draw: row, selector: '.ref-row .rich-reference' },
}

beforeEach(() => {
  vi.mocked(resolveDocuments).mockReset()
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

for (const [name, { draw, selector }] of Object.entries(controls)) {
  describe(`the ${name} of a plan anchor`, () => {
    it('asks about the path alone under the space of the card', async () => {
      clipboard()
      server({ 'docs/a.md': FILE })
      draw(SOURCE)
      await flushPromises()

      expect(resolveDocuments).toHaveBeenCalledExactlyOnceWith({ space: SPACE }, ['docs/a.md'])
    })

    it('opens what the server named, at the anchor as written, and copies nothing', async () => {
      const writeText = clipboard()
      server({ 'docs/a.md': NESTED })
      const openDocument = vi.fn(() => true)
      const { wrapper } = draw(SOURCE, { openDocument })
      await flushPromises()

      await wrapper.get(selector).trigger('click')
      await flushPromises()

      expect(openDocument).toHaveBeenCalledExactlyOnceWith({
        project: 'nested',
        path: 'packages/x/docs/a.md',
        suffix: '#kb:a7f3',
        line: null,
      })
      expect(writeText).not.toHaveBeenCalled()
    })

    it('copies the whole written source when the file is not there, and says why first', async () => {
      const writeText = clipboard()
      server()
      const openDocument = vi.fn(() => true)
      const { wrapper, spoken } = draw(SOURCE, { openDocument })
      await flushPromises()

      const control = wrapper.get(selector)
      expect(control.attributes('aria-label')).toBe(`Скопировать путь ${SOURCE} — такого пути нет`)
      await control.trigger('click')
      await flushPromises()

      expect(openDocument).not.toHaveBeenCalled()
      expect(writeText).toHaveBeenCalledExactlyOnceWith(SOURCE)
      expect(spoken()).toEqual(['Путь скопирован'])
    })

    it('copies and says so when the viewer refuses a confirmed file', async () => {
      const writeText = clipboard()
      server({ 'docs/a.md': FILE })
      const { wrapper, spoken } = draw(SOURCE, { openDocument: () => false })
      await flushPromises()

      await wrapper.get(selector).trigger('click')
      await flushPromises()

      expect(writeText).toHaveBeenCalledExactlyOnceWith(SOURCE)
      expect(spoken()).toEqual(['Не удалось открыть — путь скопирован'])
    })

    it('says it is waiting while the server has not answered', async () => {
      clipboard()
      vi.mocked(resolveDocuments).mockReturnValue(new Promise(() => {}))
      const { wrapper } = draw(SOURCE)
      await flushPromises()

      expect(wrapper.get(selector).attributes('aria-busy')).toBe('true')
    })
  })
}

describe('a source that holds no path', () => {
  const WORDS = 'Notion: the migration plan'

  it('has no mark in the head and asks the server nothing', async () => {
    const { wrapper } = mark(WORDS)
    await flushPromises()

    expect(wrapper.find('button.identity-source').exists()).toBe(false)
    expect(resolveDocuments).not.toHaveBeenCalled()
  })

  it('stands in Relations as the text it is', async () => {
    const { wrapper } = row(WORDS)
    await flushPromises()

    expect(wrapper.get('.ref-row .ref-value').text()).toBe(WORDS)
    expect(wrapper.find('.ref-row .rich-reference').exists()).toBe(false)
  })

  it('leaves no mark and no row for an item with no source', async () => {
    const { wrapper } = mark('')
    await flushPromises()

    expect(wrapper.find('button.identity-source').exists()).toBe(false)
    expect(row('').wrapper.find('.ref-row').exists()).toBe(false)
  })
})
