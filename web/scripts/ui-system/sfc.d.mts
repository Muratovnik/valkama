/** A `<style>` block of a component, as the SFC compiler reads it. */
export interface StyleBlock {
  attrs: Record<string, string | true>
  content: string
  /** The offset in the source where the content ends. */
  end: number
  /** The line the content starts on. */
  line: number
  /** The offset in the source where the content starts. */
  start: number
}

/** The style blocks of a component source, in order. */
export declare function styleBlocks(source: string): StyleBlock[]
