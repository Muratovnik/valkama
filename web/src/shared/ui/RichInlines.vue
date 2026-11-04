<script setup lang="ts">
/**
 * The inline half of `RichText`: words, emphasis, code, links and references.
 *
 * A reference is a link only when the layers above say it resolves; otherwise
 * it is the text it was. Ids, hashes and code are set in the metadata font,
 * because they are compared character by character; a work item reference
 * stays in the reading font, as it is everywhere else in the product.
 *
 * A path in prose keeps the reading font too, because a weak one starts as text
 * and may become a link when the server answers: only its underline and tooltip
 * may change then, so it also holds the box a button will be, which is atomic
 * in a line. A path that copies rather than opens has a dotted underline, which
 * is what tells the two apart without colour, in forced colours as well.
 *
 * Being atomic, a reference would let a line break right after it, before the comma
 * written against it. So it is drawn with what touches it (`glueReferences`), in a
 * box of its own that moves to the next line whole. A code span is inline and breaks
 * like words, so it needs no box; what touches it narrows the inset of its ground on
 * that side, which otherwise read as a space before the comma.
 */
import { computed } from 'vue'

import { glueReferences } from '@/shared/lib/inlineGlue.ts'
import type { GluedInline } from '@/shared/lib/inlineGlue.ts'
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { inlineWords } from '@/shared/lib/richText.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import type { TextReference } from '@/shared/lib/textReferences.ts'
import { vReferencePreview } from '@/shared/ui/referencePreviewAnchors.ts'

const props = defineProps<{ nodes: readonly RichInline[] }>()
defineOptions({ name: 'RichInlines' })

const pieces = computed(() => glueReferences(props.nodes))

type ReferenceNode = Extract<RichInline, { kind: 'reference' }>

const resolve = useReferenceLinks()
/** What a reference links to here, or null where it is text. */
const linkFor = (reference: TextReference) => resolve(reference)
const titleFor = (reference: TextReference) => resolve(reference)?.title
const previewFor = (reference: TextReference) => resolve(reference)?.preview
/** A link with a preview has that for its one hover text: its title only describes it. */
const hoverTitle = (reference: TextReference) =>
  previewFor(reference) ? undefined : titleFor(reference)
const describedAs = (reference: TextReference) =>
  previewFor(reference) ? titleFor(reference) : undefined
const isId = ({ caption, code, reference }: ReferenceNode) =>
  reference.kind === 'document' ? code && !caption : reference.kind !== 'work-item'
const isWeak = ({ reference }: ReferenceNode) =>
  reference.kind === 'document' && reference.strength === 'weak'
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
type Glued = Extract<GluedInline, { kind: 'glued' }>
/** Whether a piece stands in a box of its own: a reference does, being atomic, with what touches it. */
const boxed = (piece: Glued) => piece.glued && piece.node.kind === 'reference'
/** Which sides of a piece's ground something is written against, with no space between. */
function tight(piece: Glued, after = '') {
  return { 'tight-start': Boolean(piece.before), 'tight-end': Boolean(piece.after || after) }
}
/** Absent rather than false: a control that is not waiting makes no claim about it. */
const busyOf = (reference: TextReference) => resolve(reference)?.busy || undefined
function open(reference: TextReference) {
  resolve(reference)?.open()
}
</script>

<template>
  <template
    v-for="(node, index) in pieces"
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
    ><span
      v-else
      :class="{ 'rich-glue': boxed(node) }"
      >{{ node.before
      }}<code
        v-if="node.node.kind === 'code'"
        class="rich-code"
        :class="tight(node)"
        >{{ node.node.text }}</code
      ><template v-else-if="linkFor(node.node.reference)"
        ><button
          v-reference-preview="previewFor(node.node.reference)"
          type="button"
          class="rich-reference"
          :class="{
            ...tight(node, afterOf(node.node)),
            'rich-code': node.node.code,
            'identifier': isId(node.node),
            'copies': linkFor(node.node.reference)?.copies,
          }"
          :title="hoverTitle(node.node.reference)"
          :aria-description="describedAs(node.node.reference)"
          :aria-label="nameOf(node.node)"
          :aria-busy="busyOf(node.node.reference)"
          @click="open(node.node.reference)"
        >
          <span
            ><RichInlines
              v-if="node.node.caption"
              :nodes="node.node.caption"
            /><template v-else>{{ labelOf(node.node.reference) }}</template></span
          ></button
        >{{ afterOf(node.node) }}</template
      ><RichInlines
        v-else-if="node.node.caption"
        :nodes="node.node.caption"
      /><code
        v-else-if="node.node.code"
        class="rich-code"
        :class="{ ...tight(node), 'rich-atom': isWeak(node.node) }"
        >{{ node.node.reference.value }}</code
      ><span
        v-else-if="isWeak(node.node)"
        class="rich-atom"
        >{{ node.node.reference.value }}</span
      ><template v-else>{{ node.node.reference.value }}</template
      >{{ node.after }}</span
    ></template
  >
</template>

<style scoped>
.rich-strong {
  font-weight: 600;
}

.rich-code {
  padding: 0 var(--space-1);
  font-size: var(--font-size-dense);
  overflow-wrap: var(--rich-inline-wrap, anywhere);
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
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

/* An in-app reference is a button, because what it does is open something here
   rather than go to an address; it reads as the link it is.

   A button is an atomic box even where it is declared inline, and the global
   button floor (one control row, 40px) made every line holding a reference a
   control row tall. So the box takes the text's own line height and no floor.
   The pointer target is a 24px band centred on the text, drawn by the
   pseudo-element: it is positioned, so it takes no room in the line box. */
.rich-reference {
  position: relative;
  display: inline-block;
  vertical-align: baseline;
  min-block-size: 0;
  padding: 0;
  border: 0;
  font: inherit;
  text-align: inherit;
  background: none;
  cursor: pointer;

  &::before {
    content: '';
    position: absolute;
    inset-inline: 0;
    top: 50%;
    height: 24px;
    translate: 0 -50%;
  }

  /* A code span stays one as a link: same size and ground, so nothing moves. */
  &.rich-code {
    padding: 0 var(--space-1);
    font-size: var(--font-size-dense);
    background: var(--color-surface-recess);
  }

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

/* A reference and what is written against it, with no space between, move to the next
   line together: the box breaks inside only when it is wider than the line. */
.rich-glue {
  display: inline-block;
  vertical-align: baseline;
}

/* A weak path as text: laid out as the button it may become, and read as prose. */
.rich-atom {
  display: inline-block;
  vertical-align: baseline;
}
</style>
