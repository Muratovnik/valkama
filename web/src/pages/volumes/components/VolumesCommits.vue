<script setup lang="ts">
/**
 * The commits a session made that no card holds, opened from their number on the Volumes page:
 * one row each, the newest first — its hash, held at the row's start while the table scrolls
 * sideways, its subject, the repository, the session and when it was committed — read for the
 * page's scope (`readUnattachedCommits`): a project's commits, a space's projects', or every
 * commit of the store at the top.
 *
 * A row's «Attach to a card» stands under its subject, the column read first after the hash, so it
 * is in view wherever the table's frame is scrolled to the commit; in a column of its own at the
 * row's end it stood past the frame at 1280px in Russian and far past a phone's. It opens a line
 * under the row where the card is found by its number or the
 * words of its title (`SearchCombobox`, `useCardSearch`), in the page's space or in any space at
 * the top, closed cards too, since a commit belongs to whichever card it was made for. «Attach»
 * writes the module's action, the person's attach (`attachCommit`): the commit leaves the list, it
 * is said aloud, and the page reads its numbers again (`attached`). An attach that fails keeps the
 * row and its line, with the server's reason under the field. Past the most one read answers the
 * list shows the newest and says how many there are.
 *
 * Its states are the shared panel's: the wait, a list that could not be read with its retry —
 * the number over it then says «—» (`unread`) — and «All commits are attached». Each row's body
 * carries `data-commit`, its hash.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useCardSearch } from '@/entities/work-item/composables/useCardSearch.ts'

import { planningRefusal } from '@/shared/api/planningApi.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { uiEmpty, uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import { attachCommit, readUnattachedCommits } from '@/shared/api/unattachedCommitsApi.ts'
import type { UnattachedCommit, UnattachedCommits } from '@/shared/api/unattachedCommitsApi.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The project the page's space is narrowed to; null for the whole space. */
  project: string | null
  /** The page's space; null for every space. */
  space: PlanningSpaceRef | null
}>()
const emit = defineEmits<{
  /** A commit was attached: the page reads its numbers again. */
  attached: []
  /** Whether the list could not be read, which the number over it says as «—». */
  unread: [unread: boolean]
}>()

const { locale, t } = useI18n()

const state = shallowRef<PlatformUiState<UnattachedCommits>>(uiLoading())

async function read() {
  state.value = uiLoading()
  try {
    const list = await readUnattachedCommits({
      project: props.project,
      space: props.space?.space_key ?? null,
    })
    state.value = list.items.length ? uiReady(list) : uiEmpty('volumes.commits.empty')
    emit('unread', false)
  } catch {
    state.value = uiError('volumes.commits.failed')
    emit('unread', true)
  }
}
onMounted(read)

/** As much of a hash or a session as names it to a reader: git's own short form. */
const SHORT = 8
const keyOf = (commit: UnattachedCommit) => `${commit.repository ?? ''}:${commit.hash}`

const timeWords = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)

const list = computed(() => (state.value.status === 'ready' ? state.value.payload : null))

/** The row whose line of attaching is open, the card chosen there and why it failed. */
const attaching = ref<string | null>(null)

/** The rows as they are drawn, the one whose line of attaching is open with it (`open`). */
const rows = computed(() =>
  (list.value?.items ?? []).map((commit) => ({
    commit,
    key: keyOf(commit),
    open: attaching.value === keyOf(commit),
    repository: commit.display_name ?? commit.repository ?? t('volumes.commits.noRepository'),
    hash: commit.hash.slice(0, SHORT),
    session: commit.session?.slice(0, SHORT) ?? '',
    sessionWhole: commit.session ?? '',
    time: commit.committed_at ? timeWords.value.format(new Date(commit.committed_at)) : '',
    subject: commit.subject || t('volumes.commits.noSubject'),
  })),
)

/** What the list says over its rows: how many, and that only the newest are shown. */
const countWords = computed(() => {
  const shown = list.value
  if (!shown) return ''
  return shown.total > shown.items.length
    ? t('volumes.commits.most', { count: shown.items.length, total: shown.total })
    : t('volumes.commits.count', { count: shown.total }, shown.total)
})

const card = ref('')
const failure = ref('')
const sending = ref(false)
/** What the last attach did, said to assistive technology. */
const said = ref('')
const sendWords = computed(() =>
  t(sending.value ? 'volumes.commits.attaching' : 'volumes.commits.send'),
)

const cards = useCardSearch(() => ({ own: '', space: props.space ?? undefined, anyCard: true }))

function startAttach(key: string) {
  attaching.value = attaching.value === key ? null : key
  card.value = ''
  failure.value = ''
}

function stopAttach() {
  attaching.value = null
}

function chooseCard(reference: string) {
  cards.choose(reference)
  card.value = reference
  failure.value = ''
}

/** The list without `commit`, which a card now holds. */
function without(commit: UnattachedCommit) {
  const current = list.value
  if (!current) return
  const items = current.items.filter((one) => keyOf(one) !== keyOf(commit))
  state.value = items.length
    ? uiReady({ items, total: current.total - 1 })
    : uiEmpty('volumes.commits.empty')
}

async function attach(commit: UnattachedCommit) {
  if (!card.value || sending.value) return
  sending.value = true
  failure.value = ''
  try {
    await attachCommit({ reference: card.value, repository: commit.repository, hash: commit.hash })
    without(commit)
    said.value = t('volumes.commits.attached', {
      hash: commit.hash.slice(0, SHORT),
      reference: card.value,
    })
    attaching.value = null
    emit('attached')
  } catch (error) {
    failure.value = t('volumes.commits.attachFailed', {
      reason: planningRefusal(error)?.message ?? t('volumes.commits.attachUnknown'),
    })
  } finally {
    sending.value = false
  }
}

