<script setup lang="ts">
/**
 * Everything the product knows about one skill, in the inspector drawer.
 *
 * The drawer names each section and hands its contents to the component that owns
 * them, which is why the two headings below are written here: the row is this
 * file's markup placed into a child's slot, so one rule dresses both without
 * either child reaching into the other.
 */
import { useI18n } from 'vue-i18n'

import SkillActivation from '@/pages/skills/components/SkillActivation.vue'
import SkillPreview from '@/pages/skills/components/SkillPreview.vue'
import { readinessState, skillPresentation } from '@/pages/skills/utils/skillPresentation.ts'

import { SKILLS_DRAWER_STORAGE_KEY } from '@/shared/lib/shellLayout'
import type { SkillEntry, SkillsPayload } from '@/shared/types/skills.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import InspectorDrawer from '@/shared/ui/InspectorDrawer.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ clients: SkillsPayload['clients']; skill: SkillEntry | null }>()
const emit = defineEmits<{ close: []; updated: [payload: SkillsPayload] }>()

const { t, te, locale } = useI18n()
const { capabilityCount, formatObserved, readinessLabel, scopeLabel, skillReason } =
  skillPresentation(t, te, () => locale.value)
</script>

<template>
  <InspectorDrawer
    panel-class="skill-drawer"
    :open="Boolean(skill)"
    :title="skill?.name || t('skills.preview')"
    :aria-label="t('skills.preview')"
    :resize-label="t('skills.resizePreview')"
    :width-storage-key="SKILLS_DRAWER_STORAGE_KEY"
    @close="emit('close')"
  >
    <DrawerFrame
      v-if="skill"
      :title="skill.name"
      :subtitle="scopeLabel(skill)"
      :close-label="t('skills.closeInspector')"
      @close="emit('close')"
    >
      <template #meta>
        <SemanticState
          dimension="skill-readiness"
          variant="badge"
          :state="readinessState(skill)"
          :label="readinessLabel(skill)"
        />
      </template>

      <article class="skill-detail">
        <div
          v-if="skillReason(skill)"
          class="skill-diagnostic"
          role="status"
        >
          <VIcon
            name="info"
            :size="18"
          />
          <p class="diagnostic-line">{{ skillReason(skill) }}</p>
        </div>

        <SkillActivation
          class="detail-section activation-section"
          :clients="clients"
          :skill="skill"
          @updated="(payload) => emit('updated', payload)"
        >
          <div class="heading-row">
            <SectionHeading
              as="h4"
              level="panel"
              class="section-title"
              >{{ t('skills.activation') }}</SectionHeading
            >
            <span class="section-note client-count">
              {{ t('skills.clientCount') }}
              <CountBadge
                placement="inline"
                :value="clients.length"
              />
            </span>
          </div>
        </SkillActivation>

        <SkillPreview
          class="detail-section preview-section"
          :skill="skill"
        >
          <div class="heading-row">
            <SectionHeading
              as="h4"
              level="panel"
              class="section-title"
              >{{ t('skills.preview') }}</SectionHeading
            >
            <span class="section-note">SKILL.md</span>
          </div>
        </SkillPreview>

        <section class="detail-section">
          <SectionHeading
            as="h4"
            level="panel"
            class="section-title"
            >{{ t('skills.description') }}</SectionHeading
          >
          <p class="detail-line">{{ skill.description || skill.directory_name }}</p>
        </section>
        <section class="detail-section">
          <SectionHeading
            as="h4"
            level="panel"
            class="section-title"
            >{{ t('skills.capabilities') }}</SectionHeading
          >
          <ul class="capability-list">
            <li class="capability-row">
              <span>{{ t('skills.scripts') }}</span
              ><b class="capability-count">{{ capabilityCount(skill, 'script') }}</b>
            </li>
            <li class="capability-row">
              <span>{{ t('skills.references') }}</span
              ><b class="capability-count">{{ capabilityCount(skill, 'reference') }}</b>
            </li>
            <li class="capability-row">
              <span>{{ t('skills.assets') }}</span
              ><b class="capability-count">{{ capabilityCount(skill, 'asset') }}</b>
            </li>
          </ul>
        </section>
        <details class="detail-section technical-detail">
          <summary class="technical-summary">{{ t('skills.technicalDetails') }}</summary>
          <dl class="metadata-grid">
            <div class="metadata-cell">
              <dt class="metadata-label">{{ t('skills.version') }}</dt>
              <dd class="metadata-value">{{ skill.metadata.version || '—' }}</dd>
            </div>
            <div class="metadata-cell">
              <dt class="metadata-label">{{ t('skills.license') }}</dt>
              <dd class="metadata-value">{{ skill.metadata.license || '—' }}</dd>
            </div>
            <div class="metadata-cell">
              <dt class="metadata-label">{{ t('skills.compatibility') }}</dt>
              <dd class="metadata-value">{{ skill.metadata.compatibility || '—' }}</dd>
            </div>
            <div class="metadata-cell">
              <dt class="metadata-label">{{ t('skills.root') }}</dt>
              <dd class="metadata-value">
                <code class="detail-code">{{ skill.root_id }}</code>
              </dd>
            </div>
          </dl>
          <ul class="validation-checks">
            <li
              v-for="check in skill.validation.checks"
              :key="check"
              class="validation-check"
            >
              <code class="detail-code">{{ check }}</code>
            </li>
            <li
              v-if="!skill.validation.checks.length"
              class="validation-check"
            >
              {{ t('skills.noChecks') }}
            </li>
          </ul>
        </details>
        <footer class="detail-provenance">
          {{ t('skills.asOf', { date: formatObserved(skill.provenance.observed_at) }) }}
        </footer>
      </article>
    </DrawerFrame>
  </InspectorDrawer>
