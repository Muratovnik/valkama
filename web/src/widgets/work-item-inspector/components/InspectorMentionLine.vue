<script setup lang="ts">
/**
 * One record of another item's text naming this one, as a quiet line among the threads.
 *
 * It is not a thread: nothing answers it here, nothing marks it, and it has no sheet, since
 * an answer goes in the thread of the comment it points at. It says where the words stand and
 * from which item, the item's number the link to it as a number in any text on the card is;
 * under that who wrote them and when, as a comment's head says it; and under that the words'
 * first line in the quieter ink, cut at the line's end with the whole of them in its hint. A
 * record whose item is deleted says so and leads nowhere.
 *
 * Where and who stood on one line first, a dot between them. Held to the number by no-break
 * spaces so that no line started or ended with it, the dot made the number and the author one
 * run wider than a phone's column, which broke the number at its hyphen, «MAIN-» over «265».
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
</script>

<template>
  <div class="mention">
    <p class="mention-where">
      <RichText
        :source="where"
        inline
      />
    </p>
    <MetaLine
      class="mention-head"
      :when="when(line.at)"
      :session="authorSession"
      >{{ authorName }}</MetaLine
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
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.mention-quote {
  padding-inline-start: var(--space-set-in);
  margin: 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}
</style>
