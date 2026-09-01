import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SkillPreview from '@/pages/skills/components/SkillPreview.vue'
import SkillsView from '@/pages/skills/components/SkillsView.vue'

import { messages } from '@/shared/i18n/index.ts'
import type { SkillDetail, SkillEntry } from '@/shared/types/skills.ts'

import { projectId } from '../browser/planningFixtures.ts'
import { skillsPayload } from '../browser/skillsFixtures.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function answer(payload: unknown) {
  return { ok: true, json: async () => payload }
}

function detail(skill: SkillEntry, heading: string): SkillDetail {
  return {
    interface_version: 'skill-detail',
    key: skill.key,
    name: skill.name,
    location: skill.location,
    content_hash: 'd'.repeat(64),
    markdown: `# ${heading}`,
  }
}

function i18n() {
  return createI18n({ legacy: false, locale: 'en', messages })
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Skills keyed resources', () => {
  it('isolates a new project catalogue and rejects the older scope response', async () => {
    const first = deferred<ReturnType<typeof answer>>()
    const second = deferred<ReturnType<typeof answer>>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(SkillsView, {
      props: { project: 'global' },
      global: { plugins: [i18n()] },
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await wrapper.setProps({ project: projectId })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    second.resolve(answer(skillsPayload))
    await flushPromises()
    expect(wrapper.get('.skill-name').text()).toBe('project-review')

    first.resolve(
      answer({
        ...skillsPayload,
        skills: [skillsPayload.skills[0]],
        summary: { ...skillsPayload.summary, skills: 1 },
      }),
    )
    await flushPromises()
    expect(wrapper.get('.skill-name').text()).toBe('project-review')
  })

  it('renders a cold catalogue failure as retryable error rather than empty', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(SkillsView, { global: { plugins: [i18n()] } })
    await flushPromises()

    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(true)
    expect(wrapper.find('.data-empty-state').exists()).toBe(false)
    expect(wrapper.get('.platform-state-retry').text()).toBe('Retry')
    await wrapper.get('.platform-state-retry').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shows only the newest selected skill detail', async () => {
    const firstSkill = skillsPayload.skills[0] as unknown as SkillEntry
    const secondSkill = skillsPayload.skills[1] as unknown as SkillEntry
    const first = deferred<ReturnType<typeof answer>>()
    const second = deferred<ReturnType<typeof answer>>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(SkillPreview, {
      props: { skill: firstSkill },
      global: { plugins: [i18n()] },
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await wrapper.setProps({ skill: secondSkill })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    second.resolve(answer(detail(secondSkill, 'Newest detail')))
    await vi.waitFor(() => expect(wrapper.get('.skill-markdown h1').text()).toBe('Newest detail'))

    first.resolve(answer(detail(firstSkill, 'Stale detail')))
    await flushPromises()
    expect(wrapper.get('.skill-markdown h1').text()).toBe('Newest detail')
  })

  it('keeps a selected detail visible when its same-key refresh fails', async () => {
    const skill = skillsPayload.skills[0] as unknown as SkillEntry
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer(detail(skill, 'Retained detail')))
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(SkillPreview, {
      props: { skill },
      global: { plugins: [i18n()] },
    })
    await vi.waitFor(() => expect(wrapper.get('.skill-markdown h1').text()).toBe('Retained detail'))

    await wrapper.get('.skill-location-button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.skill-markdown h1').text()).toBe('Retained detail')
    expect(wrapper.get('.preview-error').text()).toContain('SKILL.md could not be loaded.')
  })
})
