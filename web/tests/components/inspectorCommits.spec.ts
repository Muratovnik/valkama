/**
 * The commits attached to an item, in «Связи»: each by its repository and hash, with its
 * project and, where it was attached by hand, the mark that says so; opened over the card
 * through `GET /api/commit`, from its row or from its hash in the card's text.
 */
import { h } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspectorEvidence from '@/widgets/work-item-inspector/components/InspectorEvidence.vue'
import InspectorReferenceScope from '@/widgets/work-item-inspector/components/InspectorReferenceScope.vue'
import { writtenCommit } from '@/widgets/work-item-inspector/utils/commitWords.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import RichText from '@/shared/ui/RichText.vue'

import { workItemFixture } from '../fixtures/workItem.ts'
import { requestUrl, withSecurityBootstrap } from '../support/request.ts'

type Commit = NonNullable<WorkItem['commits']>[number]

function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    repository: 'alpha',
    display_name: 'Alpha',
    hash: 'a3cc0de4f1b2c3d4e5f60718293a4b5c6d7e8f90',
    subject: 'build(web): rebuild the bundled UI',
    committed_at: '2026-11-14T18:58:00+03:00',
    session: '',
    agent: '',
    attached_by: 'server',
    label: '',
    ...overrides,
  }
}

const COMMITS = [
  commit(),
  commit({
    repository: 'beta',
    display_name: 'Beta',
    hash: '39014906c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6',
    subject: 'docs: record the decision',
    attached_by: 'manual',
  }),
]

const record = (commits: Commit[] = COMMITS): WorkItem => ({
  ...workItemFixture('Evidence', 1),
  commits,
})

/** Answer `/api/commit` as git would, and record what was asked. */
function serveCommit() {
  const asked: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      withSecurityBootstrap(async (input) => {
        const url = new URL(requestUrl(input), 'http://localhost')
        if (url.pathname !== '/api/commit') throw new Error(`unexpected ${url}`)
        asked.push(url.searchParams)
        return Response.json({
          kind: 'commit',
          value: url.searchParams.get('hash'),
          resolved: true,
          repository: url.searchParams.get('repository'),
          detail:
            'a3cc0de4 worker-a\nbuild(web): rebuild the bundled UI\n web/dist/index.html | 2 +-',
        })
      }),
    ),
  )
  return asked
}

function card(item: WorkItem, text = '') {
  return mount(InspectorReferenceScope, {
    attachTo: document.body,
    props: { item },
    slots: {
      default: () => [h(InspectorEvidence, { item }), h(RichText, { source: text })],
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { VIcon: true },
    },
  })
}

let mounted: ReturnType<typeof card> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.unstubAllGlobals()
})

describe('the commits in «Связи»', () => {
  it('names each by its repository and hash, its project, and marks one attached by hand', () => {
    mounted = card(record())
    const rows = mounted.findAll('[data-commit]')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.get('.commit-name').text())).toEqual([
      'alpha · a3cc0de4',
      'beta · 39014906',
    ])
    expect(rows[0].text()).toContain('build(web): rebuild the bundled UI')
    expect(rows[0].get('.commit-project').text()).toBe('Alpha')
    expect(rows[1].get('.commit-project').text()).toBe('Beta')
    // The server attaching a commit is the norm and says nothing; a hand's attaching is marked.
    expect(rows[0].find('.commit-manual').exists()).toBe(false)
    expect(rows[1].get('.commit-manual').text()).toBe('attached by hand')
    // The heading counts them with the other evidence.
    expect(mounted.get('.evidence').text()).toContain('2')
  })

  it('opens one from its row through /api/commit, with its repository and its hash', async () => {
    const asked = serveCommit()
    mounted = card(record())
    await mounted.findAll('.commit-name')[1].trigger('click')
    await flushPromises()
    expect(asked).toHaveLength(1)
    expect(asked[0].get('repository')).toBe('beta')
    expect(asked[0].get('hash')).toBe(COMMITS[1].hash)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('docs: record the decision')
    expect(dialog?.textContent).toContain('attached by hand')
    expect(dialog?.querySelector('.peek-detail')?.textContent).toContain('web/dist/index.html')
  })

  it('opens one from its hash in the card’s text, and leaves a hash it does not carry as text', async () => {
    const asked = serveCommit()
    mounted = card(record(), 'Built in a3cc0de4, before ffffff1.')
    const links = mounted.findAll('.rich-reference')
    expect(links.map((link) => link.text())).toEqual(['a3cc0de4'])
    await links[0].trigger('click')
    await flushPromises()
    expect(asked.map((query) => query.get('repository'))).toEqual(['alpha'])
  })

  it('says nothing of commits where the item has none', () => {
    mounted = card(record([]))
    expect(mounted.find('[data-commit]').exists()).toBe(false)
    expect(mounted.text()).toContain('No evidence has been attached.')
  })
})

describe('a hash written in text', () => {
  it('means the one attached commit it starts or is started by, and none where two could be meant', () => {
    expect(writtenCommit(COMMITS, 'A3CC0DE')?.repository).toBe('alpha')
    expect(writtenCommit(COMMITS, `${COMMITS[1].hash}`)?.repository).toBe('beta')
    expect(writtenCommit(COMMITS, 'ffffff1')).toBeNull()
    const twin = commit({ repository: 'gamma', hash: 'a3cc0de4aaaaaaa' })
    expect(writtenCommit([...COMMITS, twin], 'a3cc0de4')).toBeNull()
  })
})
