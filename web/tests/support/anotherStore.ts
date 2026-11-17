interface SpaceTarget {
  space_ref: { data_scope_id: string; space_key: string }
}

/**
 * The same target in another store: the same space key and reference under another data
 * scope, which is what makes two equally named items two items.
 */
export function inAnotherStore<T extends SpaceTarget>(target: T): T {
  return {
    ...target,
    space_ref: { ...target.space_ref, data_scope_id: '66666666-6666-4666-8666-666666666666' },
  }
}
