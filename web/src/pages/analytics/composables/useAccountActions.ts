/**
 * What the menu at an account's name in the quota panel does (`QuotaAccount`), exactly three
 * things, in this order:
 *
 * - «Rename» opens a field for its name in the account's heading, which saves through the names
 *   Valkama keeps and as Settings saves one (`accountNamesStore`, `cleanAlias`): Enter or leaving
 *   the field saves, Escape leaves the name as it was, and either gives the focus back to the menu's
 *   button. A save that fails keeps the field open and says why under it. A name is kept by the
 *   account's organization, which every account of it shares, as the usage rows hold no more.
 * - «Add to filter» adds the account to the page's filter by account — the usage's account is the
 *   organization its work was billed to — beside the accounts there, through the page's one
 *   operation (`usePageFilter`); an account the filter holds offers it disabled, «Already in
 *   filter», and outside the page, where there is no filter, it is absent.
 * - «Copy ID» puts the account's whole id on the clipboard — its UUID, or its organization's id
 *   where no UUID is known — and says it was copied, or refused, for a few seconds (`useCopyNote`).
 *   That is where the whole id is reached: no hint says it.
 */
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePageFilter } from '@/pages/analytics/composables/usePageFilter.ts'

import type { QuotaAccount } from '@/shared/api/analyticsApi.ts'
import { accountNamesFailure } from '@/shared/api/quotaApi.ts'
import { aliasOf, cleanAlias } from '@/shared/lib/accountAliases.ts'
import { useCopyNote } from '@/shared/lib/copyNote.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'

export function useAccountActions(options: {
  /** The id of the name's field, which takes the focus when it opens. */
  fieldId: string
  account: () => QuotaAccount
  /** Gives the focus back to the menu's button. */
  focusMenu: () => void
  /** The name was saved: the quota's own answer still says the one before. */
  renamed: () => void
}) {
  const { t } = useI18n()
  const namesStore = useAccountNamesStore()
  const { names } = storeToRefs(namesStore)
  const pageFilter = usePageFilter()
  const copyNote = useCopyNote()

  const organization = () => options.account().organization
  /** The name the account has now: Valkama's, or the quota answer's until the names are read. */
  const kept = () => aliasOf(names.value, organization()) ?? options.account().name ?? ''

  /** What the name's field holds while it is open; null while the name stands. */
  const draft = ref<string | null>(null)
  /** Why the last save failed, in words; empty otherwise. */
  const failure = ref('')
  let saving = false

  function type(value: string | number) {
    draft.value = String(value)
  }

  async function rename() {
    draft.value = kept()
    failure.value = ''
    await nextTick()
    document.querySelector<HTMLElement>(`#${CSS.escape(options.fieldId)}`)?.focus()
  }

  function close() {
    draft.value = null
    failure.value = ''
    options.focusMenu()
  }

  /** Saves what the field holds where it differs from the name kept; Enter and leaving it. */
  async function save() {
    const typed = draft.value
    if (typed === null || saving) return
    const said = cleanAlias(typed)
    if (said === kept()) {
      close()
      return
    }
    saving = true
    try {
      await namesStore.save(organization(), said)
      close()
      options.renamed()
    } catch (error) {
      failure.value = t('analytics.quota.actions.renameFailed', {
        reason: accountNamesFailure(error, t),
      })
    } finally {
      saving = false
    }
  }

  /** Enter saves, Escape leaves the name as it was. */
  function press(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  /** The account's whole id: its UUID, or its organization's where no UUID is known. */
  const id = () => options.account().account_uuid ?? organization()
  const copy = () =>
    copyNote.copy(
      id(),
      t('analytics.quota.actions.copied'),
      t('analytics.quota.actions.copyFailed'),
    )

  const entries = computed<MenuEntry[]>(() => {
    const held = pageFilter?.has('account', organization()) ?? false
    return [
      {
        kind: 'action',
        key: 'rename',
        label: t('analytics.quota.actions.rename'),
        icon: 'edit',
        opens: true,
        select: () => void rename(),
      },
      ...(pageFilter
        ? [
            {
              kind: 'action' as const,
              key: 'filter',
              label: held ? t('analytics.filters.held') : t('analytics.filters.add'),
              icon: 'filters',
              disabled: held,
              select: () => void pageFilter.add('account', organization()),
            },
          ]
        : []),
      {
        kind: 'action',
        key: 'copy',
        label: t('analytics.quota.actions.copy'),
        icon: 'copy',
        select: () => void copy(),
      },
    ]
  })

  return {
    draft,
    entries,
    failure,
    note: copyNote.note,
    noteFailed: copyNote.failed,
    press,
    save,
    type,
  }
}
