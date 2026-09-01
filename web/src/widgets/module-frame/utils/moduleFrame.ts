import type { ModuleId } from '@/shared/api/platformModuleContract.ts'

export const MODULE_FRAME_SCROLL_OWNER = 'module-frame' as const
const MODULE_FRAME_MODULES = [
  'sessions',
  'improvements',
  'analytics',
  'settings',
  'skills',
  'memory',
] as const
export type ModuleFrameModule = (typeof MODULE_FRAME_MODULES)[number]

/** One scroll surface is shared by every standalone module page. */
export function moduleFrameScrollOwner(module: ModuleId): typeof MODULE_FRAME_SCROLL_OWNER | null {
  return MODULE_FRAME_MODULES.includes(module as ModuleFrameModule)
    ? MODULE_FRAME_SCROLL_OWNER
    : null
}
