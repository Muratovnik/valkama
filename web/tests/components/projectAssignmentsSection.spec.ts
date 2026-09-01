import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PlatformSettingsRegistry from '@/widgets/settings-registry/components/PlatformSettingsRegistry.vue'
import ProjectAssignmentsSection from '@/widgets/settings-registry/components/ProjectAssignmentsSection.vue'

import {
  resetProjectAssignment,
  setModuleState,
  setPlatformAssignment,
} from '@/shared/api/platformApi.ts'
import type { PlatformRegistryReady, RegistryConnection } from '@/shared/api/platformApiTypes.ts'
import { messages } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

vi.mock('@/shared/api/platformApi.ts', () => ({
  resetProjectAssignment: vi.fn(),
  setModuleState: vi.fn(),
  setPlatformAssignment: vi.fn(),
}))

const codexId = 'openai:codex:codex-rollout-telemetry:local'
const claudeId = 'anthropic:claude:claude-journal-telemetry:local'

function connection(
  owner: string,
  serviceId: string,
  lineage: string,
  diagnostics?: string,
): RegistryConnection {
  const scope = { kind: 'global' as const }
  return {
    applicability: scope,
    capabilities: ['telemetry.query'],
    configuration_owner: owner,
    connection_ref: {
      service_ref: { owner_id: owner, service_id: serviceId },
      adapter_lineage_id: lineage,
      connection_id: 'local',
    },
    health: 'ready',
    last_checked_at: '2026-08-21T08:00:00Z',
    name: `integrations.${serviceId}`,
    observed_at: '2026-08-21T08:00:00Z',
    scope,
    service: {
      owner_id: owner,
      service_id: serviceId,
      service_type: 'local-journal',
      title_key: `integrations.${serviceId}`,
    },
    state: 'registered',
    transport: 'local-file',
    trust: 'trusted',
    trust_owner: 'platform',
    ...(diagnostics ? { diagnostics: { code: 'probe-detail', message: diagnostics } } : {}),
  }
}

function payload(diagnostics?: string): PlatformRegistryReady {
  const codex = connection('openai', 'codex', 'codex-rollout-telemetry', diagnostics)
  const claude = connection('anthropic', 'claude', 'claude-journal-telemetry')
  return {
    action_inputs: [],
    actions: [],
    adapters: [],
    assignments: [
      {
        assignment_id: 'installation-telemetry-query',
        capability_id: 'telemetry.query',
        changed_by: 'platform-seed',
        connection_ids: [codexId],
        revision: 1,
        scope: { kind: 'installation' },
        state: 'enabled',
      },
      {
        assignment_id: 'project-alpha-telemetry-query',
        capability_id: 'telemetry.query',
        changed_by: 'operator',
        connection_ids: [claudeId],
        revision: 4,
        scope: { kind: 'project', project_id: 'alpha' },
        state: 'enabled',
      },
    ],
    audit: [],
    capabilities: [
      {
        assignment: {
          assignment_id: 'project-alpha-telemetry-query',
          capability_id: 'telemetry.query',
          changed_by: 'operator',
          connection_ids: [claudeId],
          revision: 4,
          scope: { kind: 'project', project_id: 'alpha' },
          state: 'enabled',
        },
        capability: {
          assignment_scopes: ['installation', 'project'],
          capability_id: 'telemetry.query',
          cardinality: 'one',
          operation_character: 'read',
          permissions: ['telemetry.query'],
          result_type: 'telemetry',
          unavailable_state: 'unavailable',
        },
        connections: [claude],
        health: ['ready'],
        permissions: ['telemetry.query'],
        source: 'project',
        state: 'ready',
      },
    ],
    connections: [codex, claude],
    core_ref_bindings: [],
    grants: [],
    modules: [],
    packages: [],
    services: [],
  }
}

function plugins() {
  return [createI18n({ legacy: false, locale: 'en', messages })]
}

