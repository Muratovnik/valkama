/**
 * The sample table through the real parser and the real control: what a written text
 * asks the server, and what a press on it copies when nothing can be opened.
 */
import { h } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDocuments } from '@/shared/api/documentApi.ts'
import RichText from '@/shared/ui/RichText.vue'

import samples from '../fixtures/document-path-samples.json'
import {
  clipboard,
  FILE,
  Layer,
  server,
  SPACE,
  underShell,
  unmountAll,
} from '../support/documentLinks.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  resolveDocuments: vi.fn(),
}))

const resolve = vi.mocked(resolveDocuments)
const inText = samples.rows.filter((row) => row.where !== 'option-row')

function drawn(source: string, opener = {}) {
  return underShell(
    {
      render: () =>
        h(Layer, { base: { space: SPACE } }, { default: () => h(RichText, { source }) }),
    },
    opener,
  )
}

beforeEach(() => {
  resolve.mockReset()
  clipboard()
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

describe('the sample table', () => {
  const strong = inText.filter((row) => row.form === 'strong' || row.form === 'copy-only')

  it.each(strong.map((row) => [row.text, row] as const))(
    '%s asks for its paths and copies as written',
    async (_text, row) => {
      const writeText = clipboard()
      server()
      const { wrapper } = drawn(row.text)
      await flushPromises()
      const asked = resolve.mock.calls.flatMap(([, paths]) => paths)
      for (const path of row.paths) expect(asked).toContain(path)
      if (row.form === 'copy-only') expect(resolve).not.toHaveBeenCalled()
      const control = wrapper.get('.rich-reference')
      expect(control.classes()).toContain('copies')
      await control.trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledExactlyOnceWith(row.copy)
      expect(wrapper.get('[role="status"]').text()).toBe('Путь скопирован')
    },
  )

  it.each(inText.filter((row) => row.form === 'weak').map((row) => [row.text, row] as const))(
    '%s stays what it was until the server confirms it',
    async (_text, row) => {
      server()
      const { wrapper } = drawn(row.text)
      await flushPromises()
      expect(wrapper.find('.rich-reference').exists()).toBe(false)
      expect(wrapper.text()).toContain(row.candidate)
    },
  )

  it.each(inText.filter((row) => row.form === 'none').map((row) => [row.text] as const))(
    '%s is no path control at all',
    async (text) => {
      server()
      const { wrapper } = drawn(text)
      await flushPromises()
      expect(wrapper.find('.rich-reference').exists()).toBe(false)
      expect(resolve).not.toHaveBeenCalled()
    },
  )
})

describe('a caption, through the component', () => {
  it('is what a link shows, in place of its address, while it copies and once it opens', async () => {
    server({ 'docs/plan.md': FILE })
    const { wrapper } = drawn('[план **работ**](docs/plan.md#kb:a7f3) и [нет](docs/gone.md)', {
      openDocument: () => true,
    })
    await flushPromises()
    const [open, gone] = wrapper.findAll('.rich-reference')
    expect(open?.text()).toBe('план работ')
    expect(open?.get('strong').text()).toBe('работ')
    expect(open?.attributes('aria-label')).toBe(
      'план работ — Открыть документ в Valkama: docs/plan.md#kb:a7f3',
    )
    expect(gone?.text()).toBe('нет')
    expect(wrapper.text()).not.toContain('docs/')
  })

  it('is what a picture shows, which is a link to the file', async () => {
    server()
    const { wrapper } = drawn('![схема](docs/a.png)')
    await flushPromises()
    expect(wrapper.get('.rich-reference').text()).toBe('схема')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('is what a link reads as where it cannot be a control', async () => {
    const { wrapper } = underShell({
      render: () => h(RichText, { source: '[план](docs/plan.md) и ![схема](a.png)' }),
    })
    await flushPromises()
    expect(wrapper.find('.rich-reference').exists()).toBe(false)
    expect(wrapper.text()).toContain('план и схема')
    expect(wrapper.text()).not.toContain('docs/plan.md')
  })
})
