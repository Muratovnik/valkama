import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SkillsView from '@/pages/skills/components/SkillsView.vue'

import { messages } from '@/shared/i18n/index'

import { present } from '../support/present.ts'
import { withSecurityBootstrap } from '../support/request.ts'

const payload = {
  interface_version: 'skills',
  as_of: '2026-08-11T00:00:00Z',
  clients: [
    { id: 'codex' },
    { id: 'claude' },
    { id: 'cursor' },
    { id: 'xcode' },
    { id: 'windsurf' },
  ],
  registry: {
    status: 'available',
    source: 'host_runtime',
    project_count: 1,
    total_project_count: 1,
    truncated: false,
    reason: null,
  },
  roots: [
    {
      id: 'global-agent-skills',
      scope: 'global',
      source: 'user-canonical',
      project_id: null,
      project_title: null,
      relative_root: '.agents/skills',
      availability: 'available',
      validation: 'valid',
      skill_count: 1,
      reason: null,
      manifest_source_hash: null,
      truncated: false,
    },
  ],
  projects: [
    { id: 'sample', project_title: 'Sample Board', skill_count: 0, root_status: 'missing' },
  ],
  skills: [
    {
      key: 'global:review',
      directory_name: 'review',
      name: 'review',
      description: 'Review bounded work.',
      scope: 'global',
      source: 'user-canonical',
      project_id: null,
      project_title: null,
      owner_project_id: null,
      owner_project_title: null,
      root_id: 'global-agent-skills',
      skill_ref: {
        provider_id: 'filesystem-catalogue',
        root_id: 'global-agent-skills',
        skill_id: 'review',
        content_hash: null,
      },
      location: '.agents/skills/review/SKILL.md',
      availability: 'available',
      duplicate: false,
      clients: {
        codex: { enabled: true, can_toggle: true, status: 'enabled', reason: null },
        claude: { enabled: false, can_toggle: true, status: 'disabled', reason: null },
        cursor: {
          enabled: null,
          can_toggle: false,
          status: 'unavailable',
          reason: 'client_not_supported',
        },
        xcode: {
          enabled: null,
          can_toggle: false,
          status: 'unavailable',
          reason: 'client_not_supported',
        },
        windsurf: {
          enabled: null,
          can_toggle: false,
          status: 'unavailable',
          reason: 'client_not_supported',
        },
      },
      validation: {
        schema: 'agentskills-v1',
        status: 'valid',
        checks: ['frontmatter'],
        code: null,
      },
      capabilities: {
        scripts: false,
        references: false,
        assets: false,
        script_entries: 0,
        reference_entries: 0,
        asset_entries: 0,
        script_entries_truncated: false,
        reference_entries_truncated: false,
        asset_entries_truncated: false,
      },
      metadata: { version: '1.0', license: 'MIT', compatibility: null },
      provenance: {
        source: 'filesystem',
        observed_at: '2026-08-11T00:00:00Z',
        content_hash: 'a'.repeat(64),
        duplicate_of: null,
      },
    },
  ],
  summary: { roots: 1, projects: 1, skills: 1, valid: 1, invalid: 0, partial: 0, duplicates: 0 },
}

const detail = {
  interface_version: 'skill-detail',
  key: 'global:review',
  name: 'review',
  location: '.agents/skills/review/SKILL.md',
  content_hash: 'a'.repeat(64),
  markdown: '# Review workflow\n\nUse the checklist.\n\n<script>alert(1)</script>',
}

const matrix = {
  interface_version: 'skills',
  as_of: '2026-08-11T00:00:00Z',
  clients: [
    { id: 'codex', project_scope: false },
    { id: 'claude', project_scope: true },
  ],
  projects: [{ project_id: 'sample', project_title: 'Sample Board' }],
  skills: [],
  truncated: false,
}

function skillsFetch(inventory = payload, selectedDetail = detail) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/modules/skills/matrix')) {
      return { ok: true, json: async () => matrix }
    }
    if (url.startsWith('/api/modules/skills/detail')) {
      return { ok: true, json: async () => selectedDetail }
    }
    if (init?.method === 'POST') return { ok: true, json: async () => inventory }
    return { ok: true, json: async () => inventory }
  })
}

