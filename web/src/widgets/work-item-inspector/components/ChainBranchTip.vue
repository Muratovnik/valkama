<script setup lang="ts">
/**
 * The task the branch map is pointing at, named in full beside the pointer:
 * its reference and state, its title, and who holds it.
 *
 * Hidden from assistive technology, which hears the same task through the
 * lane's own value and the map's announcement instead.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'

const props = defineProps<{
  group: ChainGroup
  member: ChainMember
  position: number
  total: number
}>()

const { t } = useI18n()
const stateName = useStateName()
const state = computed(() => stateName(props.member.state))

/** Who holds the task, then where it stands in its lane. */
const meta = computed(() => {
  const place = t('workItem.chain.map.position', { position: props.position, total: props.total })
  const held = !props.member.state.is_terminal && props.member.claim_ref
  return held ? `${holderName(props.member.claim_ref)} · ${place}` : place
})
</script>

<template>
  <div
    class="branch-tip"
    aria-hidden="true"
  >
    <span class="branch-tip-head">
      <span class="branch-tip-reference">{{ member.reference }}</span>
      <SemanticState
        dimension="work-item-chain-group"
        :state="group"
        :label="state"
      />
    </span>
    <span
      v-slash-breaks="member.title"
      class="branch-tip-title"
    />
    <span class="branch-tip-meta">{{ meta }}</span>
  </div>
</template>

<style scoped>
/* On the tooltip's ground, a step lighter than any other, the information blue of
   a state word falls under 4.5:1. The state says its tone with its dot there, and
   its word in the tip's muted ink. */
.branch-tip {
  --color-state-label: var(--color-text-muted);

  position: absolute;
  z-index: 2;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-tooltip-border);
  color: var(--color-tooltip-text);
  font: var(--font-detail);
  background: var(--color-tooltip-surface);
  border-radius: var(--radius-control);
  box-shadow: 0 8px 24px var(--color-shadow);
  pointer-events: none;
}

.branch-tip-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  align-items: center;
}

.branch-tip-reference {
  font-variant-numeric: tabular-nums;
}

/* A word wider than the tip breaks inside, as a title does everywhere else: unbroken, the
   two clamped lines cut it at the tip's edge with no ellipsis to say it goes on. */
.branch-tip-title {
  display: -webkit-box;
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.branch-tip-meta {
  color: var(--color-text-muted);
}
</style>
