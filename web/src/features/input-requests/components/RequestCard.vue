<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestField from '@/features/input-requests/components/RequestField.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { checkAnswers } from '@/features/input-requests/utils/validateAnswers.ts'

import {
  answerInputRequest,
  declineInputRequest,
  fetchInputRequest,
  InputRequestError,
} from '@/shared/api/inputRequestApi.ts'
import type {
  InputAnswers,
  InputRequestEntry,
  InputRequestField,
} from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    draft: InputAnswers
    entry: InputRequestEntry
    /**
     * Say "waiting for your answer" on a pending request. A list that holds only
     * those, in a dialog titled with the same words, leaves the line out rather
     * than repeating its own title on every card.
     */
    announcePending?: boolean
    showTaskLink?: boolean
  }>(),
  { showTaskLink: true, announcePending: true },
)
const emit = defineEmits<{
  'select': [target: PlanningTarget]
  'update:draft': [answers: InputAnswers]
  'updated': [entry: InputRequestEntry]
}>()
const { t, d } = useI18n()
const local = ref(props.entry)
const busy = ref(false)
const error = ref('')
/** The fields the last send refused, by id; each clears once it is edited. */
const refused = ref<string[]>([])
const card = ref<HTMLElement | null>(null)
const fieldControls: Record<string, { focus: () => void } | null> = {}
const requiresRefresh = ref(false)
const now = ref(Date.now())
let generation = 0
const timer = setInterval(() => {
  now.value = Date.now()
}, 1000)
onUnmounted(() => {
  generation++
  clearInterval(timer)
})
watch(
  () => props.entry,
  (entry) => {
    if (requestIdentity(entry) !== requestIdentity(local.value)) {
      generation++
      busy.value = false
      error.value = ''
      refused.value = []
      requiresRefresh.value = false
    }
    local.value = entry
  },
)
const request = computed(() => local.value.request)
/**
 * Only a write the server refused or could not confirm, or a deadline that has
 * passed here, needs the request read again. A field left empty does not: it
 * once brought a second «Refresh» into a dialog that already had one.
 */
const canRefresh = computed(() => error.value !== '' || pastDue.value)
const hasActions = computed(
  () => request.value.status === 'pending' || canRefresh.value || props.showTaskLink,
)
const pastDue = computed(() => {
  const expires = request.value.expires_at
  return expires !== null && Date.parse(expires) <= now.value
})
const supported = computed(() =>
  request.value.fields.every((field) =>
    ['boolean', 'choice', 'multi_choice', 'text'].includes(field.type),
  ),
)
const writable = computed(
  () =>
    props.entry.target.writable &&
    local.value.target.writable &&
    request.value.status === 'pending' &&
    !pastDue.value &&
    supported.value,
)
const busyMark = computed(() => busy.value || undefined)
const answerLabel = computed(() => t(busy.value ? 'requests.saving' : 'requests.answer'))
const deadlineLabel = computed(() =>
  t(pastDue.value ? 'requests.deadline' : 'requests.expires', {
    time: request.value.expires_at ? stamp(request.value.expires_at) : '',
  }),
)
/** Project and task; the space key is left out where the reference already begins with it. */
const context = computed(() => {
  const { project_id: project, space_ref: space } = props.entry.target
  const reference = request.value.reference
  return reference.startsWith(`${space.space_key}-`)
    ? `${project} · ${reference}`
    : `${project} · ${space.space_key} · ${reference}`
})
/**
 * What happened, and who did it. This app signs its writes with one technical
 * name, and the person reading is the one who wrote them, so that name reads
 * as "you". Display only: the stored author is left as it is.
 */
const outcome = computed(() => {
  const { status, answered_by: by } = request.value
  if (status === 'pending') return props.announcePending ? t('requests.pending') : ''
  if (isWebAuthor(by) && status !== 'expired')
    return t(status === 'answered' ? 'requests.youAnswered' : 'requests.youDeclined')
  const state = t(`requests.${status}`)
  return by ? `${state} · ${t('requests.resolvedBy', { actor: by })}` : state
})
const author = computed(() =>
  isWebAuthor(request.value.author) ? t('requests.you') : request.value.author,
)
const stamp = (value: string) => d(new Date(value), { dateStyle: 'medium', timeStyle: 'short' })

