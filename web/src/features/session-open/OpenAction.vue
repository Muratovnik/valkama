<script setup lang="ts">
/**
 * The one button that opens a session, wherever a card or a dialog offers it. It says
 * where the session opens before it is pressed, `openView` deciding what; a session
 * that nothing can open is no button, and says why. A press carries the plan out: one
 * action runs at once, and a plan that takes more or leads with an explanation opens
 * `OpenPanel`, as does an app that answers with a next step. What came of it is said
 * in the shell's status region.
 *
 * Where it opens, whether it runs and that a setting chose the place stand after the name
 * as glyphs, each named by its words and saying them under the pointer: as words they made
 * a second run of text in another ink and weight beside the name. A holder's name takes the
 * weight of the words round it, so it reads as a value of its line rather than as a label of
 * its own. Where nothing can be pressed, the words stand, since they are the reason.
 *
 * The button keeps focus while it works, so it is marked busy rather than disabled and
 * a second press is not taken; once it has answered it can be pressed again.
 */
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { reportMissingPlace } from '@/features/session-open/missingPlaces.ts'
import { useOpenNotice } from '@/features/session-open/openNotice.ts'
import OpenPanel from '@/features/session-open/OpenPanel.vue'
import { currentSettings, prepareOpen } from '@/features/session-open/openPlan.ts'
import type { OpenAction, OpenTarget, Outcome, Refusal } from '@/features/session-open/openPlan.ts'
import { heardOfSession, previewOpen, sessionNews } from '@/features/session-open/openPreview.ts'
import { openMarks, openName, openTip, openView } from '@/features/session-open/openView.ts'
import type { OpenMark } from '@/features/session-open/openView.ts'
import { outcomeKind, outcomeWords } from '@/features/session-open/placeWords.ts'

import type { Executor } from '@/shared/api/executorModel.ts'
import type { OpenPlan, PlanOpens } from '@/shared/api/openPlanModel.ts'
import { sessionName } from '@/shared/lib/actor.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import type { SessionFamily } from '@/shared/lib/settings.ts'
import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import ControlIcon from '@/shared/ui/ControlIcon.vue'
import InfoTip from '@/shared/ui/InfoTip.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    session: string
    /** What the button says of itself where it names no holder: «Открыть сессию». */
    action?: string
    /** Another line for a screen reader's description: what this holder is to the item. */
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
/** Nothing to press, so nothing to name it by: why, and who it is. */
const standing = computed(() => [view.value.hint, props.detail].filter(Boolean).join('\n'))
const description = computed(() => [view.value.state, standing.value].filter(Boolean).join('\n'))
/** What a press does, and the state under it: the name and the glyphs say the rest. */
const tooltip = computed(() => openTip(t, view.value, { action: props.action }))
/**
 * A program this computer lacks, which the surface says once: the row then says only who
 * it is, or what a press would have done, and its mark says why.
 */