describe('ProjectAssignmentsSection', () => {
  beforeEach(() => {
    vi.mocked(resetProjectAssignment)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(setPlatformAssignment)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(setModuleState)
      .mockReset()
      .mockResolvedValue(undefined as never)
  })

  it('uses the shared labelled keyboard control and writes the selected override', async () => {
    const wrapper = mount(ProjectAssignmentsSection, {
      props: { payload: payload(), projectId: 'alpha' },
      global: { plugins: plugins() },
    })
    const select = wrapper.getComponent(ChoiceSelect)
    expect(select.get('[role="combobox"]').attributes('aria-label')).toBe('telemetry.query')

    select.vm.$emit('update:modelValue', codexId)
    await flushPromises()

    expect(setPlatformAssignment).toHaveBeenCalledWith(
      'telemetry.query',
      { kind: 'project', project_id: 'alpha' },
      [codexId],
      4,
    )
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('uses revision zero only when creating an absent project override', async () => {
    const withoutOverride = payload()
    withoutOverride.assignments = withoutOverride.assignments.filter(
      (assignment) => assignment.scope.kind !== 'project',
    )
    const resolution = withoutOverride.capabilities[0]
    if (resolution.state !== 'ready') throw new Error('expected ready fixture')
    resolution.assignment = withoutOverride.assignments[0]
    resolution.connections = [withoutOverride.connections[0]]
    resolution.source = 'installation'
    const wrapper = mount(ProjectAssignmentsSection, {
      props: { payload: withoutOverride, projectId: 'alpha' },
      global: { plugins: plugins() },
    })

    wrapper.getComponent(ChoiceSelect).vm.$emit('update:modelValue', claudeId)
    await flushPromises()

    expect(setPlatformAssignment).toHaveBeenCalledWith(
      'telemetry.query',
      { kind: 'project', project_id: 'alpha' },
      [claudeId],
      0,
    )
  })

  it('states a plain refusal for a reason it has no sentence for', () => {
    const unavailable = payload()
    unavailable.capabilities[0] = {
      ...unavailable.capabilities[0],
      connections: [],
      health: [],
      reason: 'reason-from-a-later-kernel',
      source: null,
      state: 'unavailable',
    }
    const wrapper = mount(ProjectAssignmentsSection, {
      props: { payload: unavailable, projectId: 'alpha' },
      global: { plugins: plugins() },
    })
    expect(wrapper.text()).not.toContain('reason-from-a-later-kernel')
    expect(wrapper.text()).toContain('Unavailable reasonUnavailable')
  })

  it('shows the effective source and unavailable reason without hiding reset', async () => {
    const unavailable = payload()
    unavailable.capabilities[0] = {
      ...unavailable.capabilities[0],
      assignment: unavailable.capabilities[0].assignment,
      connections: [],
      health: [],
      reason: 'connection-unhealthy',
      source: null,
      state: 'unavailable',
    }
    const wrapper = mount(ProjectAssignmentsSection, {
      props: { payload: unavailable, projectId: 'alpha' },
      global: { plugins: plugins() },
    })
    // The reason reads as a sentence. Asserting the identifier is what let
    // `connection-unhealthy` reach the screen in the shipped build.
    expect(wrapper.text()).toContain('Tool not healthy')
    expect(wrapper.text()).not.toContain('connection-unhealthy')
    expect(wrapper.text()).toContain('Effective source: Unavailable')

    const reset = wrapper.findAll('button').find((button) => button.text() === 'Reset to default')
    expect(reset).toBeDefined()
    await reset?.trigger('click')
    await flushPromises()
    expect(resetProjectAssignment).toHaveBeenCalledWith('telemetry.query', 'alpha', 4)
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('keeps long bounded diagnostics discoverable and hides project editing globally', () => {
    const diagnostic = 'journal probe returned no matching local entry '.repeat(8).trim()
    const wrapper = mount(PlatformSettingsRegistry, {
      props: {
        reloadModules: vi.fn(),
        scope: { kind: 'global' },
        state: {
          interface_version: 'valkama-ui-state',
          payload: payload(diagnostic),
          status: 'ready',
        },
      },
      global: { plugins: plugins() },
    })
    expect(wrapper.get('details summary').text()).toBe('Details')
    expect(wrapper.findAll('.registry-fact-value').some((fact) => fact.text() === diagnostic)).toBe(
      true,
    )
    expect(wrapper.find('.project-assignments').exists()).toBe(false)
  })

  it('omits empty integration groups and uses the shared empty state when nothing is registered', () => {
    const telemetryOnly = mount(PlatformSettingsRegistry, {
      props: {
        reloadModules: vi.fn(),
        scope: { kind: 'global' },
        state: {
          interface_version: 'valkama-ui-state',
          payload: payload(),
          status: 'ready',
        },
      },
      global: { plugins: plugins() },
    })
    expect(telemetryOnly.find('.integrations-telemetry').exists()).toBe(true)
    expect(telemetryOnly.find('.integrations-execution').exists()).toBe(false)
    expect(telemetryOnly.find('.integrations-skills').exists()).toBe(false)
    expect(telemetryOnly.find('.registry-section.modules').exists()).toBe(false)

    const empty = payload()
    empty.assignments = []
    empty.capabilities = []
    empty.connections = []
    const emptyRegistry = mount(PlatformSettingsRegistry, {
      props: {
        reloadModules: vi.fn(),
        scope: { kind: 'global' },
        state: {
          interface_version: 'valkama-ui-state',
          payload: empty,
          status: 'ready',
        },
      },
      global: { plugins: plugins() },
    })
    expect(emptyRegistry.find('.data-empty').exists()).toBe(true)
    expect(emptyRegistry.find('.registry-section').exists()).toBe(false)
  })
})
