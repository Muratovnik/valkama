<script setup lang="ts">
/**
 * The inline half of `RichText`: words, emphasis, code, links and references.
 *
 * A reference is a link only when the layers above say it resolves; otherwise
 * it is the text it was. Ids, hashes and code are set in the metadata font,
 * because they are compared character by character; a work item reference
 * stays in the reading font, as it is everywhere else in the product.
 */
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import type { TextReference } from '@/shared/lib/textReferences.ts'

defineProps<{ nodes: readonly RichInline[] }>()
defineOptions({ name: 'RichInlines' })

const resolve = useReferenceLinks()
/** What a reference links to here, or null where it is text. */
const linkFor = (reference: TextReference) => resolve(reference)
const titleFor = (reference: TextReference) => resolve(reference)?.title
const isId = (reference: TextReference) => reference.kind !== 'work-item'
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
    ><button
      v-else-if="linkFor(node.reference)"
      type="button"
      class="rich-reference"
      :class="{ 'rich-code': node.code, 'identifier': isId(node.reference) }"
      :title="titleFor(node.reference)"
      @click="open(node.reference)"
    >
      <span>{{ node.reference.value }}</span></button
    ><code
      v-else-if="node.code"
      class="rich-code"
      >{{ node.reference.value }}</code
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
   rather than go to an address; it reads as the link it is. */
.rich-reference {
  display: inline;
  padding: 0;
  border: 0;
  font: inherit;
  text-align: inherit;
  background: none;
  cursor: pointer;

  &.identifier {
    font-family: var(--font-family-mono);
  }

  &:hover {
    text-decoration-thickness: 2px;
  }
}
</style>