function skillDrawer() {
  return present(document.body.querySelector<HTMLElement>('.skill-drawer'), 'the skill drawer')
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('SkillsView', () => {
  it('opens one bounded Markdown preview in the shared overlay drawer', async () => {
    const fetch = skillsFetch()
    vi.stubGlobal('fetch', fetch)
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const wrapper = mount(SkillsView, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.find('.skills-filters').exists()).toBe(true)
    expect(wrapper.find('.skill-table').exists()).toBe(true)
    expect(wrapper.find('.skill-detail').exists()).toBe(false)
    // The default inventory does not pay for the much denser applicability
    // projection until the operator asks for that second view.
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.skill-matrix').exists()).toBe(false)

    await wrapper.findAll('.segmented-option')[1].trigger('click')
    expect(wrapper.emitted('state')?.at(-1)).toEqual([{ view: 'matrix' }])
    await wrapper.setProps({ view: 'matrix' })
    await flushPromises()
    expect(wrapper.find('.skill-matrix').exists()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    await wrapper.findAll('.segmented-option')[0].trigger('click')
    expect(wrapper.emitted('state')?.at(-1)).toEqual([{}])
    await wrapper.setProps({ view: 'catalog' })

    await wrapper.get('.skill-row').trigger('click')
    await wrapper.setProps({ skill: 'global:review' })
    await flushPromises()
    await vi.waitFor(() =>
      expect(document.body.querySelector('.skill-markdown h1')?.textContent).toBe(
        'Review workflow',
      ),
    )

    expect(document.body.querySelector('.overlay-host.overlay-drawer')).not.toBeNull()
    const drawer = skillDrawer()
    expect(wrapper.find('.resizable-inspector').exists()).toBe(false)
    expect(drawer.querySelector('.skill-detail')).not.toBeNull()
    expect(drawer.querySelector('.skill-markdown')?.textContent).toContain('Use the checklist.')
    expect(drawer.querySelector('.skill-markdown script')).toBeNull()
    expect(drawer.querySelector('.skill-location-button')?.textContent).toContain(
      '.agents/skills/review/SKILL.md',
    )
    expect(
      Array.from(drawer.querySelectorAll('.client-activation-list, .skill-location-button')).map(
        (node) => (node.classList.contains('client-activation-list') ? 'activation' : 'preview'),
      ),
    ).toEqual(['activation', 'preview'])
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(3)
    expect(wrapper.get('.skill-table-head').text()).not.toContain('Codex')
    expect(wrapper.get('.skill-table-head').text()).not.toContain('Claude Code')
    expect(drawer.querySelectorAll('[role="switch"]')).toHaveLength(2)
    expect(drawer.querySelectorAll('[data-dimension="skill-readiness"]')).toHaveLength(4)
    expect(drawer.querySelector('.client-activation-list')?.textContent).toContain('Cursor')
    expect(drawer.querySelector('.client-activation-list')?.textContent).toContain('Xcode')
    expect(drawer.querySelector('.client-activation-list')?.textContent).toContain('Windsurf')
    expect(wrapper.get('.skill-results').attributes('data-scalable-list')).toBe('true')
  })

  it('updates one client and keeps the selected detail visible', async () => {
    const updated = {
      ...payload,
      skills: [
        {
          ...payload.skills[0],
          clients: {
            ...payload.skills[0].clients,
            claude: { ...payload.skills[0].clients.claude, enabled: true, status: 'enabled' },
          },
        },
      ],
    }
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/modules/skills/detail'))
        return { ok: true, json: async () => detail }
      return { ok: true, json: async () => (init?.method === 'POST' ? updated : payload) }
    })
    vi.stubGlobal('fetch', withSecurityBootstrap(fetch as unknown as typeof globalThis.fetch))
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const wrapper = mount(SkillsView, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.get('.skill-row').trigger('click')
    await wrapper.setProps({ skill: 'global:review' })
    await flushPromises()
    skillDrawer().querySelectorAll<HTMLElement>('[role="switch"]')[1].click()
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/modules/skills/activation',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(skillDrawer().textContent).toContain('review')
  })

  it('shows the cause of an invalid skill in both the inventory and detail', async () => {
    const invalid = {
      ...payload,
      skills: [
        {
          ...payload.skills[0],
          validation: {
            schema: 'agentskills-v1',
            status: 'invalid',
            checks: ['skill_file'],
            code: 'frontmatter_missing',
          },
          clients: Object.fromEntries(
            payload.clients.map(({ id }) => [
              id,
              {
                enabled: null,
                can_toggle: false,
                status: 'unavailable',
                reason: 'skill_invalid',
              },
            ]),
          ),
        },
      ],
    }
    vi.stubGlobal('fetch', skillsFetch(invalid))
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const wrapper = mount(SkillsView, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.get('.skill-row').text()).toContain('Frontmatter is missing')
    await wrapper.get('.skill-row').trigger('click')
    await wrapper.setProps({ skill: 'global:review' })
    await flushPromises()
    expect(skillDrawer().textContent).toContain('Frontmatter is missing')
    expect(skillDrawer().textContent).not.toContain('Why this needs attention')
  })

  it('keeps query, status, view, and skill route state together across disclosures', async () => {
    vi.stubGlobal('fetch', skillsFetch())
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const wrapper = mount(SkillsView, {
      props: { status: 'enabled' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    await wrapper.get('input[type="search"]').setValue('review')
    expect(wrapper.emitted('state')?.at(-1)).toEqual([{ query: 'review', status: 'enabled' }])
    await wrapper.setProps({ query: 'review' })
    await wrapper.findAll('.segmented-option')[1].trigger('click')
    expect(wrapper.emitted('state')?.at(-1)).toEqual([
      { query: 'review', status: 'enabled', view: 'matrix' },
    ])
    await wrapper.setProps({ view: 'matrix' })
    await wrapper.findAll('.segmented-option')[0].trigger('click')
    await wrapper.setProps({ view: 'catalog' })
    await wrapper.get('.skill-row').trigger('click')
    expect(wrapper.emitted('route')?.at(-1)).toEqual([
      { skill: { key: 'global:review', scope: 'global' } },
    ])
  })

  it('surfaces typed inventory issues, validation checks, capability indicators, and source search', async () => {
    const partial = {
      ...payload,
      registry: {
        ...payload.registry,
        total_project_count: 2,
        truncated: true,
        reason: 'project_limit_reached',
      },
      roots: [
        {
          ...payload.roots[0],
          availability: 'partial',
          validation: 'partial',
          truncated: true,
          reason: 'skill_limit_reached',
        },
      ],
      skills: [
        {
          ...payload.skills[0],
          validation: {
            ...payload.skills[0].validation,
            checks: ['skill_file', 'frontmatter', 'name'],
          },
          capabilities: { ...payload.skills[0].capabilities, scripts: true, script_entries: 2 },
        },
      ],
    }
    vi.stubGlobal('fetch', skillsFetch(partial))
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const wrapper = mount(SkillsView, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.get('.inventory-notices').text()).toContain('Project limit reached')
    expect(wrapper.get('.inventory-notices').text()).toContain('Skill limit reached')
    await wrapper.get('.skill-row').trigger('click')
    await wrapper.setProps({ skill: 'global:review' })
    await flushPromises()
    expect(skillDrawer().querySelector('.validation-checks')?.textContent).toContain('frontmatter')
    expect(skillDrawer().querySelector('.capability-list')?.textContent).toContain('Scripts')
    await wrapper.get('input[type="search"]').setValue('user-canonical')
    await wrapper.setProps({ query: 'user-canonical' })
    expect(wrapper.findAll('.skill-row')).toHaveLength(1)
  })

  it('explains a missing Claude projection and lets the user create it by enabling the skill', async () => {
    const missingProjection = {
      ...payload,
      skills: [
        {
          ...payload.skills[0],
          clients: {
            ...payload.skills[0].clients,
            claude: {
              enabled: false,
              can_toggle: true,
              status: 'disabled',
              reason: 'claude_skill_projection_missing',
            },
          },
        },
      ],
    }
    vi.stubGlobal('fetch', skillsFetch(missingProjection))
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const wrapper = mount(SkillsView, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.get('.skill-row').trigger('click')
    await wrapper.setProps({ skill: 'global:review' })
    await flushPromises()

    expect(skillDrawer().querySelector('.client-activation-list')?.textContent).toContain(
      'Turn it on to add the link',
    )
    expect(
      skillDrawer().querySelectorAll('[role="switch"]')[1].getAttribute('aria-disabled'),
    ).not.toBe('true')
  })

  it('keeps the last valid snapshot visible when refresh fails and offers retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => payload })
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetch)
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const wrapper = mount(SkillsView, { global: { plugins: [i18n] } })
    await flushPromises()
    // The toolbar's own button. It had a class here because the screen was
    // restyling `VButton` locally, down to a height of its own; the primitive
    // owns the button now, so the toolbar is what identifies this one.
    await wrapper.get('.refresh-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.skills-workspace').exists()).toBe(true)
    expect(wrapper.get('.platform-state-banner').attributes('role')).toBe('status')
    expect(wrapper.get('.platform-state-banner').text()).toContain(
      'Valkama could not read the project registry or a skill folder.',
    )
    expect(wrapper.get('.refresh-button').text()).toContain('Refresh')
  })
})