const told = reportMissingPlace(() => view.value.missing)
const marked = computed(() => told && Boolean(view.value.missing))
/** What a session that opens nothing is called on its row: the holder, or the action it would be. */
const stillName = computed(() => props.name ?? (marked.value ? props.action : undefined))
/** An action's words are never cut; a holder's name is, the whole of it in the button's name. */
const nameWhole = computed(() => props.name === undefined)
/** A bare button stands its words at its fill's inset, which words standing beside it match. */
const textInset = computed(() => props.variant === 'text')
/** What stands beside the name: the place, that it runs and that a setting chose it. */
const marks = computed(() => openMarks(t, view.value))
/** The same, as the words a session that cannot be opened says them. */
const markWords = computed(() => marks.value.map(({ label }) => label).join(' · '))
/** A glyph's hint is its name; a place that says its word has said it. */
const markHint = (mark: OpenMark) => (mark.word ? undefined : mark.label)
/** A running session's glyph, in the hue a live session has wherever one is listed. */
const liveTone = semanticStatePresentation({ dimension: 'session', state: 'active' }).tone

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
  // The holder this button prints, or the session as a holder of it would print.
  const name = props.name ?? sessionName(family.value ?? plan.value?.client ?? '', props.session)
  say(outcomeWords(t, outcome, { kind: 'session', name }), outcomeKind(outcome))
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
      v-tooltip.detail="{ ...tooltip, words: name }"
      class="open-action"
      :class="{ named: !nameWhole }"
      :variant="variant"
      :size="size"
      :aria-label="spoken"
      :aria-description="description"
      :aria-busy="busyMark"
      @click="press"
    >
      <span class="open-action-words">
        <span
          class="open-action-name one-line"
          :class="{ whole: nameWhole }"
          >{{ name ?? action }}</span
        >
        <span
          v-if="marks.length"
          class="open-action-marks"
        >
          <span
            v-for="mark in marks"
            :key="mark.key"
            v-tooltip.name="markHint(mark)"
            class="open-action-mark"
            role="img"
            :class="{ word: mark.word }"
            :aria-label="mark.label"
            :data-mark="mark.key"
          >
            <ControlIcon
              v-if="mark.client"
              class="open-action-glyph"
              :name="mark.client"
              :size="14"
            />
            <VIcon
              v-else-if="mark.glyph && mark.key === 'live'"
              class="open-action-glyph"
              :name="mark.glyph"
              :data-tone="liveTone"
              :size="14"
            />
            <VIcon
              v-else-if="mark.glyph"
              class="open-action-glyph"
              :name="mark.glyph"
              :size="14"
            />
            <template v-else>{{ mark.label }}</template>
          </span>
        </span>
      </span>
    </VButton>
    <!-- The words stand with no hint: the why is a control of its own beside them. -->
    <span
      v-else
      class="open-action-still"
      :class="{ 'named': !nameWhole, 'text-inset': textInset }"
    >
      <span class="open-action-words">
        <span
          v-if="stillName"
          v-tooltip.clipped="stillName"
          class="open-action-name one-line"
          :class="{ who: !nameWhole }"
          >{{ stillName }}</span
        >
        <!-- The why follows the last word, on its line, however the words wrap. -->
        <span
          class="open-action-place standing"
          :class="{ bare: marked }"
          ><span v-if="!marked">{{ markWords }}</span
          ><InfoTip
            class="open-action-tip"
            :label="view.hint"
          >
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
            </template> </InfoTip
        ></span>
      </span>
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

/* A host whose label stands beside the name can lift it off the button's quiet ink. */
.open-action-name {
  flex: 0 1 auto;
  color: var(--color-open-action-name, inherit);

  &.whole {
    white-space: normal;
  }
}

/* A holder's name is a value of the line it stands on, in that line's weight; an action's
   words keep the button's. At the button's weight a holder read as a size larger than the
   words before it. */
.open-action.named {
  font-weight: inherit;
}

/* The glyphs give way to no name: where a line cannot hold both they take a line of their
   own. Each is centred on the name's line, as a letter's middle would stand. */
.open-action-marks {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  align-self: center;
}

.open-action-mark {
  display: inline-grid;
  place-items: center;
  min-width: 14px;
  height: 14px;

  &.word {
    height: auto;
    white-space: nowrap;
  }
}

.open-action-glyph {
  &[data-tone='success'] {
    color: var(--color-success);
  }
}

/* The words of a session that cannot be opened: the reason, in their own run. */
.open-action-place {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: flex-start;
  max-width: 100%;
  white-space: normal;
}

/* Nothing to press, so it stands as text in the quiet ink: out of reach, and why after it.
   A holder's name keeps the ink a name has, so who it is and what keeps it shut read as two
   things rather than one run of grey. */
.open-action-still {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  color: var(--color-text-tertiary);
  font: var(--font-detail);

  .open-action-name.who {
    color: var(--color-text-muted);
  }

  /* The why's target is taller than a line of these words: the name stands level with it. */
  .open-action-words {
    align-items: center;
  }
}

/* The words and the why are one run of text, so the why stands after the last word wherever
   the words break, never at the far end of a line they no longer fill. */
.open-action-place.standing {
  display: block;
  flex: 0 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Off the last word, so the target's edge, which a forced palette draws, never touches a
   letter; its own inset makes the rest of the room before the glyph. */
.open-action-tip {
  margin-inline-start: var(--space-1);
}

/* With no words before it, the glyph follows the name closer than a second fact would;
   where the name leaves it no room, it starts the next line as a place's words do, and the
   name is not cut for it. */
.open-action-place.standing.bare {
  margin-inline-start: calc(-1 * var(--space-1));

  .open-action-tip {
    margin-inline-start: 0;
  }
}

/* A holder's words start where a pressable holder's are drawn, beside them on a card: a bare
   button's words stand at its fill's inset, so these take that inset too; a ghost or a primary
   draws its ground first, at its edge, and so these start at the edge. Taking the bare inset
   beside a ground put a session that cannot be opened 8px in from its label in Relations. */
.open-action-still.named.text-inset {
  padding-inline-start: var(--space-fill-inset);
}
</style>
