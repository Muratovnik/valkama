<script setup lang="ts">
/**
 * What a review's point says on the one quiet line under its label while it is closed, so that
 * a review of a dozen points reads as a list of decisions rather than a dozen open forms.
 *
 * Accepted with a way, it names the way chosen and says when that is the recommended one; a way
 * still to be chosen is said in words, in the warning's ink. Undecided, or decided otherwise
 * than the agent recommends, it says what the agent recommends, and why when the agent said
 * (`RequestAdvice`), followed while undecided by the start of the description. Otherwise it is
 * the start of the description. A comment written adds a line of its own.
 *
 * The line is cut at the row's end rather than wrapped, except the way, whose words are the
 * decision and wrap in a narrow row rather than lose their end.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestAdvice from '@/features/input-requests/components/RequestAdvice.vue'
import type { DescriptionView } from '@/features/input-requests/utils/optionDescriptions.ts'
import type { PointWay, Verdict } from '@/features/input-requests/utils/reviewForm.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { plainText } from '@/shared/lib/richText.ts'
import RichText from '@/shared/ui/RichText.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = withDefaults(
  defineProps<{
    comment: string
    field: InputRequestField
    verdict: Verdict | null
    view: DescriptionView
    way: PointWay | null
    /** Whether the agent's words are a tab stop, as the row's other presses are. */
    tabStop?: number
  }>(),
  { tabStop: undefined },
)
const { t } = useI18n()
const advice = computed(() => {
  const { recommended } = props.field
  return recommended && props.verdict !== recommended
    ? t('requests.review.agent', { verdict: t(`requests.review.advice.${recommended}`) })
    : ''
})
/** What the verdict opened, while it holds; the way stands in for the description. */
const way = computed(() => (props.way && props.verdict === props.way.option ? props.way : null))
const excerpt = computed(() =>
  way.value || (props.verdict && advice.value) ? '' : (props.field.description ?? ''),
)
const chosen = computed(() => {
  const shown = way.value
  if (!shown) return ''
  if (shown.count) return t('requests.review.of', shown.count)
  if (shown.chosen) return shown.chosen
  return shown.own ? t('requests.ownVariant') : t('requests.review.notChosen')
})
const said = computed(() => props.comment.trim().split('\n')[0] ?? '')
</script>

<template>
  <span
    v-if="advice || way || excerpt"
    class="request-point-line"
  >
    <RequestAdvice
      v-if="advice"
      class="request-point-whole"
      :tab-stop="tabStop"
      :text="advice"
      :why="field.why"
    />
    <span
      v-if="advice && (way || excerpt)"
      class="request-point-whole"
      aria-hidden="true"
      >·</span
    >
    <span
      v-if="way"
      class="request-point-way"
      ><span class="request-point-key">{{ way.label }}: </span
      ><span
        v-if="way.missing"
        class="request-point-missing"
        >{{ chosen }}</span
      ><span
        v-else
        class="request-point-chosen"
        >{{ chosen }}</span
      ><span
        v-if="way.recommended"
        class="request-point-key"
      >
        · {{ t('requests.recommended') }}</span
      ></span
    >
    <RichText
      v-if="excerpt && view === 'line'"
      class="request-point-cut one-line"
      :source="excerpt"
      inline
    />
    <span
      v-else-if="excerpt"
      v-tooltip.clipped="plainText(excerpt)"
      class="request-point-cut one-line"
      >{{ plainText(excerpt) }}</span
    >
  </span>
  <span
    v-if="said"
    class="request-point-line"
  >
    <span class="request-point-cut one-line"
      ><span class="request-point-key">{{ t('requests.comment') }}: </span
      ><span class="request-point-chosen">{{ said }}</span></span
    >
  </span>
</template>

<style scoped>
/* One line in the row's quiet type, from the label's edge to the row's end. */
.request-point-line {
  display: flex;
  gap: 0 var(--space-1);
  align-items: baseline;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-point-whole {
  flex: none;
  white-space: nowrap;
}

/* The decision: its words wrap rather than lose their end. */
.request-point-way {
  flex: 0 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.request-point-key {
  color: var(--color-text-tertiary);
}

.request-point-chosen {
  color: var(--color-text);
}

/* A way still to choose, in the warning's ink; its words say it where colour does not. */
.request-point-missing {
  color: var(--color-warning);
}

/* What is cut short at the row's end. */
.request-point-cut {
  flex: 1 1 0;
}
</style>
