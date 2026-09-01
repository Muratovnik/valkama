<script setup lang="ts">
/**
 * A skill's own `SKILL.md`, rendered, with the path it came from above it.
 *
 * The path is the button that fetches the file, so the one affordance on the
 * section both says where the text is from and is how you ask for it. The
 * request is guarded by a keyed generation rather than cancelled: a reader
 * clicking down a list of forty skills starts a fetch per row, and the last one
 * asked for is the only one whose answer belongs on screen.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { skillFailure } from '@/pages/skills/utils/skillPresentation.ts'
import type { SkillObservation } from '@/pages/skills/utils/skillResource.ts'

import { fetchSkillDetail } from '@/entities/skill/api/skillsApi'

import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import type { SkillDetail, SkillEntry } from '@/shared/types/skills.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ skill: SkillEntry }>()

const { t, te } = useI18n()

const surface = ref<HTMLElement | null>(null)
interface PreviewAnswer {
  detail: SkillDetail
  rendered: string
}
const resource = ref(createResource<SkillObservation<PreviewAnswer>>()) as Ref<
  ResourceState<SkillObservation<PreviewAnswer>>
>
const current = computed(() =>
  resource.value.key === props.skill.key ? (resource.value.data?.value ?? null) : null,
)
const detail = computed(() => current.value?.detail ?? null)
const rendered = computed(() => current.value?.rendered ?? '')
const loading = computed(() => resource.value.status === 'loading')
const refreshing = computed(() => resource.value.status === 'refreshing')
const refreshingMark = computed(() => refreshing.value || undefined)
const failure = computed(() => (resource.value.status === 'error' ? resource.value.failure : null))

async function load(key: string) {
  resource.value = beginResource(resource.value, key)
  const generation = resource.value.generation
  try {
    const result = await fetchSkillDetail(key)
    const { renderSkillMarkdown } = await import('@/entities/skill/utils/skillMarkdown')
    resource.value = resolveResource(resource.value, generation, key, {
      at: new Date().toISOString(),
      value: { detail: result, rendered: renderSkillMarkdown(result.markdown) },
    })
  } catch (error) {
    resource.value = rejectResource(resource.value, generation, key, skillFailure(error, true))
  }
}

function reason() {
  return failure.value && te(`skills.detailErrors.${failure.value.code}`)
    ? t(`skills.detailErrors.${failure.value.code}`)
    : t('skills.previewError')
}

async function focusPreview() {
  void load(props.skill.key)
  await nextTick()
  surface.value?.focus()
}

watch(() => props.skill.key, load, { immediate: true })
</script>

<template>
  <section
    ref="surface"
    class="skill-preview"
    tabindex="-1"
  >
    <button
      class="skill-location-button"
      type="button"
      @click="focusPreview"
    >
      <VIcon
        name="skills"
        :size="18"
      />
      <span class="location-copy"
        ><small class="location-label">{{ t('skills.location') }}</small
        ><code class="location-path">{{ skill.location }}</code></span
      >
      <span class="location-action">{{ t('skills.openPreview') }}</span>
    </button>

    <slot />

    <p
      v-if="loading && !detail"
      class="preview-status"
      role="status"
    >
      {{ t('skills.previewLoading') }}
    </p>
    <span
      v-if="refreshing"
      class="visually-hidden"
      role="status"
    >
      {{ t('skills.previewLoading') }}
    </span>
    <div
      v-if="failure"
      class="preview-error"
      role="alert"
    >
      <p class="preview-status">{{ reason() }}</p>
      <VButton @click="load(skill.key)">
        {{ t('skills.previewRetry') }}
      </VButton>
    </div>
    <!--
      `rendered` comes from markdown-it configured with html: false, a
      http/https/mailto allowlist on link targets and images rendered as escaped
      text, so raw markup in a skill file cannot reach the DOM.
    -->
    <!-- eslint-disable vue/no-v-html -- see above -->
    <div
      v-if="detail"
      class="skill-markdown"
      :aria-busy="refreshingMark"
      v-html="rendered"
    />
    <!-- eslint-enable vue/no-v-html -->
  </section>
</template>

<style scoped>
.skill-preview {
  min-height: 220px;
  scroll-margin-top: var(--space-4);

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 3px;
  }
}

.skill-location-button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: var(--size-control-target);
  padding: var(--space-3);
  margin-bottom: var(--space-4);
  border: 0;
  color: var(--color-text);
  text-align: left;
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.location-copy {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

.location-label {
  color: var(--color-text-tertiary);
  font: var(--font-label);
}

.location-path {
  font: var(--font-code-meta);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.location-action {
  color: var(--color-action-primary);
  font: var(--font-label);
}

.preview-error {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3);
  border-inline-start: 3px solid var(--color-danger);
  background: var(--color-surface-muted);
}

.preview-status {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-paragraph);
}

/* The one block on this screen holding prose it did not write. Everything under
   `:deep()` is `markdown-it`'s output and appears in no template, and a
   heading's margin here follows the heading's own size rather than the interface
   grid, which is what `em` is for. */
.skill-markdown {
  color: var(--color-text);
  font: var(--font-paragraph);

  :deep(h1) {
    font-size: var(--font-size-page);
  }

  :deep(h2) {
    font-size: var(--font-size-module);
  }

  :deep(h3) {
    font-size: var(--font-size-emphasis);
  }

  :deep(a) {
    color: var(--color-action-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  :deep(code) {
    display: inline;
    padding: var(--space-half) var(--space-1);
    font: var(--font-size-meta)/var(--line-height-normal) var(--font-family-mono);
    overflow-wrap: anywhere;
    background: var(--color-surface-muted);
    border-radius: var(--radius-status);
  }

  :deep(pre) {
    max-width: 100%;
    padding: var(--space-3);
    background: var(--color-surface-muted);
    overflow: auto;
    border-radius: var(--radius-card);
  }

  :deep(pre code) {
    padding: 0;
    border: 0;
    background: transparent;
  }

  :deep(blockquote) {
    padding-left: var(--space-3);
    border-left: 3px solid var(--color-rule-strong);
    color: var(--color-text-muted);
  }

  :deep(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }

  & :deep(:is(h1, h2, h3)) {
    margin: 1.4em 0 0.55em;
    line-height: var(--line-height-snug);
    letter-spacing: -0.015em;
  }

  & :deep(:is(h1:first-child, h2:first-child, h3:first-child)) {
    margin-top: 0;
  }

  & :deep(:is(p, ul, ol, pre, blockquote, table)) {
    margin: 0 0 1em;
  }

  & :deep(:is(ul, ol)) {
    padding-left: 1.4em;
  }

  & :deep(:is(th, td)) {
    padding: var(--space-2);
    border: 1px solid var(--color-rule);
  }
}
</style>
