/** The values of a group of settings, by the setting each belongs to. */
type SettingValues = Readonly<Record<string, string | number | boolean>>

/**
 * Which preset a group of settings is, or, when it is none of them, in how many settings it
 * differs from the nearest one.
 *
 * A preset says a value for each of its settings; the group is that preset when every one
 * of them agrees. No preset is "custom": a set that matches none is said, not chosen.
 */
export function presetOf<Preset extends string>(
  values: SettingValues,
  presets: Readonly<Record<Preset, SettingValues>>,
): { differing: number; preset: Preset | null } {
  let nearest: { differing: number; preset: Preset | null } = {
    preset: null,
    differing: Number.POSITIVE_INFINITY,
  }
  for (const preset of Object.keys(presets) as Preset[]) {
    const wanted = presets[preset]
    const differing = Object.keys(wanted).filter((key) => values[key] !== wanted[key]).length
    if (differing === 0) return { preset, differing }
    if (differing < nearest.differing) nearest = { preset: null, differing }
  }
  return Number.isFinite(nearest.differing) ? nearest : { preset: null, differing: 0 }
}
