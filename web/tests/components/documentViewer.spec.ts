/**
 * The viewer's states, and reading a file again: every row of the table of what a
 * reader sees, from what the server answered.
 */
import { nextTick } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { ProjectDocument } from '@/shared/api/documentApi.ts'

import {
  blocks,
  body,
  control,
  disk,
  file,
  opened,
  read,
  refused,
  scrolledInto,
  status,
  surface,
  viewerSuite,
} from '../support/documentViewer.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  readDocument: vi.fn(),
  resolveDocuments: vi.fn(),
}))

viewerSuite()

const PLAN = `---
status: proposed
card: 12
---

# The plan <!-- kb:head -->

First paragraph with a [note](note.md) in it.

## Part two

<!-- kb:a7f3 -->
Second paragraph, under its anchor.

Third paragraph.
`

const refreshControl = () => control('Refresh')
const closeControl = () => control('Close the document')

const comeBack = async () => {
  window.dispatchEvent(new Event('focus'))
  await flushPromises()
  await nextTick()
}

describe('the states of a document', () => {
  it('while it is read: the path, a mark that it waits, and only Close', async () => {
    read.mockReturnValue(new Promise(() => {}))
    await opened()
    expect(surface()?.querySelector('.document-where')?.textContent).toMatch(
      /demo ·\s*docs\/plan\.md/u,
    )
    expect(surface()?.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(refreshControl()).toBeUndefined()
    expect(closeControl()).toBeDefined()
  })

  it('open: outlined, without comments, with its front matter as facts', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened()
    const text = surface()?.textContent ?? ''
    expect(surface()?.querySelector('.document-text h2')?.textContent?.trim()).toBe('The plan')
    expect(surface()?.querySelector('.document-text h3')?.textContent?.trim()).toBe('Part two')
    expect(surface()?.querySelector('.overlay-header-name')?.textContent?.trim()).toBe('The plan')
    expect(text).not.toContain('kb:')
    expect(surface()?.querySelector('.document-facts')?.textContent).toBe(
      'status: proposed · card: 12',
    )
    expect(status()).toBe('')
    expect(refreshControl()).toBeDefined()
    expect(document.activeElement?.classList).toContain('overlay-header-name')
  })

  it('a file with no heading is titled by its name', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', 'Just words.\n')
    await opened()
    expect(surface()?.querySelector('.overlay-header-name')?.textContent?.trim()).toBe('plan.md')
  })

  it('at an anchor: scrolled to, marked and holding focus', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened('docs/plan.md', '#kb:a7f3')
    const target = blocks().find((block) => block.textContent?.includes('Second paragraph'))
    expect(target?.classList).toContain('is-target')
    expect(scrolledInto).toEqual([target])
    expect(document.activeElement).toBe(target)
    expect(blocks().filter((block) => block.classList.contains('is-target'))).toHaveLength(1)
  })

  it('at a line: every block of the range is marked and the first holds focus', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    // Past the five lines of front matter: the first paragraph, to the second heading.
    await opened('docs/plan.md', ':8-10')
    const marked = blocks().filter((block) => block.classList.contains('is-target'))
    expect(marked.map((block) => block.textContent?.trim())).toEqual([
      'First paragraph with a note in it.',
      'Part two',
    ])
    expect(document.activeElement).toBe(marked[0])
  })

  it('an anchor it does not have: from the start, and a line that says so', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened('docs/plan.md', '#kb:gone')
    expect(status()).toBe('There is no #kb:gone in this document, so it opens at the start')
    expect(blocks().some((block) => block.classList.contains('is-target'))).toBe(false)
    expect(scrolledInto).toEqual([])
    expect(document.activeElement?.classList).toContain('overlay-header-name')
  })

  it.each([
    [refused(404, 'not_found'), 'The file docs/plan.md is no longer in the project'],
    [refused(415, 'not_utf8'), 'The document is not in UTF-8'],
    [refused(415, 'binary'), 'This is not text'],
    [refused(404, 'project_unknown'), 'Valkama does not know the project demo'],
    [refused(403, 'outside_root'), 'The file is outside the project'],
    [refused(422, 'directory'), 'Valkama cannot show this document'],
    [
      refused(413, 'too_large', { size: 700 * 1024 }),
      'The document is over 512 KiB, so Valkama does not show it. It has 700 KiB',
    ],
  ])('refused: %s says why, offers no Refresh, and Close still works', async (error, words) => {
    disk['docs/plan.md'] = error
    const view = await opened()
    expect(surface()?.textContent).toContain(words)
    expect(blocks()).toEqual([])
    expect(refreshControl()).toBeUndefined()
    closeControl()?.click()
    await flushPromises()
    expect(view.place.value).toBeNull()
    expect(surface()).toBeNull()
  })

  it('a server that did not answer says no system text, and Refresh reads again', async () => {
    disk['docs/plan.md'] = new TypeError('C:/work/secret: connection refused')
    await opened()
    const words = surface()?.textContent ?? ''
    expect(words).toContain('Could not read the document')
    expect(words).not.toContain('secret')
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    refreshControl()?.click()
    await flushPromises()
    await nextTick()
    expect(surface()?.querySelector('.document-text h2')?.textContent?.trim()).toBe('The plan')
  })
})

