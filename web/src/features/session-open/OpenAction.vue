<script setup lang="ts">
/**
 * The one button that opens a session, wherever a card or a dialog offers it. It says
 * where the session opens before it is pressed, `openView` deciding what; a session
 * that nothing can open is no button, and says why. A press carries the plan out: one
 * action runs at once, and a plan that takes more or leads with an explanation opens
 * `OpenPanel`, as does an app that answers with a next step. What came of it is said
 * in the shell's status region.
 *
 * The button keeps focus while it works, so it is marked busy rather than disabled and
 * a second press is not taken; once it has answered it can be pressed again.
 */
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenNotice } from '@/features/session-open/openNotice.ts'
import OpenPanel from '@/features/session-open/OpenPanel.vue'
import { currentSettings, prepareOpen } from '@/features/session-open/openPlan.ts'
import type { OpenAction, OpenTarget, Outcome, Refusal } from '@/features/session-open/openPlan.ts'
import { heardOfSession, previewOpen, sessionNews } from '@/features/session-open/openPreview.ts'
import { openName, openView } from '@/features/session-open/openView.ts'
import { outcomeWords } from '@/features/session-open/placeWords.ts'

import type { Executor } from '@/shared/api/executorModel.ts'
import type { OpenPlan, PlanOpens } from '@/shared/api/openPlanModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import type { SessionFamily } from '@/shared/lib/settings.ts'
import InfoTip from '@/shared/ui/InfoTip.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    session: string
    /** What the button says of itself where it names no holder: «Открыть сессию». */
    action?: string
    /** Another line for the tooltip: what this holder is to the item. */
    detail?: string
    /** What the card's read says of it; a surface whose read does not waits for the plan. */
    executor?: Executor | null
    /** Whose settings cover it, where the caller knows and the executor does not say. */
    family?: SessionFamily
    /** The holder it opens, as the surface prints holders. */
    name?: string
    size?: 'compact' | 'default' | 'inline'
    variant?: 'ghost' | 'primary' | 'text'
  }>(),
  {
    action: undefined,
    detail: '',
    executor: null,
    family: undefined,
    name: undefined,
    size: 'inline',
    variant: 'ghost',
  },
)

const { t } = useI18n()
const say = useOpenNotice()

const family = computed<SessionFamily | undefined>(
  () => props.family ?? (props.executor?.family || undefined),
)
const target = computed<OpenTarget>(() => ({
  kind: 'session',
  session: props.session,
  family: family.value,
}))
const settings = computed(() => currentSettings())

/** The plan as the server last answered it; a refused press on any button of the session asks again. */
const plan = shallowRef<OpenPlan | null>(null)
let latest = 0
watch(
  () => props.session,
  () => {
    plan.value = null
  },
)
watch(
  () =>
    JSON.stringify([
      props.session,
      family.value,
      settings.value.sessions,
      props.executor?.state,
      props.executor?.opened_in,
      props.executor?.opened_host,
      sessionNews(props.session),
    ]),
  async () => {
    latest += 1
    const mine = latest
    const answer = await previewOpen(target.value)
    if (mine === latest) plan.value = answer
  },
  { immediate: true },
)

const view = computed(() =>
  openView(t, {
    executor: props.executor,
    opening: family.value ? settings.value.sessions[family.value] : null,
    plan: plan.value,
  }),
)
const spoken = computed(() => openName(t, view.value, { action: props.action, name: props.name }))
const tooltip = computed(() =>
  [spoken.value, view.value.hint, props.detail].filter(Boolean).join('\n'),
)
/** Nothing to press, so nothing to name it by: why, and who it is. */
const standing = computed(() => [view.value.hint, props.detail].filter(Boolean).join('\n'))
/** The light fill of the dialog's one action carries its own ink; a quiet weight lifts the place. */
const placeLit = computed(() => props.variant !== 'primary')
/** An action's words are never cut; a holder's name is, with the whole of it in the tooltip. */
const nameWhole = computed(() => props.name === undefined)
/** What stands beside the name: the place, its state and that a setting chose it. */
const marks = computed(() =>
  [view.value.text, view.value.state, view.value.setting ? t('open.mark.setting') : '']
    .filter(Boolean)
    .join(' · '),
)

const busy = ref(false)
/** Absent rather than false, because `aria-busy="false"` is a claim and not a default. */
const busyMark = computed(() => busy.value || undefined)
interface Panel {
  actions: readonly OpenAction[]
  notice: Refusal | null
  offer: OpenAction | null
  opens: PlanOpens | null
}
const panel = shallowRef<Panel | null>(null)

function report(outcome: Outcome) {
  say(outcomeWords(t, outcome))
  if (outcome.status === 'refused') heardOfSession(props.session)
}