</template>

<style scoped>
.skill-detail {
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface-sheet);

  /* Sections of the detail are separated by the air between them. They were
     separated by air and a hairline, which is the same boundary drawn twice down
     the length of a narrow drawer. */
  > .detail-section {
    padding: var(--space-6) 0;
  }

  /* Activation is the first task in the drawer. The preview may be an entire
     handbook, so putting it first hid the switches below an unbounded document. */
  > .activation-section {
    padding-top: 0;
  }
}

.skill-diagnostic {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-3);
  margin-bottom: var(--space-4);
  border-inline-start: 3px solid var(--color-warning);
  color: var(--color-warning);
  background: var(--color-surface-muted);
  border-radius: var(--radius-card);
}

.diagnostic-line,
.detail-line {
  margin: 0;
  font: var(--font-paragraph);
}

.detail-line {
  color: var(--color-text-muted);
}

/* The margin under it, and nothing else: `SectionHeading` owns the type. It used
   to say 13px and leave the weight open, so the drawer's own section headings
   were regular while the card drawer's were semibold. */
.section-title {
  margin-bottom: var(--space-2);
}

/* A title on the left and what it is counting on the right, on one baseline. The
   row is not the heading: `SectionHeading`'s own root carries that name, and two
   elements one inside the other answering to `.section-heading` was two scopes
   apart and still one word too many. */
.heading-row {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--space-2);

  .section-title {
    margin: 0;
  }
}

.section-note {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-dense);
}

.client-count {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

.capability-list,
.validation-checks {
  padding: 0;
  list-style: none;
}

.capability-list {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.capability-row {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);
  border-radius: var(--radius-status);
}

.capability-count {
  color: var(--color-text);
  font-weight: 600;
}

.technical-summary {
  min-height: var(--size-control-height-compact);
  color: var(--color-text);
  font: var(--font-label);
  cursor: pointer;
}

/* Cells with air between them, not a grid of hairlines. This painted `--color-rule`
   behind the grid and spent a one-pixel gap on letting it through, which draws
   a line at every seam — seven of them — while the line ledger counted none,
   because the ledger reads borders and these were a background. */
.metadata-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-1);
  margin: var(--space-2) 0;
}

.metadata-cell {
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-status);
}

.metadata-label {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-dense);
}

.metadata-value {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-dense);
  overflow-wrap: anywhere;
}

.detail-code {
  display: block;
  color: var(--color-text);
  font: var(--font-code-meta);
  overflow-wrap: anywhere;
}

.validation-checks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
}

.validation-check {
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);
  border-radius: var(--radius-status);
}

.detail-provenance {
  padding: var(--space-6) 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-dense);
}

@container workspace (width <= 696px) {
  .metadata-grid {
    grid-template-columns: 1fr;
  }
}
</style>
