/**
 * The harness page for paths written in a text: every state a path can be in,
 * in the card's real overlay, with the shell's real notice.
 *
 * The nodes are built by hand in the shape the parser's table promises, so the
 * page holds the layer, the control and the notice, and not the parser. The
 * server is whatever the test routes `/api/documents/resolve` to.
 */
import { defineComponent, h } from 'vue'

import AppNotice from '@/app/components/AppNotice.vue'
import { useShellNotice } from '@/app/composables/useShellNotice.ts'

import {
  provideDocumentLinks,
  provideDocumentOpener,
} from '@/entities/project-document/documentLinks.ts'

import type { RichInline } from '@/shared/lib/richText.ts'
import OverlayHost from '@/shared/ui/OverlayHost.vue'
import RichInlines from '@/shared/ui/RichInlines.vue'

type Strength = 'copy-only' | 'strong' | 'weak'
type Options = { caption?: RichInline[]; code?: boolean }

const path = (value: string, strength: Strength = 'strong', options: Options = {}): RichInline => ({
  kind: 'reference',
  code: options.code ?? false,
  ...(options.caption ? { caption: options.caption } : {}),
  reference: { kind: 'document', value, strength },
})
const words = (text: string): RichInline => ({ kind: 'text', text })

/** A long absolute path has nowhere to break but inside itself, on a phone or anywhere. */
const LONG =
  'D:/work/example-with-a-rather-long-name/services/example-service/web/src/widgets/work-item-inspector/components/InspectorReferenceScope.vue'

const TEXT: RichInline[][] = [
  [
    words('Подтверждённый план лежит в '),
    path('docs/plan.md'),
    words(', рядом с ним '),
    path('docs/plan.md:42', 'strong', { code: true }),
    words(' и подпись: '),
    path('docs/plan.md#kb:a7f3', 'strong', { caption: [{ kind: 'text', text: 'план работ' }] }),
    words('.'),
  ],
  [
    words('Вне проектов: '),
    path('C:/work/probe'),
    words(', в кавычках '),
    path('D:\\x y\\z.txt', 'strong', { code: true }),
    words(', сетевой '),
    path('\\\\server\\share\\x', 'copy-only'),
    words(', в конце фразы '),
    path('docs/gone.md.'),
    words(' и в скобках ('),
    path('docs/other.md)'),
    words('.'),
  ],
  [
    words('Слабая форма становится ссылкой, только если путь есть: '),
    path('web/src', 'weak', { code: true }),
    words(' есть, '),
    path('owner/repo', 'weak', { code: true }),
    words(' нет, и '),
    path('client/server/protocol', 'weak'),
    words(' — проза.'),
  ],
  [
    words('Длинный путь в строке переносится внутри себя: '),
    path(LONG),
    words(' и текст идёт дальше.'),
  ],
  [
    words('Ещё один документ в той же задаче: '),
    path('docs/slow.md'),
    words(', он отвечает долго.'),
  ],
]

const inASpace = () => ({ space: 'space-identity' })

const paragraphs = () =>
  h(
    'div',
    { style: 'padding: 16px' },
    TEXT.map((nodes, index) =>
      h('p', { 'key': index, 'data-paragraph': index }, h(RichInlines, { nodes })),
    ),
  )

const Paths = {
  setup() {
    provideDocumentLinks(inASpace)
    return paragraphs
  },
}

const stayOpen = () => {}

/** A page with the paths on it, or in the card's drawer, under the notice as App has it. */
export const DocumentLinksSurface = defineComponent({
  props: { inDrawer: { type: Boolean, default: false } },
  setup(props) {
    const notice = useShellNotice()
    provideDocumentOpener({
      openDocument: () => true,
      say: notice.say,
    })
    return () => [
      props.inDrawer
        ? h(
            OverlayHost,
            {
              open: true,
              variant: 'drawer',
              layer: 'drawer',
              title: 'Карточка',
              ariaLabel: 'Карточка',
              onClose: stayOpen,
            },
            { default: () => h(Paths) },
          )
        : h('main', { style: 'max-width: 760px' }, h(Paths)),
      h(AppNotice, {
        notice: notice.current.value,
        onAct: notice.act,
        onDismiss: notice.dismiss,
      }),
    ]
  },
})
