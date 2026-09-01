import type { ModuleRegistration, ModulesPayload } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'

export function moduleRegistrations(): ModuleRegistration[] {
  return OFFLINE_MODULE_FALLBACK.map((manifest) => ({
    manifest: structuredClone(manifest),
    state: 'enabled',
    mutable: manifest.module_id !== 'settings',
    revision: 1,
    updated_at: '2026-08-20T00:00:00Z',
  }))
}

export function modulesPayload(): ModulesPayload {
  return { interface_version: 'valkama-modules', modules: moduleRegistrations() }
}
