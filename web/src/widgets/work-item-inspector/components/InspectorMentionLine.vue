<script setup lang="ts">
/**
 * One record of another item's text naming this one, as a quiet line among the threads.
 *
 * It is not a thread: nothing answers it here, nothing marks it, and it has no sheet, since
 * an answer goes in the thread of the comment it points at. Its head says where the words
 * stand and from which item, then who wrote them as a comment's head says it, and the time;
 * the item's number is the link to it, as a number in any text on the card is. Under the
 * head stand the words' first line in the quieter ink, cut at the line's end with the whole
 * of them in its hint. A record whose item is deleted says so and leads nowhere.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { mentionWhere } from '@/widgets/work-item-inspector/utils/mentionLines.ts'
import type { MentionLine } from '@/widgets/work-item-inspector/utils/mentionLines.ts'

import { actorName, actorSession } from '@/shared/lib/actor.ts'
import MetaLine from '@/shared/ui/MetaLine.vue'
import RichText from '@/shared/ui/RichText.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  line: MentionLine
  when: (value: string | null) => string
}>()
const { t } = useI18n()

const where = computed(() => mentionWhere(props.line, t))
const authorName = computed(() =>
  props.line.byPerson
    ? t('threads.you')
    : actorName(props.line.author) || t('workItem.unknownAuthor'),
)
const authorSession = computed(() => (props.line.byPerson ? '' : actorSession(props.line.author)))
/**
 * The author after the item's number, the dot held to both by no-break spaces, so a line of
 * the head neither ends nor starts with it. A space in the template is dropped there.
 */
const byline = computed(() => `\u{A0}·\u{A0}${authorName.value}`)
</script>

<template>
  <div class="mention">
    <MetaLine
      class="mention-head"
      :when="when(line.at)"
      :session="authorSession"
      phrase
      ><RichText
        class="mention-where"
        :source="where"
        inline
      />{{ byline }}</MetaLine
    >
    <p
      v-if="line.quote"
      v-tooltip.clipped="line.quote"
      class="mention-quote one-line"
    >
      {{ line.quote }}
    </p>
  </div>
</template>

<style scoped>
/* No sheet and no inset: the line stands on the drawer's ground, its words in line with the
   text inside the sheets beside it. */
.mention {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
  padding-inline: var(--space-3);
}

.mention-where {
  color: var(--color-text-muted);
}

.mention-quote {
  padding-inline-start: var(--space-set-in);
  margin: 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}
</style>
