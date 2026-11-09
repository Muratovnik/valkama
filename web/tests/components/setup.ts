import { createPinia, setActivePinia } from 'pinia'

import { beforeEach } from 'vitest'

// happy-dom draws nothing, so nothing is under way.
document.getAnimations = () => []

// A mark that names a workflow state reads the owner's settings from their store, as the app
// does; a test that installs a store of its own still reaches its own.
beforeEach(() => {
  setActivePinia(createPinia())
})
