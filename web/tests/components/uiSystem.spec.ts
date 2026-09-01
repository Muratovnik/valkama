import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { statePresentation } from '@/shared/lib/uiSystem.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VIcon from '@/shared/ui/VIcon.vue'

import { present } from '../support/present.ts'

function closedStateTypeOracle() {
  statePresentation('connection-lifecycle', 'live')
  statePresentation('platform-ui-state', 'ready')
  statePresentation('project-binding', 'mapped')
  statePresentation('relation-state', 'resolved')
  statePresentation('session-feed-result', 'normal')
  statePresentation('work-item-node-marker', 'claimed')
  statePresentation('work-item-priority', 'high')
  statePresentation('work-item-readiness', 'ready')
  // @ts-expect-error Connection lifecycle names are a closed platform vocabulary.
  statePresentation('connection-lifecycle', 'future')
  // @ts-expect-error Platform UI state names are a closed platform vocabulary.
  statePresentation('platform-ui-state', 'future')
  // @ts-expect-error Project binding names are a closed platform vocabulary.
  statePresentation('project-binding', 'future')
  // @ts-expect-error Relation state names are a closed platform vocabulary.
  statePresentation('relation-state', 'future')
  // @ts-expect-error Session feed results are a closed platform vocabulary.
  statePresentation('session-feed-result', 'future')
  // @ts-expect-error Work-item node markers are a closed platform vocabulary.
  statePresentation('work-item-node-marker', 'future')
  // @ts-expect-error Work-item priorities are a closed platform vocabulary.
  statePresentation('work-item-priority', 'future')
  // @ts-expect-error Work-item readiness names are a closed platform vocabulary.
  statePresentation('work-item-readiness', 'future')
}

void closedStateTypeOracle

afterEach(() => {
  document.body.innerHTML = ''
})

