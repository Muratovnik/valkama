import { defineComponent, h, nextTick, Teleport } from 'vue'
import type { Component, VNode } from 'vue'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
/**
 * Where Reka puts the class written on a part, and whether this component's scope goes with it:
 * what `scripts/ui-system/floating-parts.mjs` relies on to refuse a scoped rule.
 *
 * A floating part's class lands inside the positioning wrapper while the scope attribute stays on
 * the wrapper, so a scoped rule for that class matches nothing. A Teleport, an item part, inline
 * combobox content and a dialog keep the class and the scope on one element, so the rule leaves
 * them alone. A Reka update that changes either side fails here, before the rule refuses a
 * working rule or passes a dead one.
 */
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxPortal,
  ComboboxRoot,
  DialogContent,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  SelectContent,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'
import { afterEach, expect, it } from 'vitest'

import { FLOATING_PARTS } from '../../scripts/ui-system/floating-parts.mjs'

const SCOPE = 'data-v-floating'

/** The part under test, with the class and, inside it, an element this template writes. */
const part = (Part: Component, props: Record<string, unknown> = {}, inner?: () => VNode[]) =>
  h(Part, { class: 'probe', ...props }, { default: inner ?? (() => [h('i', { class: 'inside' })]) })

const open = (Root: Component, Trigger: Component, Portal: Component, content: () => VNode) => () =>
  h(
    Root,
    { open: true, modal: false },
    {
      default: () => [
        h(Trigger, null, { default: () => 't' }),
        h(Portal, null, { default: content }),
      ],
    },
  )

const combobox = (props: Record<string, unknown>) => () =>
  h(
    ComboboxRoot,
    { open: true },
    {
      default: () => [
        h(ComboboxAnchor, null, { default: () => h(ComboboxInput) }),
        h(ComboboxPortal, null, { default: () => part(ComboboxContent, props) }),
      ],
    },
  )

const floating: [string, () => VNode][] = [
  [
    'DropdownMenuContent',
    open(DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, () =>
      part(DropdownMenuContent),
    ),
  ],
  [
    'HoverCardContent',
    open(HoverCardRoot, HoverCardTrigger, HoverCardPortal, () => part(HoverCardContent)),
  ],
  ['PopoverContent', open(PopoverRoot, PopoverTrigger, PopoverPortal, () => part(PopoverContent))],
  [
    'TooltipContent',
    () =>
      h(TooltipProvider, null, {
        default: open(TooltipRoot, TooltipTrigger, TooltipPortal, () => part(TooltipContent)),
      }),
  ],
  [
    'SelectContent',
    open(SelectRoot, SelectTrigger, SelectPortal, () =>
      part(SelectContent, { position: 'popper' }),
    ),
  ],
  ['SelectContent', open(SelectRoot, SelectTrigger, SelectPortal, () => part(SelectContent))],
  ['ComboboxContent', combobox({ position: 'popper' })],
]

const keeping: [string, () => VNode][] = [
  ['ComboboxContent inline', combobox({})],
  [
    'DropdownMenuItem',
    open(DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, () =>
      h(DropdownMenuContent, null, {
        default: () => [part(DropdownMenuItem, {}, () => [h('i', { class: 'inside' })])],
      }),
    ),
  ],
  [
    'DialogContent',
    () =>
      h(
        DialogRoot,
        { open: true, modal: false },
        {
          default: () =>
            h(DialogPortal, null, {
              default: () => [part(DialogContent), h(DialogTitle, null, { default: () => 't' })],
            }),
        },
      ),
  ],
  [
    'Teleport',
    () =>
      h(Teleport, { to: 'body' }, [h('div', { class: 'probe' }, [h('i', { class: 'inside' })])]),
  ],
]

/** The class's element and the one this template wrote inside it, once the part is open. */
async function rendered(render: () => VNode) {
  const host = defineComponent({ __scopeId: SCOPE, render } as Parameters<
    typeof defineComponent
  >[0])
  mounted.push(mount(host, { attachTo: document.body }))
  for (let tick = 0; tick < 4; tick += 1) await nextTick()
  return {
    inside: document.body.querySelector('.inside'),
    probe: document.body.querySelector('.probe'),
  }
}

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

it.each(floating)(
  '%s puts the class past the scope, on an element inside its wrapper',
  async (name, render) => {
    expect(FLOATING_PARTS.has(name)).toBe(true)
    const { inside, probe } = await rendered(render)
    expect(probe?.hasAttribute(SCOPE)).toBe(false)
    expect(probe?.parentElement?.hasAttribute(SCOPE)).toBe(true)
    // What the template writes inside the part is stamped, so its scoped rules land.
    expect(inside?.hasAttribute(SCOPE)).toBe(true)
  },
)

it.each(keeping)('%s keeps the class and the scope on one element', async (_name, render) => {
  const { inside, probe } = await rendered(render)
  expect(probe?.hasAttribute(SCOPE)).toBe(true)
  expect(inside?.hasAttribute(SCOPE)).toBe(true)
})
