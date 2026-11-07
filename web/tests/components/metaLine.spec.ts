import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'

import MetaLine from '@/shared/ui/MetaLine.vue'

const line = (session?: string) =>
  mount(MetaLine, { props: { when: 'Aug 13', session }, slots: { default: 'kolo' } })

// The id is one token the line may not break inside, and a space still stands between it and
// the name, so the line can break there as between any words and a reader hears two words.
it('sets the session apart from the name by a space, as a token of its own', () => {
  const who = line('019a2b3c-4d5e').get('.meta-who')
  expect(who.text()).toBe('kolo 019a2b3c-4d5e')
  expect(who.element.textContent).toBe('kolo 019a2b3c-4d5e')
  expect(who.get('.meta-session').text()).toBe('019a2b3c-4d5e')
})

// Every surface prints the first two groups of a session; the whole UUID is 36 characters,
// wider than a head's column on a phone. With no layer that knows the session it is no link.
it('prints the start of a whole session id, the whole of it in its tooltip', () => {
  const session = line('019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b').get('.meta-session')
  expect(session.text()).toBe('019a2b3c-4d5e')
  expect(session.attributes('title')).toBe('019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b')
  expect(session.find('a').exists()).toBe(false)
})

it('names no session where the entry has none', () => {
  const who = line().get('.meta-who')
  expect(who.element.textContent).toBe('kolo')
  expect(who.find('.meta-session').exists()).toBe(false)
})