describe('shared UI contracts', () => {
  it('keeps registered and unknown manifest icons inside one optical box', () => {
    const generic = mount(VIcon, { props: { name: 'settings', size: 20 } })
    const unknown = mount(VIcon, { props: { name: 'unregistered-manifest-icon', size: 20 } })
    expect(generic.attributes('width')).toBe('20')
    expect(generic.attributes('height')).toBe('20')
    expect(unknown.attributes('width')).toBe('20')
    expect(unknown.attributes('height')).toBe('20')
  })

  it('renders client marks through the shared monochrome icon policy', () => {
    const client = mount(VIcon, { props: { name: 'client', size: 20 } })
    expect(client.element.tagName.toLowerCase()).toBe('svg')
    expect(client.attributes('fill')).toBe('none')
  })

  it('never substitutes the first option for an invalid value', () => {
    const wrapper = mount(SelectionControl, {
      attachTo: document.body,
      props: {
        modelValue: 'missing',
        label: 'Client',
        placeholder: 'Choose a client',
        mode: 'combobox',
        options: [
          { value: 'codex', label: 'Codex' },
          { value: 'claude', label: 'Claude Code' },
        ],
      },
    })
    expect(wrapper.get('button').text()).toContain('Choose a client')
    expect(wrapper.get('button').text()).not.toContain('Codex')
  })

  it('supports a logical empty option without passing an empty value to Reka', () => {
    const wrapper = mount(SelectionControl, {
      attachTo: document.body,
      props: {
        modelValue: '',
        label: 'Scope',
        options: [
          { value: '', label: 'All scopes' },
          { value: 'codex', label: 'Codex' },
        ],
      },
    })
    expect(wrapper.get('button').text()).toContain('All scopes')
  })

  it('renders state text with the color cue instead of color alone', () => {
    const wrapper = mount(SemanticState, {
      props: { dimension: 'session', state: 'failed', label: 'Session error' },
    })
    expect(wrapper.text()).toBe('Session error')
    expect(wrapper.attributes('data-tone')).toBe('danger')
    expect(wrapper.classes()).not.toContain('tone-danger')
    expect(wrapper.attributes('data-dimension')).toBe('session')
  })

  it('owns project binding severity in the shared state table', () => {
    expect(statePresentation('project-binding', 'mapped')).toEqual({
      emphasis: 'quiet',
      tone: 'success',
    })
    expect(statePresentation('project-binding', 'ambiguous')).toEqual({
      emphasis: 'strong',
      tone: 'warning',
    })
    expect(statePresentation('project-binding', 'unavailable')).toEqual({
      emphasis: 'strong',
      tone: 'danger',
    })
  })

  it('owns relation and work-item readiness severity in the shared state table', () => {
    expect(statePresentation('relation-state', 'resolved')).toEqual({
      emphasis: 'quiet',
      tone: 'success',
    })
    expect(statePresentation('relation-state', 'malformed')).toEqual({
      emphasis: 'strong',
      tone: 'danger',
    })
    expect(statePresentation('work-item-readiness', 'ready')).toEqual({
      emphasis: 'quiet',
      tone: 'success',
    })
    expect(statePresentation('work-item-readiness', 'blocked')).toEqual({
      emphasis: 'strong',
      tone: 'danger',
    })
  })

  it('owns platform, connection and feature marker severity in the shared state table', () => {
    expect(statePresentation('platform-ui-state', 'loading')).toEqual({
      emphasis: 'quiet',
      tone: 'info',
    })
    expect(statePresentation('platform-ui-state', 'permission-denied')).toEqual({
      emphasis: 'strong',
      tone: 'danger',
    })
    expect(statePresentation('connection-lifecycle', 'live')).toEqual({
      emphasis: 'quiet',
      tone: 'success',
    })
    expect(statePresentation('session-feed-result', 'failed')).toEqual({
      emphasis: 'strong',
      tone: 'danger',
    })
    expect(statePresentation('work-item-priority', 'high')).toEqual({
      emphasis: 'quiet',
      tone: 'warning',
    })
    expect(statePresentation('work-item-node-marker', 'claimed')).toEqual({
      emphasis: 'quiet',
      tone: 'success',
    })
  })

  it('keeps activity actions open and neutral unless the shared vocabulary maps them', () => {
    expect(statePresentation('activity-action', 'checklist_completed')).toEqual({
      emphasis: 'quiet',
      tone: 'success',
    })
    expect(statePresentation('activity-action', 'provider-defined-action')).toEqual({
      emphasis: 'quiet',
      tone: 'neutral',
    })
  })

  it('fails closed for owned state vocabularies while open dimensions remain neutral', () => {
    for (const dimension of [
      'connection-lifecycle',
      'platform-ui-state',
      'project-binding',
      'relation-state',
      'session-feed-result',
      'work-item-node-marker',
      'work-item-priority',
      'work-item-readiness',
    ] as const) {
      expect(() => statePresentation(dimension, 'future' as never)).toThrow(
        `Unknown ${dimension} state: future`,
      )
    }
    expect(statePresentation('case', 'future')).toEqual({ emphasis: 'quiet', tone: 'neutral' })
  })

  it('renders status and counter geometry from shared component variants', () => {
    const state = mount(SemanticState, {
      props: { dimension: 'case', state: 'collecting', label: 'Collecting', variant: 'badge' },
    })
    expect(state.classes()).toContain('variant-badge')
    const badge = mount(CountBadge, {
      props: { value: 14, label: 'Attention: 14', placement: 'inline' },
    })
    expect(badge.classes()).toContain('placement-inline')
  })

  it('can keep a switch accessible without repeating its state as visible copy', () => {
    const wrapper = mount(ToggleSwitch, {
      props: {
        modelValue: true,
        label: 'AgentMemory',
        onLabel: 'Enabled',
        offLabel: 'Disabled',
        showStateLabel: false,
      },
    })
    expect(wrapper.get('[role="switch"]').attributes('aria-label')).toBe('AgentMemory')
    expect(wrapper.find('.toggle-state').exists()).toBe(false)
  })

  it('publishes a switch transition on its model and nowhere else', async () => {
    const wrapper = mount(ToggleSwitch, {
      props: { modelValue: false, label: 'AgentMemory', onLabel: 'Enabled', offLabel: 'Disabled' },
    })
    await wrapper.get('[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    // A `change` copy carried the same value in the same statement, so a caller
    // chose between two names for one event — and all four call sites chose the
    // one that made them write the model back by hand, none the model itself.
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('gives command dialogs one header, body, footer, close and focus owner', async () => {
    const wrapper = mount(DialogFrame, {
      attachTo: document.body,
      props: {
        open: true,
        title: 'Analysis settings',
        subtitle: 'Configure the run.',
        closeLabel: 'Close',
      },
      slots: {
        default: '<label>Name<input /></label>',
        footer: '<button type="submit">Save</button>',
      },
    })
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.body.querySelectorAll('.overlay-header')).toHaveLength(1)
    expect(document.body.querySelectorAll('.dialog-frame-body')).toHaveLength(1)
    expect(document.body.querySelectorAll('.dialog-frame-footer')).toHaveLength(1)
    present(
      document.body.querySelector<HTMLButtonElement>('[aria-label="Close"]'),
      'the dialog close button',
    ).click()
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
