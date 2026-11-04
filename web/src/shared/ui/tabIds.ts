import { useId } from 'vue'

/**
 * The ids that tie a tab to its panel, for a tab list and the panel it shows to share:
 * the tab names its panel with `aria-controls` and the panel is named by its tab with
 * `aria-labelledby`. One owner makes both from one base, so they cannot drift apart.
 */
export function useTabIds() {
  const base = useId()
  return {
    panel: (value: string) => `${base}-panel-${value}`,
    tab: (value: string) => `${base}-tab-${value}`,
  }
}

export type TabIds = ReturnType<typeof useTabIds>
