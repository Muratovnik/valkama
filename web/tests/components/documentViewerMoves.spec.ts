/**
 * Moving inside the viewer: Back through several documents, a link within one, and what
 * a press in the text says and does.
 */
import { nextTick } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import {
  blocks,
  body,
  control,
  disk,
  file,
  known,
  opened,
  read,
  resolve,
  status,
  surface,
  viewer,
  viewerSuite,
} from '../support/documentViewer.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  readDocument: vi.fn(),
  resolveDocuments: vi.fn(),
}))

viewerSuite()

const PLAN = '# The plan\n\nSome words.\n'

const step = (name: string, to: string) => `# ${name}\n\nOn to [the next](${to}).\n`

async function press(name: string) {
  const button = [
    ...(surface()?.querySelectorAll<HTMLButtonElement>('.document-text button') ?? []),
  ].find((candidate) => candidate.textContent?.trim() === name)
  if (!button) throw new Error(`No link ${name}`)
  button.click()
  await flushPromises()
  await nextTick()
}

const heading = () => surface()?.querySelector('.document-text h2')?.textContent?.trim()

describe('moving between documents', () => {
  it('Back goes through three documents and returns each to its place', async () => {
    disk['docs/one.md'] = file('docs/one.md', step('One', 'sub/two.md'))
    disk['docs/sub/two.md'] = file('docs/sub/two.md', step('Two', '../three.md'))
    disk['docs/three.md'] = file('docs/three.md', '# Three\n')
    known['docs/sub/two.md'] = {
      status: 'file',
      project: 'demo',
      relative: 'docs/sub/two.md',
      markdown: true,
    }
    known['docs/three.md'] = {
      status: 'file',
      project: 'demo',
      relative: 'docs/three.md',
      markdown: true,
    }
    await opened('docs/one.md')
    await flushPromises()
    expect(control('Back to docs/one.md')).toBeUndefined()
    const leave = async (place: number, link: string) => {
      const scroller = body()
      if (!scroller) throw new Error('No body')
      scroller.scrollTop = place
      await press(link)
      await flushPromises()
    }
    await leave(310, 'the next')
    expect(heading()).toBe('Two')
    await leave(120, 'the next')
    expect(heading()).toBe('Three')
    expect(resolve).toHaveBeenCalledWith({ project: 'demo' }, ['docs/sub/two.md'])

    const backTo = vi.spyOn(HTMLElement.prototype, 'scrollTo')
    control('Back to docs/sub/two.md')?.click()
    await flushPromises()
    await nextTick()
    expect(heading()).toBe('Two')
    expect(backTo).toHaveBeenLastCalledWith({ top: 120 })
    control('Back to docs/one.md')?.click()
    await flushPromises()
    await nextTick()
    expect(heading()).toBe('One')
    expect(backTo).toHaveBeenLastCalledWith({ top: 310 })
    expect(control('Back to docs/one.md')).toBeUndefined()
  })

  it('a link to a place in the same document moves there, reads nothing and adds no Back', async () => {
    disk['docs/plan.md'] = file(
      'docs/plan.md',
      '# Plan\n\nTo [the part](#part-two).\n\n## Part two\n\nThere.\n',
    )
    known['docs/plan.md'] = {
      status: 'file',
      project: 'demo',
      relative: 'docs/plan.md',
      markdown: true,
    }
    await opened()
    await flushPromises()
    const asked = read.mock.calls.length
    await press('the part')
    await flushPromises()
    const target = blocks().find((block) => block.textContent?.includes('Part two'))
    expect(target?.classList).toContain('is-target')
    expect(document.activeElement).toBe(target)
    expect(read.mock.calls).toHaveLength(asked)
    expect(surface()?.querySelector('button[aria-label^="Back"]')).toBeNull()
  })

  it('a new reading from outside starts with nothing to go back to', async () => {
    disk['docs/one.md'] = file('docs/one.md', step('One', 'two.md'))
    disk['docs/two.md'] = file('docs/two.md', '# Two\n')
    known['docs/two.md'] = {
      status: 'file',
      project: 'demo',
      relative: 'docs/two.md',
      markdown: true,
    }
    const view = await opened('docs/one.md')
    await flushPromises()
    await press('the next')
    await flushPromises()
    expect(control('Back to docs/one.md')).toBeDefined()
    view.close()
    await flushPromises()
    view.open({ project: 'demo', path: 'docs/two.md', suffix: '' })
    await flushPromises()
    expect(surface()?.querySelector('button[aria-label^="Back"]')).toBeNull()
  })

  it('a path that is not there copies, and says so on the viewer own line', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', 'See [gone](gone.md).\n')
    await opened()
    await flushPromises()
    await press('gone')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('gone.md')
    expect(status()).toBe('Path copied')
  })

  it('the head copies the path from the project root', async () => {
    disk['docs/plan.md'] = file('docs/plan.md', PLAN)
    await opened()
    control('Copy the path docs/plan.md')?.click()
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('docs/plan.md')
    expect(status()).toBe('Path copied')
  })

  it('a work item in the text closes the document first, since it opens under it', async () => {
    const opensCard = vi.fn(() => expect(view.place.value).toBeNull())
    const view = await viewer(() => ({ title: 'Open MAIN-12', open: opensCard }))
    disk['docs/plan.md'] = file('docs/plan.md', 'About MAIN-12.\n')
    view.open({ project: 'demo', path: 'docs/plan.md', suffix: '' })
    await flushPromises()
    await nextTick()
    await press('MAIN-12')
    expect(opensCard).toHaveBeenCalledOnce()
    expect(surface()).toBeNull()
  })
})
