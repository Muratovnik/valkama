/**
 * The menu at a quota account's name (`useAccountActions`). The oracle is the requirement: three
 * entries and no more — rename, add to the page's filter, copy the whole id — in that order, with
 * no rename on an account with no name of its own, which «Name» at its heading names instead (one
 * naming action for each state, `DESIGN.md`, the quota's panel); the
 * filter's entry is absent where there is no page filter and disabled, «Already in filter», where
 * the filter by account (`seat`) holds the account; a rename saves through the names Valkama keeps
 * by the account's id, or by its organization's on the card of an organization no source read,
 * cleaned as Settings cleans one, on Enter, leaves the name on Escape, and gives the focus back to
 * the menu either way; a save that fails keeps the field and says why; a copy puts the account's
 * UUID, or its organization's id where it has none, on the clipboard and says so.
 */
import { defineComponent, h } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAccountActions } from '@/pages/analytics/composables/useAccountActions.ts'
import { providePageFilter } from '@/pages/analytics/composables/usePageFilter.ts'

import { DEFAULT_VIEW } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { QuotaAccount, UsageFilters } from '@/shared/api/analyticsApi.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'

import { analyticsI18n } from '../support/analyticsReads.ts'
import { clipboard } from '../support/documentLinks.ts'

const ORGANIZATION = '5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'
const UUID = '0b7d4e19-1c2d-4e3f-8a4b-5c6d7e8f9a0b'
const ID = `${ORGANIZATION}/${UUID}`
const WEEKLY = `${ORGANIZATION}/weekly:4T09:00Z`
const ACCOUNT: QuotaAccount = {
  account: ID,
  organization: ORGANIZATION,
  account_uuid: UUID,
  weekly_reset: '4T09:00Z',
  shared: false,
  name: null,
  organization_name: null,
  plan: null,
  no_source: false,
  windows: [],
}
/** The card of an organization that worked and that no source read. */
const UNREAD: QuotaAccount = {
  ...ACCOUNT,
  account: `${ORGANIZATION}/`,
  account_uuid: null,
  weekly_reset: null,
  no_source: true,
}

const drawNothing = () => h('div')
const press = (key: string) => new KeyboardEvent('keydown', { key, cancelable: true })

type Actions = ReturnType<typeof useAccountActions>

/** The account's actions, on a page whose filter holds `filters`, or on no page at all. */
function actionsOf(account: QuotaAccount, filters: UsageFilters | null = {}) {
  const added: unknown[] = []
  const focused: string[] = []
  const renamed: string[] = []
  const refused: unknown[] = []
  let actions: Actions | null = null
  const view: AnalyticsView = { ...DEFAULT_VIEW, by: 'quota_week', filters: filters ?? {} }
  // The menu reads the filter its page provides, so the page is the account's parent.
  const menu = {
    setup() {
      actions = useAccountActions({
        account: () => account,
        fieldId: 'name-field',
        focusMenu: () => focused.push('menu'),
        renamed: () => renamed.push('renamed'),
      })
      return drawNothing
    },
  }
  const drawMenu = () => h(menu)
  mount(
    defineComponent({
      setup() {
        if (filters)
          providePageFilter({
            change: (next) => {
              added.push(next.filters)
              return true
            },
            full: (dimension) => refused.push(dimension),
            view: () => view,
          })
        return drawMenu
      },
    }),
    { global: { plugins: [analyticsI18n()] } },
  )
  if (!actions) throw new Error('the account gave no actions')
  return { actions: actions as Actions, added, focused, renamed }
}

