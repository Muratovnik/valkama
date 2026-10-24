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

const codexId = 'openai:codex-rollout:codex-rollout-telemetry:local'
const claudeId = 'anthropic:claude-journal:claude-journal-telemetry:local'

function connection(
  owner: string,
  serviceId: string,
  lineage: string,
  diagnostics?: string,
): RegistryConnection {
  const scope = { kind: 'global' as const }
  const titleKeys: Record<string, string> = {
    'codex-rollout': 'platform.integrations.codexRollout',
    'claude-journal': 'platform.integrations.claudeJournal',
  }
  const titleKey = titleKeys[serviceId] ?? `integrations.${serviceId}`
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
    name: titleKey,
    observed_at: '2026-08-21T08:00:00Z',
    scope,
    service: {
      owner_id: owner,
      service_id: serviceId,
      service_type: 'local-journal',
      title_key: titleKey,
    },
    state: 'registered',
    transport: 'local-file',
    trust: 'trusted',
    trust_owner: 'platform',
    ...(diagnostics ? { diagnostics: { code: 'probe-detail', message: diagnostics } } : {}),
  }
}

function payload(diagnostics?: string): PlatformRegistryReady {
  const codex = connection('openai', 'codex-rollout', 'codex-rollout-telemetry', diagnostics)
  const claude = connection('anthropic', 'claude-journal', 'claude-journal-telemetry')
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

function plugins(locale = 'en') {
  return [createI18n({ legacy: false, locale, messages })]
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
    expect(wrapper.get('.registry-name').text()).toBe('Read usage and activity')
    expect(wrapper.get('.registry-sub').text()).toBe(
      'Selected for this project · Claude local journal',
    )
    expect(
      wrapper
        .findAll('.registry-fact')
        .find((fact) => fact.text().startsWith('Selected connection'))
        ?.text(),
    ).toBe('Selected connectionClaude local journal')
    const select = wrapper.getComponent(ChoiceSelect)
    expect(select.get('[role="combobox"]').attributes('aria-label')).toBe('Read usage and activity')

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

    expect(wrapper.get('.registry-sub').text()).toBe(
      'Inherited from installation · Codex rollout telemetry',
    )
    expect(
      wrapper
        .findAll('.registry-fact')
        .find((fact) => fact.text().startsWith('Selected connection'))
        ?.text(),
    ).toBe('Selected connectionCodex rollout telemetry')
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
    expect(wrapper.text()).toContain('Tool not healthy')
    expect(wrapper.text()).not.toContain('connection-unhealthy')
    expect(wrapper.text()).toContain('No effective connection')
    expect(wrapper.get('.registry-sub').text()).toContain('Claude local journal')

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
    expect(telemetryOnly.find('.integrations-execution').exists()).toBe(false)
    const telemetry = telemetryOnly.get('.integrations-telemetry')
    expect(telemetry.findAll('.registry-row')).toHaveLength(2)
    expect(telemetry.findAll('.registry-name').map((name) => name.text())).toEqual([
      'Codex rollout telemetry',
      'Claude local journal',
    ])
    expect(telemetry.text()).toContain('Read-only local usage and session sources.')
    expect(telemetry.findAll('.registry-owner-value').map((owner) => owner.text())).toEqual([
      'openai',
      'anthropic',
    ])
    expect(telemetry.findAll('.registry-description')).toHaveLength(2)
    expect(telemetryOnly.find('.integrations-skills').exists()).toBe(false)
    expect(telemetryOnly.find('.registry-section.modules').exists()).toBe(false)

    const empty = payload()
    Object.assign(empty, { assignments: [], capabilities: [], connections: [] })
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
  it.each(
    (
      [
        ['en', 'global', 'local-file', 'Select a project', 'provider named above'],
        ['en', 'global', 'built-in', 'Select a project', 'with its owner'],
        ['en', 'project', 'local-file', 'Project assignments below', 'provider named above'],
        ['en', 'project', 'built-in', 'Project assignments below', 'with its owner'],
        ['ru', 'global', 'local-file', 'Выберите проект', 'указанному провайдеру'],
        ['ru', 'global', 'built-in', 'Выберите проект', 'у его владельца'],
        ['ru', 'project', 'local-file', '«Назначения проекта»', 'указанному провайдеру'],
        ['ru', 'project', 'built-in', '«Назначения проекта»', 'у его владельца'],
      ] as const
    ).map((scenario) => ({ scenario })),
  )(
    'gives $scenario setup guidance',
    ({ scenario: [locale, kind, transport, instruction, owner] }) => {
      const data = payload()
      for (const item of data.connections) item.transport = transport
      const scope =
        kind === 'global'
          ? { kind: 'global' as const }
          : { kind: 'project' as const, project_ref: { project_id: 'alpha' } }
      const wrapper = mount(PlatformSettingsRegistry, {
        props: {
          reloadModules: vi.fn(),
          scope,
          state: { interface_version: 'valkama-ui-state', payload: data, status: 'ready' },
        },
        global: { plugins: plugins(locale) },
      })
      const guidance = wrapper.get('.registry-description').text()
      expect(guidance).toContain(instruction)
      expect(guidance).toContain(owner)
      expect(wrapper.find('.project-assignments').exists()).toBe(kind === 'project')
      if (kind === 'global') expect(guidance).not.toContain(locale === 'en' ? 'below' : 'ниже')
    },
  )
  it('names inherited memory before disclosure and after overriding and resetting', async () => {
    const data = payload()
    data.connections = [
      connection('agentmemory', 'local-reference-service', 'agentmemory-reference-v1'),
      connection('demo', 'notes', 'notes-reference-v1'),
    ]
    for (const item of data.connections) item.capabilities = ['memory.open']
    const memoryId = 'agentmemory:local-reference-service:agentmemory-reference-v1:local'
    const demoId = 'demo:notes:notes-reference-v1:local'
    data.assignments = [
      { ...data.assignments[0], capability_id: 'memory.open', connection_ids: [memoryId] },
    ]
    const resolution = data.capabilities[0]
    if (resolution.state !== 'ready') throw new Error('expected ready fixture')
    resolution.capability.capability_id = 'memory.open'
    resolution.assignment = data.assignments[0]
    resolution.source = 'installation'
    resolution.connections = [data.connections[0]]
    const wrapper = mount(ProjectAssignmentsSection, {
      props: { payload: data, projectId: 'alpha' },
      global: { plugins: plugins() },
    })
    expect(wrapper.get('.registry-sub').text()).toBe('Inherited from installation · AgentMemory')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    wrapper.getComponent(ChoiceSelect).vm.$emit('update:modelValue', demoId)
    await flushPromises()
    expect(setPlatformAssignment).toHaveBeenCalledWith(
      'memory.open',
      { kind: 'project', project_id: 'alpha' },
      [demoId],
      0,
    )
    const overridden = structuredClone(data)
    const override = {
      ...data.assignments[0],
      assignment_id: 'project-memory',
      scope: { kind: 'project' as const, project_id: 'alpha' },
      connection_ids: [demoId],
      revision: 2,
    }
    overridden.assignments.push(override)
    const effective = overridden.capabilities[0]
    if (effective.state !== 'ready') throw new Error('expected ready fixture')
    effective.source = 'project'
    effective.assignment = override
    effective.connections = [overridden.connections[1]]
    await wrapper.setProps({ payload: overridden })
    expect(wrapper.get('.registry-sub').text()).toBe('Selected for this project · Demo note links')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Reset to default')
      ?.trigger('click')
    await flushPromises()
    expect(resetProjectAssignment).toHaveBeenCalledWith('memory.open', 'alpha', 2)
    await wrapper.setProps({ payload: data })
    expect(wrapper.get('.registry-sub').text()).toBe('Inherited from installation · AgentMemory')
    expect(wrapper.getComponent(ChoiceSelect).props('modelValue')).toBe('')
  })
})
