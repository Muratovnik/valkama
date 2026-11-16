import { inject, provide, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

/** A space as the app lists it: where it is, its key, and the name a reader sees. */
export type SpaceName = { data_scope_id: string; name: string; space_key: string }

const SPACE_NAMES: InjectionKey<Readonly<Ref<readonly SpaceName[]>>> = Symbol('space-names')

/**
 * The space list the app already loads, provided once at the root so that a
 * deep surface can name a space without a prop passed through every layer.
 */
export function provideSpaceNames(spaces: Readonly<Ref<readonly SpaceName[]>>) {
  provide(SPACE_NAMES, spaces)
}

/** The provided list inside a surface that has no provider: empty, so keys show. */
export function useSpaceNames(): Readonly<Ref<readonly SpaceName[]>> {
  return inject(SPACE_NAMES, () => ref<SpaceName[]>([]), true)
}

/** The space's name from the list, or its key when the list does not hold it. */
export function spaceName(
  spaces: readonly SpaceName[],
  space: { data_scope_id: string; space_key: string },
): string {
  return (
    spaces.find(
      (item) => item.data_scope_id === space.data_scope_id && item.space_key === space.space_key,
    )?.name ?? space.space_key
  )
}
