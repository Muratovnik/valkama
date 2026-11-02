/**
 * The branch map as a reader uses it: what it says in words, the task under
 * the pointer, a click that opens it, a lane label that narrows the list, and
 * a keyboard cursor that walks a lane and says where it is.
 *
 * The test DOM never measures, so the map lays itself out at its fallback width
 * of 342px. The small chain is 24 units long there, 14.25px each; its first
 * lane starts at x 0, so the n-th task's middle is (n + 0.5) × 14.25.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChainBranchMap from '@/widgets/work-item-inspector/components/ChainBranchMap.vue'
import { groupLabels, groupMembers } from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import {
  branchedChain,
  chainOf,
  mapId,
  mapMember,
  smallBranchedChain,
} from '../fixtures/chainMap.ts'

const ROOT = { id: mapId(1), reference: 'MAP-1', title: 'Root' }
const UNIT = 342 / 24

const i18n = createI18n({ legacy: false, locale: 'en', messages })

/** The words the card's section gives each group of this chain, as it hands them to the map. */
function sectionLabels(chain: WorkItemChain) {
  return groupLabels(groupMembers(chain.members), (group) =>
    i18n.global.t(`workItem.chain.group.${group}`),
  )
}

function mountMap(chain: unknown = smallBranchedChain(ROOT, 'MAP'), filter: string | null = null) {
  const shown = chain as WorkItemChain
  return mount(ChainBranchMap, {
    props: { chain: shown, filter, labels: sectionLabels(shown) },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

const lanes = (wrapper: VueWrapper) => wrapper.findAll('[role="slider"]')
const at = (index: number) => ({ clientX: (index + 0.5) * UNIT })

describe('the branch map', () => {
  it('says in words what its colours draw, in the words the totals and the member list use', () => {
    const wrapper = mountMap()
    // Each group in one state is named by that state, as the board's column
    // names it, and so is every count: the key once said «In progress» over a
    // list headed «Development».
    expect(wrapper.get('figcaption').text()).toBe(
      'Branch map: 2 lanes, 40 items; Done 18, Code review 1, Development 4, Blocked 1, Todo 3, Backlog 13.',
    )
    // The key is where the section says what stands where, so each word has its figure.
    expect(
      wrapper
        .findAll('.branch-key-entry')
        .map(
          (entry) => `${entry.get('.state-label').text()} ${entry.get('.branch-key-count').text()}`,
        ),
    ).toEqual(['Done 18', 'Code review 1', 'Development 4', 'Blocked 1', 'Todo 3', 'Backlog 13'])
    expect(wrapper.findAll('.branch-map-label').map((label) => label.text())).toEqual([
      'MAP-1',
      'no epic',
    ])
    // A lane's line says how much of it is done; its colours say the rest.
    expect(wrapper.findAll('.branch-map-count').map((count) => count.text())).toEqual([
      '12 of 20 done',
      '6 of 20 done',
    ])
    expect(lanes(wrapper).map((lane) => lane.attributes('aria-label'))).toEqual([
      'Lane MAP-1 Root: 20 items; Done 12, Code review 1, Development 2, Backlog 5',
      'Lane no epic: 20 items; Done 6, Development 2, Blocked 1, Todo 3, Backlog 8',
    ])
    wrapper.unmount()
  })

  it('names a group that spans several states by the group’s own word', () => {
    const chain = chainOf(ROOT, [
      mapMember('MAP-10', 'active', 'MAP-1', { holder: 'codex' }),
      mapMember('MAP-11', 'active', 'MAP-1'),
      mapMember('MAP-12', 'backlog', 'MAP-1'),
    ])
    const [first] = chain.members
    Object.assign(first.state, { key: 'pairing', name: 'Pairing' })
    const wrapper = mountMap(chain)
    expect(wrapper.findAll('.branch-key .state-label').map((label) => label.text())).toEqual([
      'In progress',
      'Backlog',
    ])
    wrapper.unmount()
  })

  it('keys only the states it draws, as the graph’s legend does', () => {
    // Done, in progress and backlog work: nothing in review, nothing blocked.
    const plain = chainOf(ROOT, [
      mapMember('MAP-10', 'done', 'MAP-1'),
      mapMember('MAP-11', 'active', 'MAP-1', { holder: 'codex' }),
      mapMember('MAP-12', 'backlog', 'MAP-1'),
    ])
    const wrapper = mountMap(plain)
    const legend = wrapper.get('.branch-key')
    expect(legend.findAll('.state-label').map((label) => label.text())).toEqual([
      'Done',
      'Development',
      'Backlog',
    ])
    // No key speaks for a state no member is in, the emphatic one least of all.
    expect(legend.find('[data-emphasis="strong"]').exists()).toBe(false)
    wrapper.unmount()

    // Queued work alone is keyed as queued work, though it shares the backlog's grey.
    const queued = mountMap(chainOf(ROOT, [mapMember('MAP-10', 'queued', 'MAP-1')]))
    expect(queued.findAll('.branch-key .state-label').map((label) => label.text())).toEqual([
      'Todo',
    ])
    queued.unmount()
  })

  it('names the task under the pointer and marks it, and forgets it when the pointer leaves', async () => {
    const wrapper = mountMap()
    const [trunk] = lanes(wrapper)
    expect(wrapper.find('.branch-tip').exists()).toBe(false)
    // The 14th task of the root's lane: MAP-1014, in development, held by codex.
    await trunk.trigger('pointermove', at(13))
    const tip = wrapper.get('.branch-tip')
    expect(tip.text()).toContain('MAP-1014')
    expect(tip.text()).toContain('Chain step 1014')
    expect(tip.text()).toContain('Development')
    expect(tip.text()).toContain('codex · 14 of 20')
    expect(wrapper.get('.branch-map-mark').attributes('data-tone')).toBe('info')
    await trunk.trigger('pointermove', at(2))
    expect(wrapper.get('.branch-tip').text()).toContain('MAP-1003')
    expect(wrapper.get('.branch-map-mark').attributes('data-tone')).toBe('success')
    await trunk.trigger('pointerleave')
    expect(wrapper.find('.branch-tip').exists()).toBe(false)
    expect(wrapper.find('.branch-map-mark').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens the task a click lands on, through the same event as the member list', async () => {
    const wrapper = mountMap()
    await lanes(wrapper)[0].trigger('click', at(12))
    // The no-epic lane starts four units in, after the task it was discovered from.
    await lanes(wrapper)[1].trigger('click', at(4 + 8))
    expect(wrapper.emitted('open')).toEqual([['MAP-1013'], ['MAP-1109']])
    wrapper.unmount()
  })

  it('asks for its lane when a lane label is chosen, and marks the lane the list is narrowed to', async () => {
    const wrapper = mountMap()
    const [own, loose] = wrapper.findAll('.branch-map-label')
    expect(own.attributes('aria-label')).toBe('Show only lane MAP-1')
    await own.trigger('click')
    await loose.trigger('click')
    expect(wrapper.emitted('lane')).toEqual([['MAP-1'], ['']])
    // Nothing steps back while every lane is listed.
    expect(wrapper.findAll('.receded')).toHaveLength(0)
    await wrapper.setProps({ filter: '' })
    expect(loose.attributes('aria-current')).toBe('true')
    expect(loose.classes()).toContain('selected')
    expect(own.attributes('aria-current')).toBeUndefined()
    // The map itself marks the lane: every other lane — its line, its label
    // line and its references — steps back, and the chosen one does not.
    const [ownHead, looseHead] = wrapper.findAll('.branch-map-head')
    expect(ownHead.classes()).toContain('receded')
    expect(looseHead.classes()).not.toContain('receded')
    const groups = wrapper.findAll('svg g')
    expect(groups.map((group) => group.classes().includes('receded'))).toEqual([true, false])
    // At 342px each lane names one task under way and counts the other two.
    expect(
      wrapper
        .findAll('.branch-map-reference')
        .map((reference) => [reference.text(), reference.classes().includes('receded')]),
    ).toEqual([
      ['MAP-1013', true],
      ['+2', true],
      ['MAP-1107', false],
      ['+2', false],
    ])
    wrapper.unmount()
  })

  it('walks a lane with the keyboard, says where the cursor is, and opens it on Enter', async () => {
    const wrapper = mountMap()
    const trunk = lanes(wrapper)[0]
    const said = () => wrapper.get('[aria-live="polite"]').text()
    expect(trunk.attributes('tabindex')).toBe('0')
    expect(trunk.attributes('aria-valuemin')).toBe('1')
    expect(trunk.attributes('aria-valuemax')).toBe('20')

    // The cursor starts where open work does: the review after twelve closed tasks.
    await trunk.trigger('focus')
    expect(said()).toBe('MAP-1013 · Chain step 1013 · Code review · claude')
    expect(trunk.attributes('aria-valuenow')).toBe('13')
    expect(trunk.attributes('aria-valuetext')).toBe('13 of 20')
    expect(wrapper.get('.branch-tip').text()).toContain('MAP-1013')

    await trunk.trigger('keydown', { key: 'ArrowRight' })
    expect(said()).toBe('MAP-1014 · Chain step 1014 · Development · codex')
    expect(trunk.attributes('aria-valuenow')).toBe('14')
    await trunk.trigger('keydown', { key: 'End' })
    expect(said()).toBe('MAP-1020 · Chain step 1020 · Backlog')
    await trunk.trigger('keydown', { key: 'ArrowRight' })
    expect(trunk.attributes('aria-valuenow')).toBe('20')
    await trunk.trigger('keydown', { key: 'Home' })
    expect(said()).toBe('MAP-1001 · Chain step 1001 · Done')
    await trunk.trigger('keydown', { key: 'ArrowLeft' })
    expect(trunk.attributes('aria-valuenow')).toBe('1')
    // Page Down jumps to where the next state begins: closed → review → development.
    await trunk.trigger('keydown', { key: 'PageDown' })
    expect(trunk.attributes('aria-valuenow')).toBe('13')
    await trunk.trigger('keydown', { key: 'PageDown' })
    expect(trunk.attributes('aria-valuenow')).toBe('14')
    await trunk.trigger('keydown', { key: 'PageUp' })
    expect(trunk.attributes('aria-valuenow')).toBe('13')

    await trunk.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('open')).toEqual([['MAP-1013']])
    // Each lane keeps its own cursor.
    const loose = lanes(wrapper)[1]
    await loose.trigger('focus')
    expect(said()).toBe('MAP-1107 · Chain step 1107 · Development · codex')
    wrapper.unmount()
  })

  it('draws six hundred members as a handful of paths, not an element each', () => {
    const wrapper = mountMap(branchedChain(ROOT, 'MAP'))
    expect(lanes(wrapper)).toHaveLength(6)
    expect(wrapper.findAll('svg path').length).toBeLessThan(40)
    expect(wrapper.findAll('.branch-map-reference')).toHaveLength(0)
    // Work under way stands out of a dense lane as raised marks.
    expect(wrapper.findAll('.branch-map-run.raised').length).toBeGreaterThan(0)
    wrapper.unmount()
  })
})
