<script setup lang="ts">
/**
 * The inline half of `RichText`: words, emphasis, code, links and references.
 *
 * A reference is a link only when the layers above say it resolves; otherwise
 * it is the text it was. Ids, hashes and code are set in the metadata font,
 * because they are compared character by character; a work item reference
 * stays in the reading font, as it is everywhere else in the product.
 *
 * A reference is inline, as a link in prose is, so it wraps with the words around it
 * and what is written against it stays on its last line. One that leads to a place with
 * an address of its own, a card or a document, is a link to that address; one that does
 * something else — copies, opens a file in the editor, shows a record — is a button,
 * drawn as the text it acts on (WAI-ARIA APG, button pattern: Enter and Space), an `<a>`
 * with no address and the role of a button, since a `<button>` is a box of its own. A path
 * that copies rather than opens has a dotted underline, which is what tells the two apart
 * without colour, in forced colours as well.
 *
 * A path keeps the reading font, because a weak one starts as text and may become a link
 * when the server answers: only its underline and tooltip may change then. A line may
 * break after each of its `/`, which a browser does not offer on its own, so a long path
 * fills the rest of its line rather than leaving it empty.
 */
import { Fragment, h } from 'vue'
import type { FunctionalComponent } from 'vue'

import { opensInPlace } from '@/shared/lib/linkPress.ts'
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { inlineWords } from '@/shared/lib/richText.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import type { TextReference } from '@/shared/lib/textReferences.ts'
import { vReferencePreview } from '@/shared/ui/referencePreviewAnchors.ts'
import { slashPieces } from '@/shared/ui/slashBreaks.ts'

const props = defineProps<{ nodes: readonly RichInline[] }>()
defineOptions({ name: 'RichInlines' })

type ReferenceNode = Extract<RichInline, { kind: 'reference' }>

/** A reference's words; a path's with a place to break after each `/`, which adds no character. */
const ReferenceWords: FunctionalComponent<{ path: boolean; text: string }> = ({ path, text }) =>
  h(
    Fragment,
    path
      ? slashPieces(text).flatMap((piece, index) => (index ? [h('wbr'), piece] : [piece]))
      : [text],
  )

const resolve = useReferenceLinks()
/** What a reference links to here, or null where it is text. */
const linkFor = (reference: TextReference) => resolve(reference)
const titleFor = (reference: TextReference) => resolve(reference)?.title
const previewFor = (reference: TextReference) => resolve(reference)?.preview
/** Where it leads, for a link to a place; a reference that acts has none and is a button. */
const hrefOf = (reference: TextReference) => resolve(reference)?.href
/**
 * A button that is not a `<button>` says so and takes focus; a link does both by itself.
 * Both are one `<a>`, with an address or without, so that a path the server answers for
 * while it holds focus is the same element after as before, and keeps focus.
 */
const roleOf = (reference: TextReference) => (hrefOf(reference) ? undefined : 'button')
const tabStopOf = (reference: TextReference) => (hrefOf(reference) ? undefined : 0)
/** A link with a preview has that for its one hover text: its title only describes it. */
const hoverTitle = (reference: TextReference) =>
  previewFor(reference) ? undefined : titleFor(reference)
const describedAs = (reference: TextReference) =>
  previewFor(reference) ? titleFor(reference) : undefined
const isId = ({ caption, code, reference }: ReferenceNode) =>
  reference.kind === 'document' ? code && !caption : reference.kind !== 'work-item'
const isPath = ({ reference }: ReferenceNode) => reference.kind === 'document'
/** What a control shows without a caption: the part of the run it covers. */
const labelOf = (reference: TextReference) => resolve(reference)?.label ?? reference.value
/** What follows a control as prose; a caption stands for the whole run. */
const afterOf = ({ caption, reference }: ReferenceNode) =>
  caption ? '' : (resolve(reference)?.after ?? '')
/**
 * A path says where it leads or why it only copies. The caption is in the name
 * too, because a name that leaves out the visible words cannot be spoken to.
 */
function nameOf({ caption, reference }: ReferenceNode) {
  const named = caption ? `${inlineWords(caption)} — ${titleFor(reference)}` : titleFor(reference)
  return reference.kind === 'document' ? named : undefined
}
/**
 * Which sides of a code ground something is written against, with no space between. Its
 * inset read as a space before a comma there, so on such a side it narrows.
 */
function tight(index: number, after = '') {
  const previous = props.nodes[index - 1]
  const next = props.nodes[index + 1]
  return {
    'tight-start': previous?.kind === 'text' && /\S$/u.test(previous.text),
    'tight-end': Boolean(after) || (next?.kind === 'text' && /^\S/u.test(next.text)),
  }
}
/** A reference written as code stands on the code's ground inside the control. */
const groundOf = (node: ReferenceNode, index: number) =>
  node.code ? ['rich-code', tight(index, afterOf(node))] : undefined
/** Absent rather than false: a control that is not waiting makes no claim about it. */
const busyOf = (reference: TextReference) => resolve(reference)?.busy || undefined