const emptyWords = computed(() => ({ empty: t('volumes.commits.empty') }))
</script>

<template>
  <section
    class="volumes-commits"
    :aria-label="t('volumes.commits.label')"
  >
    <h2 class="volumes-heading">{{ t('volumes.commits.label') }}</h2>
    <p
      class="visually-hidden"
      role="status"
    >
      {{ said }}
    </p>
    <PlatformStatePanel
      :state="state"
      compact
      @retry="read"
    >
      <p class="volumes-subheading">{{ countWords }}</p>
      <ChartTable
        :empty="!rows.length"
        :label="t('volumes.commits.label')"
        :words="emptyWords"
      >
        <thead>
          <tr>
            <th
              scope="col"
              class="chart-cell chart-heading"
            >
              {{ t('volumes.commits.hash') }}
            </th>
            <th
              scope="col"
              class="chart-cell chart-heading"
            >
              {{ t('volumes.commits.subject') }}
            </th>
            <th
              scope="col"
              class="chart-cell chart-heading"
            >
              {{ t('volumes.commits.repository') }}
            </th>
            <th
              scope="col"
              class="chart-cell chart-heading"
            >
              {{ t('volumes.commits.session') }}
            </th>
            <th
              scope="col"
              class="chart-cell chart-heading"
            >
              {{ t('volumes.commits.time') }}
            </th>
          </tr>
        </thead>
        <tbody
          v-for="row in rows"
          :key="row.key"
          :data-commit="row.commit.hash"
        >
          <tr>
            <th
              scope="row"
              class="chart-cell chart-name volumes-commit-code"
            >
              {{ row.hash }}
            </th>
            <td class="chart-cell volumes-commit-subject">
              {{ row.subject }}
              <span class="volumes-commit-action">
                <VButton
                  class="volumes-commit-attach"
                  size="inline"
                  variant="text"
                  :aria-expanded="row.open"
                  @click="startAttach(row.key)"
                >
                  {{ t('volumes.commits.attach') }}
                </VButton>
              </span>
            </td>
            <td class="chart-cell volumes-commit-words">{{ row.repository }}</td>
            <td
              v-tooltip.detail="row.sessionWhole"
              class="chart-cell volumes-commit-code"
            >
              {{ row.session }}
            </td>
            <td class="chart-cell volumes-commit-plain">{{ row.time }}</td>
          </tr>
          <tr v-if="row.open">
            <td
              class="chart-cell"
              colspan="5"
            >
              <form
                class="volumes-attach"
                @submit.prevent="attach(row.commit)"
              >
                <SearchCombobox
                  class="volumes-attach-card"
                  :label="t('volumes.commits.card')"
                  :model-value="card"
                  :options="cards.options.value"
                  :empty-label="cards.emptyLabel.value"
                  :placeholder="t('volumes.commits.cardHint')"
                  :disabled="sending"
                  :error="failure"
                  @search="cards.search"
                  @update:model-value="chooseCard"
                />
                <div class="volumes-attach-actions">
                  <VButton
                    type="submit"
                    variant="primary"
                    :disabled="!card || sending"
                  >
                    {{ sendWords }}
                  </VButton>
                  <VButton
                    variant="secondary"
                    :disabled="sending"
                    @click="stopAttach"
                  >
                    {{ t('volumes.commits.cancel') }}
                  </VButton>
                </div>
              </form>
            </td>
          </tr>
        </tbody>
      </ChartTable>
    </PlatformStatePanel>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/pages/volumes/components/volumesSection.css"></style>

<style scoped>
.volumes-commits {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  container: volumes-commits / inline-size;
}

/* The subject over the row's action. The action stands on its own line at the column's start, its
   fill under the pointer reaching past the column's edge as an inline control's does. */
.volumes-commit-subject {
  min-inline-size: 14rem;
}

.volumes-commit-action {
  display: block;
  margin-block-start: var(--space-1);
  margin-inline-start: calc(-1 * var(--space-fill-inset));
}

/* On a phone the subject's column is what the frame has beside the commit's hash, which stays at
   its start, and the action's name takes two lines there rather than one: on one line
   «Прикрепить к карточке» held the column wider than the frame, past its edge. */
@container volumes-commits (width <= 30rem) {
  .volumes-commit-subject {
    min-inline-size: 9rem;
  }

  .volumes-commit-attach {
    text-align: start;
    white-space: normal;
  }
}

/* The repository's name wraps between its words, so a long one takes lines rather than the
   frame's width; the moment keeps to one line. */
.volumes-commit-words {
  min-inline-size: 8em;
}

.volumes-commit-plain {
  white-space: nowrap;
}

.volumes-commit-code {
  font-family: var(--font-family-mono);
  white-space: nowrap;
}

/* The card's field and the two actions on one line where they fit, wrapping on a phone. The line
   stays at the frame's start and no wider than the section while a phone's table scrolls
   sideways under it, so the field never scrolls out of sight with the columns. */
.volumes-attach {
  position: sticky;
  inset-inline-start: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: end;
  max-inline-size: calc(100cqi - 2 * var(--space-3));
}

.volumes-attach-card {
  flex: 1 1 18rem;
  min-width: 0;
}

.volumes-attach-actions {
  display: flex;
  gap: var(--space-2);
}
</style>