const entry = (actions: Actions, key: string) => {
  const found = actions.entries.value.find((one) => one.key === key)
  if (found?.kind !== 'action') throw new Error(`no action ${key}`)
  return found as Extract<MenuEntry, { kind: 'action' }>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the menu at a quota account’s name', () => {
  it('offers rename, add to filter and copy, and no filter’s entry outside the page', () => {
    useAccountNamesStore().names = { [ID]: 'Work' }
    const onPage = actionsOf(ACCOUNT).actions
    expect(
      onPage.entries.value.map((one) => [one.key, one.kind === 'action' && one.label]),
    ).toEqual([
      ['rename', 'Rename'],
      ['filter', 'Add to filter'],
      ['copy', 'Copy ID'],
    ])
    expect(actionsOf(ACCOUNT, null).actions.entries.value.map((one) => one.key)).toEqual([
      'rename',
      'copy',
    ])
  })

  it('offers no rename to an account with no name, which «Name» names, and rename once it has one', () => {
    const store = useAccountNamesStore()
    const unnamed = actionsOf(ACCOUNT).actions
    expect(unnamed.unnamed.value).toBe(true)
    expect(unnamed.entries.value.map((one) => one.key)).toEqual(['filter', 'copy'])
    store.names = { [ID]: 'Work' }
    expect(unnamed.unnamed.value).toBe(false)
    expect(unnamed.entries.value.map((one) => one.key)).toEqual(['rename', 'filter', 'copy'])
  })

  it('adds the account beside the accounts the filter holds, and is disabled once it holds it', () => {
    const { actions, added } = actionsOf(ACCOUNT, { seat: ['org-other/acct-other'] })
    entry(actions, 'filter').select()
    expect(added).toEqual([{ seat: [ID, 'org-other/acct-other'] }])

    const held = entry(actionsOf(ACCOUNT, { seat: [ID] }).actions, 'filter')
    expect([held.label, held.disabled]).toEqual(['Already in filter', true])
    // Its organization in the filter by organization is not the account.
    const organization = entry(actionsOf(ACCOUNT, { account: [ORGANIZATION] }).actions, 'filter')
    expect([organization.label, organization.disabled]).toEqual(['Add to filter', false])
  })

  it('saves a cleaned name on Enter by the account and gives the focus back', async () => {
    const store = useAccountNamesStore()
    const save = vi.spyOn(store, 'save').mockResolvedValue()
    const { actions, focused, renamed } = actionsOf(ACCOUNT)
    await actions.rename()
    expect(actions.draft.value).toBe('')
    actions.type('  Night   shift ')
    actions.press(press('Enter'))
    await flushPromises()
    expect(save).toHaveBeenCalledWith(ID, 'Night shift')
    expect([actions.draft.value, focused, renamed]).toEqual([null, ['menu'], ['renamed']])
  })

  it('renames the organization on the card of one no source read', async () => {
    const store = useAccountNamesStore()
    store.names = { [ORGANIZATION]: 'Lab' }
    const save = vi.spyOn(store, 'save').mockResolvedValue()
    const { actions } = actionsOf(UNREAD)
    entry(actions, 'rename').select()
    expect(actions.draft.value).toBe('Lab')
    actions.type('Lab two')
    await actions.save()
    expect(save).toHaveBeenCalledWith(ORGANIZATION, 'Lab two')
  })

  it('starts from the name the account’s weekly reset was given, until it has its own', () => {
    const store = useAccountNamesStore()
    store.names = { [ORGANIZATION]: 'Lab', [WEEKLY]: 'Desk' }
    const { actions } = actionsOf(ACCOUNT)
    entry(actions, 'rename').select()
    expect(actions.draft.value).toBe('Desk')
    store.names = { [WEEKLY]: 'Desk', [ID]: 'Own' }
    const own = actionsOf(ACCOUNT).actions
    entry(own, 'rename').select()
    expect(own.draft.value).toBe('Own')
  })

  it('leaves the name on Escape, and saves nothing for a name unchanged', async () => {
    const store = useAccountNamesStore()
    store.names = { [ID]: 'Work' }
    const save = vi.spyOn(store, 'save').mockResolvedValue()
    const { actions, focused } = actionsOf(ACCOUNT)
    entry(actions, 'rename').select()
    expect(actions.draft.value).toBe('Work')
    actions.type('Elsewhere')
    actions.press(press('Escape'))
    expect([actions.draft.value, focused]).toEqual([null, ['menu']])

    entry(actions, 'rename').select()
    actions.type(' Work ')
    await actions.save()
    expect(save).not.toHaveBeenCalled()
    expect(actions.draft.value).toBeNull()
  })

  it('keeps the field and says why where the save fails', async () => {
    const store = useAccountNamesStore()
    vi.spyOn(store, 'save').mockRejectedValue(new Error('offline'))
    const { actions, focused, renamed } = actionsOf(ACCOUNT)
    await actions.rename()
    actions.type('Night shift')
    await actions.save()
    expect(actions.draft.value).toBe('Night shift')
    expect(actions.failure.value).toMatch(/^Name not saved: /u)
    expect([focused, renamed]).toEqual([[], []])
  })

  it('copies the account’s UUID, or its organization’s id where it has none, and says so', async () => {
    const writeText = clipboard()
    const { actions } = actionsOf(ACCOUNT)
    entry(actions, 'copy').select()
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(UUID)
    expect([actions.note.value, actions.noteFailed.value]).toEqual(['ID copied', false])

    const unseated = actionsOf({ ...ACCOUNT, account: WEEKLY, account_uuid: null }).actions
    entry(unseated, 'copy').select()
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(ORGANIZATION)

    clipboard(() => Promise.reject(new Error('denied')))
    const refused = actionsOf(ACCOUNT).actions
    entry(refused, 'copy').select()
    await flushPromises()
    expect([refused.note.value, refused.noteFailed.value]).toEqual(['ID not copied', true])
  })
})