/** A link opens in place on a plain press and leaves the rest to the browser (`linkPress`). */
function press(event: MouseEvent, reference: TextReference) {
  const link = resolve(reference)
  if (!link || (link.href ? !opensInPlace(event) : event.button !== 0)) return
  event.preventDefault()
  link.open()
}
/** A button acts on Enter as it goes down and on Space as it comes up; a link has its own Enter. */
function pressKey(event: KeyboardEvent, reference: TextReference) {
  if (hrefOf(reference)) return
  if (event.key === ' ') event.preventDefault()
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (!event.repeat) resolve(reference)?.open()
}
function releaseKey(event: KeyboardEvent, reference: TextReference) {
  if (hrefOf(reference) || event.key !== ' ') return
  event.preventDefault()
  resolve(reference)?.open()
}
</script>

<template>
  <template
    v-for="(node, index) in nodes"
    :key="index"
    ><template v-if="node.kind === 'text'">{{ node.text }}</template
    ><br v-else-if="node.kind === 'break'" /><strong
      v-else-if="node.kind === 'strong'"
      class="rich-strong"
      ><RichInlines :nodes="node.children" /></strong
    ><em
      v-else-if="node.kind === 'em'"
      class="rich-em"
      ><RichInlines :nodes="node.children" /></em
    ><del
      v-else-if="node.kind === 'del'"
      class="rich-del"
      ><RichInlines :nodes="node.children" /></del
    ><!-- The link's words are its children, which this rule cannot see into. -->
    <!-- eslint-disable-next-line vuejs-accessibility/anchor-has-content -->
    <a
      v-else-if="node.kind === 'link'"
      class="rich-link"
      target="_blank"
      rel="noopener noreferrer"
      :href="node.href"
      ><RichInlines :nodes="node.children" /></a
    ><code
      v-else-if="node.kind === 'code'"
      class="rich-code"
      :class="tight(index)"
      >{{ node.text }}</code
    ><template v-else-if="linkFor(node.reference)"
      ><a
        v-reference-preview="previewFor(node.reference)"
        class="rich-reference"
        :class="{ identifier: isId(node), copies: linkFor(node.reference)?.copies }"
        :href="hrefOf(node.reference)"
        :role="roleOf(node.reference)"
        :tabindex="tabStopOf(node.reference)"
        :title="hoverTitle(node.reference)"
        :aria-description="describedAs(node.reference)"
        :aria-label="nameOf(node)"
        :aria-busy="busyOf(node.reference)"
        @click="press($event, node.reference)"
        @auxclick="press($event, node.reference)"
        @keydown="pressKey($event, node.reference)"
        @keyup="releaseKey($event, node.reference)"
        ><span :class="groundOf(node, index)"
          ><RichInlines
            v-if="node.caption"
            :nodes="node.caption" /><ReferenceWords
            v-else
            :path="isPath(node)"
            :text="labelOf(node.reference)" /></span></a
      >{{ afterOf(node) }}</template
    ><RichInlines
      v-else-if="node.caption"
      :nodes="node.caption" /><code
      v-else-if="node.code"
      class="rich-code"
      :class="tight(index)"
      ><ReferenceWords
        :path="isPath(node)"
        :text="node.reference.value" /></code
    ><ReferenceWords
      v-else
      :path="isPath(node)"
      :text="node.reference.value"
  /></template>
</template>

<style scoped>
.rich-strong {
  font-weight: 600;
}

/* A code span wraps as words do, and each of its lines keeps the ground's inset and corners. */
.rich-code {
  padding: 0 var(--space-1);
  font-size: var(--font-size-dense);
  overflow-wrap: var(--rich-inline-wrap, anywhere);
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
  box-decoration-break: clone;
}

/* A link in prose is underlined as well as coloured, so it is not told apart by
   colour alone. A path or an identifier breaks anywhere so that it never widens the
   text, unless what holds it, a document's table, would rather widen. */
.rich-link,
.rich-reference {
  color: var(--color-accent);
  text-decoration-line: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
  overflow-wrap: var(--rich-inline-wrap, anywhere);
}

/* The pointer target is the line and a little more (WCAG 2.5.8 asks 24px; a line of
   reading text is 24px): padding on an inline box widens what a pointer hits and takes no
   room in the line, so a line holding a reference stands as tall as one without. It
   reaches 2px under the words, which stay inside the line, and the rest above them, up
   to the words of the line before and no further, whatever the size: the words' own box
   is a little over 1.2em. Not below, because what a box overflows below lengthens what
   its scroller scrolls, and on a text's last line a pixel of it showed «Show all» a pixel
   short; above, nothing scrolls. Each line of a wrapped reference is drawn whole, with
   its own padding and focus ring. */
.rich-reference {
  padding-block: calc(1lh - 1.2em - 1px) var(--space-half);
  cursor: pointer;
  box-decoration-break: clone;

  &.identifier {
    font-family: var(--font-family-mono);
  }

  &.copies {
    text-decoration-style: dotted;
  }

  &[aria-busy='true'] {
    cursor: progress;
  }

  &:hover {
    text-decoration-thickness: 2px;
  }
}

/* A ground is inset from its words, and beside a comma or a bracket written against it
   that inset read as a space. On a side something touches, it narrows to a sliver. */
.rich-code.tight-start {
  padding-inline-start: var(--space-half);
}

.rich-code.tight-end {
  padding-inline-end: var(--space-half);
}
</style>