function edit(field: InputRequestField, value: string | boolean | string[]) {
  emit('update:draft', { ...props.draft, [field.id]: value })
  refused.value = refused.value.filter((id) => id !== field.id)
}
function fieldError(field: InputRequestField) {
  return refused.value.includes(field.id) ? t(`requests.missing.${field.type}`) : ''
}
async function resolve(action: 'answer' | 'decline') {
  if (busy.value || !writable.value || requiresRefresh.value) return
  const checked = action === 'answer' ? checkAnswers(request.value.fields, props.draft) : null
  refused.value = checked?.refused ?? []
  const first = refused.value[0]
  if (first !== undefined) {
    // Taken to the first field to fix, the reader hears its message with it.
    await nextTick()
    fieldControls[first]?.focus()
    return
  }
  const values = checked?.values ?? {}
  const entry = local.value
  const identity = requestIdentity(entry)
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    const result = await (action === 'answer'
      ? answerInputRequest(entry, values)
      : declineInputRequest(entry))
    if (current !== generation || identity !== requestIdentity(local.value)) return
    if (requestIdentity(result) !== identity) {
      error.value = 'mutationError'
      requiresRefresh.value = true
      return
    }
    local.value = result
    emit('updated', result)
  } catch (error_) {
    if (current === generation) {
      error.value =
        error_ instanceof InputRequestError && (error_.status === 409 || error_.status === 410)
          ? 'conflict'
          : 'mutationError'
      requiresRefresh.value = true
    }
  } finally {
    if (current === generation) busy.value = false
  }
}
async function refresh() {
  if (busy.value) return
  const entry = local.value
  const identity = requestIdentity(entry)
  const current = ++generation
  busy.value = true
  try {
    const result = await fetchInputRequest(entry.target, entry.request.request_id)
    if (current !== generation || identity !== requestIdentity(local.value)) return
    if (requestIdentity(result) !== identity) {
      error.value = 'mutationError'
      return
    }
    local.value = result
    error.value = ''
    requiresRefresh.value = false
    emit('updated', result)
  } catch {
    if (current === generation) error.value = 'mutationError'
  } finally {
    if (current === generation) busy.value = false
  }
}
/** Moves focus to this request's heading, which names it. */
function focus() {
  card.value?.querySelector<HTMLElement>('.request-title')?.focus()
}
function display(field: InputRequestField): string {
  const value = request.value.answers?.[field.id]
  if (typeof value === 'boolean') return t(value ? 'requests.yes' : 'requests.no')
  const label = (option: string) =>
    field.options.find((item) => item.id === option)?.label ?? option
  if (Array.isArray(value)) return value.map((option) => label(option)).join(', ')
  if (typeof value !== 'string') return t('requests.noAnswer')
  return field.type === 'choice' ? label(value) : value
}
defineExpose({ focus })
</script>

<template>
  <article
    ref="card"
    class="request-card"
    :aria-busy="busyMark"
  >
    <header class="request-header">
      <p class="request-context">{{ context }}</p>
      <SectionHeading
        class="request-title"
        as="h3"
        level="panel"
        tabindex="-1"
        >{{ request.title }}</SectionHeading
      >
      <p class="request-meta">
        {{ t('requests.author', { actor: author }) }} · {{ stamp(request.created_at) }}
      </p>
      <p
        v-if="request.execution_id"
        class="request-meta"
      >
        {{ t('requests.execution', { id: request.execution_id }) }}
      </p>
      <p
        v-if="request.session_id"
        class="request-meta"
      >
        {{ t('requests.session', { id: request.session_id }) }}
      </p>
    </header>
    <p class="request-prompt">{{ request.prompt }}</p>
    <p
      v-if="outcome"
      class="request-state"
      role="status"
    >
      {{ outcome
      }}<template v-if="request.resolved_at"> · {{ stamp(request.resolved_at) }}</template>
    </p>
    <p
      v-if="request.expires_at && request.status === 'pending'"
      class="request-meta"
    >
      {{ deadlineLabel }}
    </p>
    <p
      v-if="!entry.target.writable"
      class="request-meta"
    >
      {{ t('requests.readonly') }}
    </p>
    <p
      v-if="!supported"
      role="alert"
    >
      {{ t('requests.unsupported') }}
    </p>
    <div
      v-if="request.status === 'pending' && supported"
      class="request-fields"
    >
      <RequestField
        v-for="field in request.fields"
        :key="field.id"
        :ref="(control) => (fieldControls[field.id] = control as { focus: () => void } | null)"
        :field="field"
        :model-value="draft[field.id]"
        :disabled="!writable || busy"
        :error="fieldError(field)"
        @update:model-value="edit(field, $event)"
      />
    </div>
    <dl
      v-if="request.status === 'answered'"
      class="request-outcome"
      :aria-label="t('requests.outcome')"
    >
      <template
        v-for="field in request.fields"
        :key="field.id"
        ><dt>{{ field.label }}</dt>
        <dd class="request-value">{{ display(field) }}</dd></template
      >
    </dl>
    <p
      v-if="error"
      class="request-error"
      role="alert"
    >
      {{ t(`requests.${error}`) }}
    </p>
    <div
      v-if="hasActions"
      class="request-actions"
    >
      <VButton
        v-if="request.status === 'pending'"
        variant="primary"
        :disabled="!writable || busy || requiresRefresh"
        @click="resolve('answer')"
        >{{ answerLabel }}</VButton
      >
      <VButton
        v-if="request.status === 'pending'"
        :disabled="!writable || busy || requiresRefresh"
        @click="resolve('decline')"
        >{{ t('requests.decline') }}</VButton
      >
      <VButton
        v-if="canRefresh"
        :disabled="busy"
        @click="refresh"
        >{{ t('requests.checkStatus') }}</VButton
      >
      <VButton
        v-if="showTaskLink"
        variant="ghost"
        @click="emit('select', entry.target)"
        >{{ t('requests.openTask') }}</VButton
      >
    </div>
  </article>
</template>

<style scoped>
.request-card {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
  padding-block: var(--space-5);
  border-bottom: 1px solid var(--color-rule);
}

.request-header {
  display: grid;
  gap: var(--space-1);
}

/* Focus arrives here from the request answered before it. The ring follows the
   platform's keyboard rule rather than appearing on every pointer answer. */
.request-title:focus {
  outline: none;
}

.request-title:focus-visible {
  border-radius: var(--radius-control);
  outline: 2px solid var(--color-focus-ring);
  outline-offset: var(--space-half);
}

.request-context,
.request-meta {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
  overflow-wrap: anywhere;
}

.request-prompt {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.request-state {
  margin: 0;
  font-size: var(--font-size-interface);
}

.request-fields {
  display: grid;
  gap: var(--space-4);
}

.request-outcome {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--font-size-interface);
}

.request-value {
  margin: 0 0 var(--space-2);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.request-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-dense);
}

.request-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