describe('reading a file again', () => {
  it('a refusal already drawn stays while the window’s return reads it again', async () => {
    disk['docs/plan.md'] = refused(422, 'not_utf8')
    await opened()
    const words = 'The document is not in UTF-8'
    expect(surface()?.textContent).toContain(words)

    const held: { resolve?: (text: ProjectDocument) => void } = {}
    read.mockReturnValueOnce(new Promise((resolve) => (held.resolve = resolve)))
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(surface()?.textContent).toContain(words)
    expect(surface()?.querySelector('[aria-busy="true"]')).toBeNull()

    // The file came right meanwhile: its text takes the place of the words, once it is read.
    held.resolve?.(file('docs/plan.md', PLAN))
    await flushPromises()
    expect(surface()?.textContent).not.toContain(words)
    expect(blocks().length).toBeGreaterThan(0)
  })

  it('a refusal read again to a refusal goes on saying so', async () => {
    disk['docs/plan.md'] = refused(422, 'binary')
    await opened()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(surface()?.textContent).toContain('This is not text')
    disk['docs/plan.md'] = refused(422, 'not_utf8')
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(surface()?.textContent).toContain('The document is not in UTF-8')
  })

  it('the same revision draws nothing again', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened()
    const before = blocks()
    const asked = read.mock.calls.length
    await comeBack()
    expect(read.mock.calls).toHaveLength(asked + 1)
    expect(blocks().every((block, index) => block === before[index])).toBe(true)
    expect(blocks()).toHaveLength(before.length)
    expect(status()).toBe('')
  })

  it('another revision draws the new text at the heading the reader was under', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened()
    // The heading stands lower in the new text, since a paragraph came in above it.
    const headingAt = () => (surface()?.textContent?.includes('rewritten') ? 900 : 500)
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent?.trim() === 'Part two' ? headingAt() : 0
      },
    })
    const scroller = body()
    if (!scroller) throw new Error('No body')
    scroller.scrollTop = 620
    const scrollTo = vi.spyOn(scroller, 'scrollTo')

    disk['docs/plan.md'] = file(
      'docs/plan.md',
      `# The plan\n\nA new paragraph above.\n\n## Part two\n\nSecond paragraph, rewritten.\n`,
      'b'.repeat(16),
    )
    await comeBack()

    expect(surface()?.textContent).toContain('Second paragraph, rewritten')
    // 120 past the heading before, and 120 past it now that it stands lower.
    expect(scrollTo).toHaveBeenCalledWith({ top: 1020 })
    expect(status()).toMatch(/^The file changed, so this is its new text · /u)
    expect(status()).not.toContain('2026')
    expect(refreshControl()).toBeDefined()
  })

  it('a file deleted while open keeps the last text under a line, with no Refresh', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened()
    delete disk['docs/plan.md']
    await comeBack()
    expect(surface()?.textContent).toContain('First paragraph')
    expect(status()).toBe('The file was deleted from disk. This is the last text read')
    expect(refreshControl()).toBeUndefined()
    expect(closeControl()).toBeDefined()
  })

  it('a server gone keeps the text and offers Refresh, which clears the line', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened()
    disk['docs/plan.md'] = refused(503, 'unreadable')
    await comeBack()
    expect(surface()?.textContent).toContain('First paragraph')
    expect(status()).toBe('Could not read the file again')
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    refreshControl()?.click()
    await flushPromises()
    expect(status()).toBe('')
  })

  it('an answer to a read since replaced is dropped', async () => {
    disk['docs/note.md'] = file('docs/note.md', '# Note\n')
    let answerLate: (value: ProjectDocument) => void = vi.fn()
    read.mockImplementationOnce(
      () =>
        new Promise((settle) => {
          answerLate = settle
        }),
    )
    const view = await opened()
    view.open({ project: 'demo', path: 'docs/note.md', suffix: '' })
    await flushPromises()
    answerLate(file('docs/plan.md', PLAN))
    await flushPromises()
    await nextTick()
    expect(view.place.value?.path).toBe('docs/note.md')
    expect(surface()?.querySelector('.document-text h2')?.textContent?.trim()).toBe('Note')
  })
})
