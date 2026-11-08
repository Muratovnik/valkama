/**
 * A path written in a text: what the server's answer makes of it, and how few
 * questions that costs.
 */
import { nextTick, shallowRef } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentRefusal, resolveDocuments } from '@/shared/api/documentApi.ts'
import type { DocumentBase, ResolvedPath } from '@/shared/api/documentApi.ts'
import type { RichInline } from '@/shared/lib/richText.ts'

import {
  clipboard,
  CODE,
  drawn,
  FILE,
  FOLDER,
  layered,
  network,
  REFUSED,
  server,
  strong,
  underShell,
  unmountAll,
  weak,
  words,
} from '../support/documentLinks.ts'
import { hintOf } from '../support/hint.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  resolveDocuments: vi.fn(),
}))

const resolve = vi.mocked(resolveDocuments)

beforeEach(() => {
  resolve.mockReset()
  clipboard()
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('how few questions a text costs', () => {
  it('asks about 200 paths in at most four requests, sharing a tick', async () => {
    server()
    drawn(Array.from({ length: 200 }, (_, index) => strong(`docs/p${index}.md`)))
    await flushPromises()
    expect(resolve.mock.calls.length).toBeLessThanOrEqual(4)
    const asked = resolve.mock.calls.flatMap(([, paths]) => paths)
    expect(new Set(asked).size).toBe(200)
    expect(resolve.mock.calls.every(([, paths]) => paths.length <= 64)).toBe(true)
  })

  it('does not ask again on a render for any answer, a negative one included', async () => {
    server({ 'a/ok.md': FILE, 'a/out.md': REFUSED, 'a/two.md': { status: 'ambiguous' } })
    const nodes = shallowRef<RichInline[]>([
      strong('a/ok.md'),
      strong('a/gone.md'),
      strong('a/out.md'),
      strong('a/two.md'),
    ])
    underShell(layered(() => nodes.value))
    await flushPromises()
    expect(resolve).toHaveBeenCalledTimes(1)
    // A new render of the same text, then the same paths written again.
    nodes.value = [...nodes.value]
    await flushPromises()
    nodes.value = [...nodes.value, strong('a/gone.md')]
    await flushPromises()
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('does not keep "the server did not answer": a later render or a press asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    resolve.mockRejectedValueOnce(new TypeError('offline'))
    const nodes = shallowRef<RichInline[]>([strong('a/b.md')])
    const { wrapper } = underShell(layered(() => nodes.value))
    await flushPromises()
    const button = wrapper.get('.rich-reference')
    expect(hintOf(button)).toContain('сервер Valkama не ответил')
    // The failure itself re-renders, and neither that nor the next render starts a storm.
    expect(resolve).toHaveBeenCalledTimes(1)
    nodes.value = [...nodes.value]
    await flushPromises()
    expect(resolve).toHaveBeenCalledTimes(1)

    resolve.mockRejectedValueOnce(new TypeError('offline'))
    await button.trigger('click')
    await flushPromises()
    expect(resolve).toHaveBeenCalledTimes(2)

    server({ 'a/b.md': FILE })
    vi.setSystemTime(Date.now() + 11_000)
    nodes.value = [...nodes.value]
    await flushPromises()
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(hintOf(wrapper.get('.rich-reference'))).toContain('пока не умеет')
  })

  it('remembers a request the server itself refused, which would only be refused again', async () => {
    resolve.mockRejectedValue(new DocumentRefusal(403, null))
    const nodes = shallowRef<RichInline[]>([strong('a/b.md')])
    const { wrapper } = underShell(layered(() => nodes.value))
    await flushPromises()
    nodes.value = [...nodes.value]
    await flushPromises()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(hintOf(wrapper.get('.rich-reference'))).toContain('не открывает')
  })

  it('in a space with no root asks once, then copies a relative path and resolves an absolute one', async () => {
    const relative = Array.from({ length: 70 }, (_, index) => strong(`docs/p${index}.md`))
    resolve.mockImplementation((_base, paths) =>
      Promise.resolve(
        paths.map((path): ResolvedPath =>
          path.startsWith('C:')
            ? { path, status: 'file', project: 'demo', relative: 'x.md', markdown: true }
            : { path, status: 'space_unbound' },
        ),
      ),
    )
    const { wrapper } = drawn([...relative, weak('web/src', true), strong('C:/work/x.md')])
    await flushPromises()
    // The answer for the first batch spared the other relative paths a request.
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolve.mock.calls[1]?.[1]).toEqual(['C:/work/x.md'])
    const buttons = wrapper.findAll('.rich-reference')
    expect(hintOf(buttons[0])).toContain('у пространства нет корня проекта')
    expect(wrapper.find('code.rich-code').text()).toBe('web/src')
    expect(hintOf(buttons.at(-1))).not.toContain('нет корня')
  })

  it('with no space at all asks only about what needs no root', async () => {
    server({ '~/x.md': FILE })
    const { wrapper } = underShell(layered(() => [strong('docs/a.md'), strong('~/x.md')], {}))
    await flushPromises()
    expect(resolve.mock.calls.flatMap(([, paths]) => paths)).toEqual(['~/x.md'])
    expect(hintOf(wrapper.findAll('.rich-reference')[0])).toContain('нет корня')
  })

  it('never sends a network path, and copies it', async () => {
    const writeText = clipboard()
    const { wrapper } = drawn([network(String.raw`\\server\share\x`)])
    await flushPromises()
    expect(resolve).not.toHaveBeenCalled()
    const button = wrapper.get('.rich-reference')
    expect(hintOf(button)).toContain('сетевой путь')
    await button.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(String.raw`\\server\share\x`)
  })

  it('asks each base on its own: a card that moves to another space starts over', async () => {
    server()
    const base = shallowRef<DocumentBase>({ space: 'one' })
    underShell({
      render: () => layered(() => [strong('a/b.md')], base.value).render(),
    })
    await flushPromises()
    base.value = { space: 'two' }
    await nextTick()
    await flushPromises()
    expect(resolve.mock.calls.map(([asked]) => asked)).toEqual([{ space: 'one' }, { space: 'two' }])
  })
})

describe('what an answer makes of a candidate', () => {
  it('tells the reason in the tooltip and the name of a copy button', async () => {
    server({ 'a/two.md': { status: 'ambiguous' }, 'a/out.md': REFUSED })
    const { wrapper } = drawn([strong('a/two.md'), strong('a/out.md'), strong('a/gone.md')])
    await flushPromises()
    const buttons = wrapper.findAll('.rich-reference')
    expect(buttons.map((button) => hintOf(button))).toEqual([
      'Скопировать путь a/two.md — такой путь есть в нескольких проектах',
      'Скопировать путь a/out.md — он вне проектов Valkama',
      'Скопировать путь a/gone.md — такого пути нет',
    ])
    for (const button of buttons) {
      expect(button.attributes('aria-label')).toBe(hintOf(button))
      expect(button.classes()).toContain('copies')
    }
  })

  it('links the variant that exists: the one with the tail only when it alone does', async () => {
    server({ 'docs/v1.': FOLDER, 'docs/both.md': FILE, 'docs/both.md.': FILE })
    const { wrapper } = drawn([weak('docs/v1.'), strong('docs/both.md.')], {
      openFolder: () => true,
      openDocument: () => true,
    })
    await flushPromises()
    const buttons = wrapper.findAll('.rich-reference')
    expect(buttons[0]?.text()).toBe('docs/v1.')
    expect(hintOf(buttons[0])).toBe('Открыть папку в VS Code: docs/v1.')
    // Both exist: the tail is prose, and stands after the control.
    expect(buttons[1]?.text()).toBe('docs/both.md')
    expect(wrapper.text()).toContain('docs/both.md.')
  })

  it('leaves a weak form text until it is confirmed, and never a copy button', async () => {
    server({ 'web/src': FOLDER })
    const { wrapper } = drawn(
      [weak('web/src', true), weak('owner/repo', true), weak('client/server/protocol')],
      { openFolder: () => true },
    )
    expect(wrapper.findAll('.rich-reference')).toHaveLength(0)
    await flushPromises()
    const buttons = wrapper.findAll('.rich-reference')
    expect(buttons.map((button) => button.text())).toEqual(['web/src'])
    expect(buttons[0]?.classes()).not.toContain('copies')
    expect(wrapper.text()).toContain('client/server/protocol')
  })

  it('shows a caption, keeping the visible words in the accessible name', async () => {
    server({ 'docs/a.md': FILE })
    const { wrapper } = drawn([strong('docs/a.md#kb:a7f3', { caption: words('план') })], {
      openDocument: () => true,
    })
    await flushPromises()
    const button = wrapper.get('.rich-reference')
    expect(button.text()).toBe('план')
    expect(button.attributes('aria-label')).toBe(
      'план — Открыть документ в Valkama: docs/a.md#kb:a7f3',
    )
  })

  it('names where each confirmed target leads', async () => {
    server({ 'docs/a.md': FILE, 'src/a.ts': CODE, 'docs/': FOLDER })
    const { wrapper } = drawn([strong('docs/a.md'), strong('src/a.ts:42'), strong('docs/')], {
      openDocument: () => true,
      openFile: () => true,
      openFolder: () => true,
      editor: 'Cursor',
    })
    await flushPromises()
    const titles = wrapper.findAll('.rich-reference').map((b) => hintOf(b))
    expect(titles).toEqual([
      'Открыть документ в Valkama: docs/a.md',
      'Открыть в Cursor: src/a.ts, строка 42',
      'Открыть папку в Cursor: docs/',
    ])
  })
})
