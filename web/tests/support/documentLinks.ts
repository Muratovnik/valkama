/**
 * A path written in a text, under a document layer, under the shell's real notice.
 *
 * The nodes are built by hand, in the shape the parser's table promises
 * (`document-path-samples.json`), so a spec holds the layer and not the parser.
 * A spec mocks `resolveDocuments` itself and answers through `server`.
 */
import { defineComponent, h } from 'vue'
import type { Component, PropType } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { vi } from 'vitest'

import AppNotice from '@/app/components/AppNotice.vue'
import { useShellNotice } from '@/app/composables/useShellNotice.ts'

import {
  provideDocumentLinks,
  provideDocumentOpener,
} from '@/entities/project-document/documentLinks.ts'
import type { DocumentOpener } from '@/entities/project-document/documentLinks.ts'

import { resolveDocuments } from '@/shared/api/documentApi.ts'
import type { DocumentBase, ResolvedPath } from '@/shared/api/documentApi.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'

export const SPACE = 'space-identity'

export const FILE = {
  status: 'file',
  project: 'demo',
  relative: 'docs/a.md',
  markdown: true,
} as const
export const CODE = {
  status: 'file',
  project: 'demo',
  relative: 'src/a.ts',
  markdown: false,
} as const
export const FOLDER = { status: 'directory', project: 'demo', relative: 'docs' } as const
export const REFUSED = { status: 'refused', code: 'outside_root' } as const

type Reference = Extract<RichInline, { kind: 'reference' }>
type Said = Omit<ResolvedPath, 'path'>

export const words = (text: string): RichInline[] => [{ kind: 'text', text }]

export function strong(value: string, more: Partial<Reference> = {}): RichInline {
  return {
    kind: 'reference',
    code: false,
    reference: { kind: 'document', value, strength: 'strong' },
    ...more,
  }
}

export function weak(value: string, code = false): RichInline {
  return {
    kind: 'reference',
    code,
    reference: { kind: 'document', value, strength: 'weak' },
  }
}

export function network(value: string): RichInline {
  return {
    kind: 'reference',
    code: false,
    reference: { kind: 'document', value, strength: 'copy-only' },
  }
}

/** The server, from what it knows of each path; anything else is not there. */
export function server(known: Record<string, Said> = {}) {
  let answered = 0
  vi.mocked(resolveDocuments).mockImplementation((_base, paths) => {
    answered += 1
    // A layer that keeps asking stops here, so its test fails on the count instead of hanging.
    if (answered > 20) return new Promise(() => {})
    return Promise.resolve(
      paths.map((path) => ({ path, ...(known[path] ?? { status: 'missing' }) }) as ResolvedPath),
    )
  })
}

export const Layer = defineComponent({
  props: {
    base: { type: Object as PropType<DocumentBase>, required: true },
  },
  setup(props, { slots }) {
    provideDocumentLinks(() => props.base)
    return () => slots.default?.()
  },
})

const mounted: { unmount: () => void }[] = []

export function unmountAll() {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
}

/** The shell's notice as App has it, and the opener that speaks through it. */
export function underShell(content: Component, opener: Partial<DocumentOpener> = {}) {
  let spoken: string[] = []
  const wrapper = mount(
    {
      setup() {
        const notice = useShellNotice()
        provideDocumentOpener({
          ...opener,
          say: (message, kind) => {
            spoken = [...spoken, message]
            notice.say(message, kind)
          },
        })
        return () => [
          h(content),
          h(AppNotice, {
            notice: notice.current.value,
            onAct: notice.act,
            onDismiss: notice.dismiss,
          }),
        ]
      },
    },
    {
      attachTo: document.body,
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages })] },
    },
  )
  mounted.push(wrapper)
  return { wrapper, spoken: () => spoken }
}

/** Text whose nodes are the host's to change, under a layer rooted in `SPACE`. */
export function layered(nodes: () => RichInline[], base: DocumentBase = { space: SPACE }) {
  return {
    render: () =>
      h(
        Layer,
        { base },
        { default: () => h({ render: () => h(RichInlines, { nodes: nodes() }) }) },
      ),
  }
}

export function drawn(nodes: RichInline[], opener?: Partial<DocumentOpener>) {
  return underShell(
    layered(() => nodes),
    opener,
  )
}

export function clipboard(writeText: (text: string) => Promise<void> = () => Promise.resolve()) {
  const spy = vi.fn(writeText)
  vi.stubGlobal('navigator', { clipboard: { writeText: spy } })
  return spy
}
