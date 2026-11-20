/**
 * «Commits on no card» on the Volumes page, mounted whole against doubles of the server: the
 * number shows and hides their list; a row reads the commit (its subject, repository, short hash
 * and session); a card found by its words, closed or of another space at the top, takes the
 * commit through the person's attach, which sends the card, the repository and the hash and
 * nothing else; the commit then leaves the list and the page reads its numbers again. An attach
 * the server refuses keeps the row and says the server's reason; a list that cannot be read says
 * so, and its number says «—». The oracle is DESIGN.md («Volumes»).
 */
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

import { VOLUMES_STORE, volumesAnswer, volumesDouble } from '../support/volumesDouble.ts'
import { GLOBAL, json, mountPage, SPACE } from './volumesPageHost.ts'
import type { Page, Route } from './volumesPageHost.ts'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const commit = (hash: string, subject: string, repository: string | null = 'alpha') => ({
  repository,
  display_name: repository === null ? null : 'Alpha',
  hash,
  subject,
  committed_at: '2026-03-02T10:00:00Z',
  session: 'c0ffee00-1111-4222-8333-444455556666',
  agent: null,
  client: 'claude',
  reported_at: '2026-03-02T10:00:05Z',
})

const OTHER = { data_scope_id: VOLUMES_STORE, space_key: 'ALPHA' }

/** A search row of `space`, open or closed, as the global search answers it. */
const found = (reference: string, space: typeof OTHER, open: boolean) => ({
  target: { space_ref: space, reference, writable: true },
  item: {
    work_item_id: `00000000-0000-4000-8000-0000000000${reference.slice(-2)}`,
    planning_space_id: '00000000-0000-4000-8000-000000000001',
    reference,
    title: `Card ${reference}`,
    state: { name: open ? 'Dev' : 'Done' },
    open,
    container_state: null,
    claim_ref: '',
  },
})

/** The server of the commits: their list, the search and the attach, each call kept. */
function commitsServer(options: { listFails?: boolean; refuse?: string } = {}) {
  const items = [commit('abcdef0123', 'Fix the parser'), commit('1234567890', '', null)]
  const lists: URLSearchParams[] = []
  const attaches: unknown[] = []
  const route: Route = (url, init) => {
    if (url.pathname === '/api/planning/commits/unattached') {
      lists.push(url.searchParams)
      return options.listFails
        ? json({ error: { code: 'unavailable', message: 'busy' } }, 503)
        : json({ total: items.length, items })
    }
    if (url.pathname === '/api/modules/planning/search')
      return json({
        interface_version: 'valkama-planning-search',
        query: url.searchParams.get('q'),
        limit: 50,
        has_more: false,
        items: [
          found('MAIN-41', { ...OTHER, space_key: 'MAIN' }, false),
          found('ALPHA-42', OTHER, true),
        ],
        coverage: [],
      })
    if (url.pathname === '/api/planning/work-item/commit') {
      const body = JSON.parse(init?.body as string) as { hash: string; reference: string }
      attaches.push(body)
      if (options.refuse)
        return json({ error: { code: 'invalid_request', message: options.refuse } }, 400)
      const index = items.findIndex((one) => one.hash === body.hash)
      items.splice(index, 1)
      return json({ reference: body.reference, revision: 4, commit: null, changed: true })
    }
    return null
  }
  return { attaches, lists, route, items }
}

/** The page's read: its number of commits on no card is the list's length as it stands. */
function pageOf(server: ReturnType<typeof commitsServer>, scope = SPACE) {
  const double = volumesDouble(() =>
    volumesAnswer({
      categories: { ready: 1 },
      space: scope.kind === 'space' ? 'MAIN' : null,
      unattached: server.items.length,
    }),
  )
  return { double, page: mountPage(double, scope, { other: server.route }) }
}

const commitsNumber = (page: Page) => page.get('[data-number="commits"]')

async function openList(page: Page) {
  await flushPromises()
  await commitsNumber(page).trigger('click')
  await flushPromises()
}

/** Find the card by `words` on the row's line and choose `reference` among what is found. */
async function chooseCard(page: Page, hash: string, words: string, reference: string) {
  vi.useFakeTimers()
  await page.get(`[data-commit="${hash}"] .volumes-commit-attach`).trigger('click')
  const field = page.findComponent(SearchCombobox)
  field.vm.$emit('search', words)
  await vi.advanceTimersByTimeAsync(250)
  vi.useRealTimers()
  await flushPromises()
  const offered = (field.props() as { options: { value: string }[] }).options
  field.vm.$emit('update:modelValue', reference)
  await flushPromises()
  return offered.map((option) => option.value)
}

