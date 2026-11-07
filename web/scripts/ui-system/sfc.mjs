/**
 * The `<style>` blocks of a component, as the SFC compiler reads them.
 *
 * A regular expression over a `.vue` file takes a `<style` written in a script string or in the
 * template for a block, and runs to the real `</style>`. The compiler knows which tags are blocks:
 * only the top-level ones of the file.
 */
import { parse } from 'vue/compiler-sfc'

/** The style blocks of a component source, in order, each with its attributes and content. */
export function styleBlocks(source) {
  return parse(source).descriptor.styles.map((block) => ({
    attrs: block.attrs,
    content: block.content,
    // The offsets of the content, in the source the caller passed.
    end: block.loc.end.offset,
    // The line the content starts on, so a finding inside it can name its line in the file.
    line: block.loc.start.line,
    start: block.loc.start.offset,
  }))
}
