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
 */
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { inlineWords } from '@/shared/lib/richText.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import type { TextReference } from '@/shared/lib/textReferences.ts'

defineProps<{ nodes: readonly RichInline[] }>()
defineOptions({ name: 'RichInlines' })

type ReferenceNode = Extract<RichInline, { kind: 'reference' }>

const resolve = useReferenceLinks()
/** What a reference links to here, or null where it is text. */
const linkFor = (reference: TextReference) => resolve(reference)
const titleFor = (reference: TextReference) => resolve(reference)?.title
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
/** Absent rather than false: a control that is not waiting makes no claim about it. */
const busyOf = (reference: TextReference) => resolve(reference)?.busy || undefined
function open(reference: TextReference) {
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
      >{{ node.text }}</code
    ><template v-else-if="linkFor(node.reference)"
      ><button
        type="button"
        class="rich-reference"
        :class="{
          'rich-code': node.code,
          'identifier': isId(node),
          'copies': linkFor(node.reference)?.copies,
        }"
        :title="titleFor(node.reference)"
        :aria-label="nameOf(node)"
        :aria-busy="busyOf(node.reference)"
        @click="open(node.reference)"
      >
        <span
          ><RichInlines
            v-if="node.caption"
            :nodes="node.caption"
          /><template v-else>{{ labelOf(node.reference) }}</template></span
        ></button
      >{{ afterOf(node) }}</template
    ><RichInlines
      v-else-if="node.caption"
      :nodes="node.caption"
    /><code
      v-else-if="node.code"
      class="rich-code"
      :class="{ 'rich-atom': isWeak(node) }"
      >{{ node.reference.value }}</code
    ><span
      v-else-if="isWeak(node)"
      class="rich-atom"
      >{{ node.reference.value }}</span
    ><template v-else>{{ node.reference.value }}</template></template
  >
</template>

<style scoped>
.rich-strong {
  font-weight: 600;
}

.rich-code {
  padding: 0 var(--space-1);
  font-size: var(--font-size-dense);
  overflow-wrap: anywhere;
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
}

/* A link in prose is underlined as well as coloured, so it is not told apart by
   colour alone. */
.rich-link,
.rich-reference {
  color: var(--color-accent);
  text-decoration-line: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
  overflow-wrap: anywhere;
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

/* A weak path as text: laid out as the button it may become, and read as prose. */
.rich-atom {
  display: inline-block;
  vertical-align: baseline;
}
</style>