describe('commits on no card on the Volumes page', () => {
  it('shows their list under the number, a row for each commit', async () => {
    const server = commitsServer()
    const { page } = pageOf(server)
    await flushPromises()
    expect(commitsNumber(page).element.tagName).toBe('BUTTON')
    expect(commitsNumber(page).attributes('aria-expanded')).toBe('false')
    expect(page.find('.volumes-commits').exists()).toBe(false)

    await openList(page)
    expect(commitsNumber(page).attributes('aria-expanded')).toBe('true')
    expect(server.lists.map(String)).toEqual(['limit=500&space=MAIN'])
    expect(page.get('.volumes-commits').text()).toContain('2 commits')
    const first = page.get('[data-commit="abcdef0123"]')
    expect(first.get('th').text()).toBe('abcdef01')
    expect(first.findAll('td').map((cell) => cell.text())).toEqual([
      'Fix the parser',
      'Alpha',
      'c0ffee00',
      expect.stringContaining('2026'),
      'Attach to a card',
    ])
    const second = page.get('[data-commit="1234567890"]')
    expect(
      second
        .findAll('td')
        .slice(0, 2)
        .map((cell) => cell.text()),
    ).toEqual(['no subject', 'no repository'])

    await commitsNumber(page).trigger('click')
    expect(page.find('.volumes-commits').exists()).toBe(false)
  })

  it('attaches a commit to a closed card found by its words: it leaves, the number drops', async () => {
    const server = commitsServer()
    const { double, page } = pageOf(server)
    await openList(page)
    expect(commitsNumber(page).get('[data-part="figure"]').text()).toBe('2')

    // In a space the space's cards are offered, a closed one too; another space's are not.
    const offered = await chooseCard(page, 'abcdef0123', 'parser', 'MAIN-41')
    expect(offered).toEqual(['MAIN-41'])
    const readsBefore = double.asked.length
    await page.get('[data-commit="abcdef0123"] form').trigger('submit')
    await flushPromises()

    expect(server.attaches).toEqual([
      { reference: 'MAIN-41', hash: 'abcdef0123', repository: 'alpha' },
    ])
    expect(page.find('[data-commit="abcdef0123"]').exists()).toBe(false)
    expect(page.find('[data-commit="1234567890"]').exists()).toBe(true)
    expect(page.get('[role="status"]').text()).toBe('abcdef01 attached to MAIN-41')
    expect(double.asked).toHaveLength(readsBefore + 1)
    expect(commitsNumber(page).get('[data-part="figure"]').text()).toBe('1')
  })

  it('offers every space’s cards at the top', async () => {
    const server = commitsServer()
    const { page } = pageOf(server, GLOBAL)
    await openList(page)
    expect(server.lists.map(String)).toEqual(['limit=500'])
    expect(await chooseCard(page, 'abcdef0123', 'card', 'ALPHA-42')).toEqual([
      'MAIN-41',
      'ALPHA-42',
    ])
  })

  it('keeps the row and says the server’s reason when an attach is refused', async () => {
    const server = commitsServer({ refuse: 'The commit is not in the repository.' })
    const { page } = pageOf(server)
    await openList(page)
    await chooseCard(page, 'abcdef0123', 'parser', 'MAIN-41')
    await page.get('[data-commit="abcdef0123"] form').trigger('submit')
    await flushPromises()

    expect(page.find('[data-commit="abcdef0123"] form').exists()).toBe(true)
    expect(page.get('[data-commit="abcdef0123"]').text()).toContain(
      'Not attached: The commit is not in the repository.',
    )
    expect(commitsNumber(page).get('[data-part="figure"]').text()).toBe('2')
  })

  it('says a list that cannot be read, its number «—», and reads it again on retry', async () => {
    const server = commitsServer({ listFails: true })
    const { page } = pageOf(server)
    await openList(page)
    expect(page.get('.volumes-commits').text()).toContain('Could not read the commits on no card.')
    expect(commitsNumber(page).get('[data-part="figure"]').text()).toBe('—')

    const retry = page
      .get('.volumes-commits')
      .findAll('button')
      .find((button) => button.text() === 'Retry')
    await retry?.trigger('click')
    await flushPromises()
    expect(server.lists).toHaveLength(2)
  })
})