/**
 * A press that finds the session cannot be opened turns this button into words that
 * stand, and the button it took focus with leaves the page. Focus stays with this
 * holder: on the way to why it opens nothing now, which is what the press found out.
 */
const root = useTemplateRef<HTMLElement>('root')
watch(
  () => view.value.pressable,
  async (pressable, was) => {
    const held = root.value?.contains(document.activeElement) ?? false
    if (pressable || !was || !held) return
    await nextTick()
    moveFocus(root.value?.querySelector<HTMLElement>('.open-action-why'))
  },
)

async function press() {
  if (busy.value) return
  busy.value = true
  try {
    const { actions, notice, offer, plan: planned } = await prepareOpen(target.value)
    const [first] = actions
    if (actions.length > 1 || (first && notice) || offer)
      panel.value = { actions, notice, offer, opens: planned?.opens ?? null }
    else if (first) answeredByTheFirst(await first.run())
    else report({ status: 'refused', refusal: notice ?? { reason: 'no-session' } })
  } finally {
    busy.value = false
  }
}

/** What came of a single action: done, or a panel where it says more can be done. */
function answeredByTheFirst(outcome: Outcome) {
  const offer = 'offer' in outcome ? (outcome.offer ?? null) : null
  if (outcome.status === 'next')
    panel.value = {
      actions: [outcome.next],
      notice: outcome.notice,
      offer,
      opens: outcome.opens,
    }
  else if (outcome.status === 'refused' && offer)
    panel.value = { actions: [], notice: outcome.refusal, offer, opens: outcome.opens ?? null }
  else report(outcome)
}

function finished(outcome: Outcome) {
  panel.value = null
  report(outcome)
}
</script>

<template>
  <span
    ref="root"
    class="open-action-root"
  >
    <VButton
      v-if="view.pressable"
      class="open-action"
      :variant="variant"
      :size="size"
      :title="tooltip"
      :aria-label="spoken"
      :aria-description="standing"
      :aria-busy="busyMark"
      @click="press"
    >
      <span class="open-action-words">
        <span
          class="open-action-name"
          :class="{ whole: nameWhole }"
          >{{ name ?? action }}</span
        >
        <span
          v-if="marks"
          class="open-action-place"
          :class="{ lit: placeLit }"
        >
          <VIcon
            v-if="view.terminal"
            class="open-action-glyph"
            name="terminal"
            :size="14"
          />
          <span>{{ marks }}</span>
        </span>
      </span>
    </VButton>
    <span
      v-else
      class="open-action-still"
      :class="{ named: !nameWhole }"
      :title="standing"
    >
      <span class="open-action-words">
        <span
          v-if="name"
          class="open-action-name"
          >{{ name }}</span
        >
        <span class="open-action-place">{{ marks }}</span>
      </span>
      <InfoTip :label="view.hint">
        {{ view.hint }}
        <template #trigger="{ toggle, popup }">
          <VButton
            class="open-action-why"
            variant="ghost"
            size="inline"
            :aria-label="view.hint"
            :aria-controls="popup.controls"
            :aria-expanded="popup.expanded"
            icon
            @click="toggle"
          >
            <VIcon
              name="info"
              :size="14"
            />
          </VButton>
        </template>
      </InfoTip>
    </span>
    <OpenPanel
      v-if="panel"
      :actions="panel.actions"
      :context="name ?? session"
      :notice="panel.notice"
      :offer="panel.offer"
      :opens="panel.opens"
      @close="panel = null"
      @finished="finished"
    />
  </span>
</template>

<style scoped>
/* The one root, so a host's class lands here: it can place this, and shrinks to its row. */
.open-action-root {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
}

.open-action {
  justify-content: flex-start;
  min-width: 0;
  max-width: 100%;
  text-align: start;
}

/* One line while the name and the place both fit whole, and two after that: the place takes
   a line of its own before the name gives a letter. A holder's name is already its short
   form, the client and the start of its session, so cutting it again leaves two holders
   that read alike; it is cut only where it alone is wider than the line, as on a phone. */
.open-action-words {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  min-width: 0;
  padding-block: var(--space-1);
}

.open-action-name {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.whole {
    white-space: normal;
  }
}

/* It gives way to no name: where a line cannot hold both it takes a line of its own, and
   only wraps inside that one. */
.open-action-place {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: flex-start;
  max-width: 100%;
  white-space: normal;

  &.lit {
    color: var(--color-text);
  }
}

.open-action-glyph {
  flex: none;
  margin-block-start: var(--space-half);
}

/* Nothing to press, so it stands as text in the quiet ink: out of reach, and why beside it. */
.open-action-still {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  max-width: 100%;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

/* A holder's words start where a pressable holder's do, beside them on a card. */
.open-action-still.named {
  padding-inline-start: var(--space-2);
}

.open-action-why {
  flex: none;
}
</style>
