/**
 * Explicitly non-authoritative manifests for transport/offline recovery only.
 *
 * Normal routing and navigation validate the module list the server answers
 * with instead. Importing this table is an explicit offline choice.
 */

import type { EntityKind } from '@/shared/api/platformEntityRef.ts'
import { MODULES_INTERFACE } from '@/shared/api/platformModuleContract.ts'
import type {
  ModuleId,
  ModuleManifest,
  ModuleUiStateName,
  NavigationGroup,
} from '@/shared/api/platformModuleContract.ts'

const BOTH_STATES: ModuleUiStateName[] = [
  'loading',
  'ready',
  'empty',
  'error',
  'unavailable',
  'permission-denied',
  'degraded',
]
/** One module's manifest, named field by field: the lists are interchangeable
 *  by shape and were only told apart by their position. */
interface ModuleSpec {
  actionGlobal: string[]
  actionProject: string[]
  allowed_keys: string[]
  feature_capabilities: string[]
  icon_key: string
  module_id: ModuleId
  navigation_group: NavigationGroup
  readGlobal: string[]
  readProject: string[]
  required_read_models: string[]
  secondaryGlobal: EntityKind[]
  secondaryProject: EntityKind[]
  sse_subscriptions: string[]
  supported_entity_kinds: EntityKind[]
  title_key: string
  project_secondary_behavior?: 'all' | 'unavailable'
  project_supported_states?: ModuleUiStateName[]
  project_unsupported_reason?: string
}

const MODULE = ({
  module_id,
  navigation_group,
  title_key,
  icon_key,
  allowed_keys,
  readGlobal,
  readProject,
  actionGlobal,
  actionProject,
  required_read_models,
  secondaryGlobal,
  secondaryProject,
  sse_subscriptions,
  supported_entity_kinds,
  feature_capabilities,
  project_supported_states,
  project_unsupported_reason,
  project_secondary_behavior = 'all',
}: ModuleSpec): ModuleManifest => ({
  interface_version: MODULES_INTERFACE,
  module_id,
  version: '2.0.0',
  title_key,
  icon_key,
  navigation_group,
  route_namespace: module_id,
  state_schema: { schema_id: `module.${module_id}.state`, allowed_keys, max_bytes: 2048 },
  operating_levels: ['global', 'project'],
  semantics: {
    global: { read_models: readGlobal, action_semantics: actionGlobal },
    project: { read_models: readProject, action_semantics: actionProject },
  },
  secondary_context: {
    global: { kinds: secondaryGlobal, behavior: 'all' },
    project: { kinds: secondaryProject, behavior: project_secondary_behavior },
  },
  required_read_models,
  sse_subscriptions,
  supported_entity_kinds,
  primary_actions: actionProject,
  secondary_actions: actionGlobal,
  inspector_owner: `module.${module_id}`,
  feature_capabilities,
  states: {
    global: { supported: [...BOTH_STATES] },
    project: {
      supported: project_supported_states ?? [...BOTH_STATES],
      ...(project_unsupported_reason === undefined
        ? {}
        : { unsupported_reason: project_unsupported_reason }),
    },
  },
})

/** Non-authoritative manifests used only while the server is unreachable. */
export const OFFLINE_MODULE_FALLBACK: readonly ModuleManifest[] = Object.freeze([
  MODULE({
    module_id: 'planning',
    navigation_group: 'work',
    title_key: 'platform.modules.planning',
    icon_key: 'layout-dashboard',
    allowed_keys: [
      'query',
      'view',
      'status',
      'chain',
      'chain_scope',
      'closed',
      'group',
      'branch',
      // The Work filter beside the text in `query` (`workFilter.ts`).
      'ready',
      'held',
      'cat',
      'kind',
      'pri',
      'labels',
      'holder',
    ],
    readGlobal: ['planning.spaces', 'planning.work-items'],
    readProject: ['planning.project-spaces', 'planning.work-items'],
    actionGlobal: ['module.planning.create-work-item', 'module.planning.open-work-item'],
    actionProject: ['module.planning.create-work-item', 'module.planning.open-work-item'],
    required_read_models: ['planning-spaces', 'work-items'],
    secondaryGlobal: ['project', 'planning-space'],
    secondaryProject: ['planning-space', 'work-item'],
    sse_subscriptions: ['planning.changed'],
    supported_entity_kinds: ['project', 'planning-space', 'workflow', 'work-item'],
    feature_capabilities: [],
  }),
  MODULE({
    module_id: 'analytics',
    navigation_group: 'understand',
    title_key: 'platform.modules.analytics',
    icon_key: 'chart-no-axes-combined',
    allowed_keys: [],
    readGlobal: [],
    readProject: [],
    actionGlobal: [],
    actionProject: [],
    required_read_models: [],
    secondaryGlobal: [],
    secondaryProject: [],
    sse_subscriptions: [],
    supported_entity_kinds: ['project'],
    feature_capabilities: [],
  }),
  MODULE({
    module_id: 'memory',
    navigation_group: 'capabilities',
    title_key: 'platform.modules.memory',
    icon_key: 'book-open',
    allowed_keys: ['query', 'provider'],
    readGlobal: ['memory.providers', 'memory.recent'],
    readProject: ['memory.search', 'memory.linked'],
    actionGlobal: ['module.memory.attach'],
    actionProject: ['module.memory.open'],
    required_read_models: ['memory'],
    secondaryGlobal: ['memory-resource'],
    secondaryProject: ['memory-resource', 'work-item'],
    sse_subscriptions: [],
    supported_entity_kinds: ['project', 'memory-resource', 'work-item'],
    feature_capabilities: ['memory.open', 'memory.health'],
  }),
  MODULE({
    module_id: 'settings',
    navigation_group: 'system',
    title_key: 'platform.modules.settings',
    icon_key: 'settings-2',
    allowed_keys: ['section', 'query'],
    readGlobal: [],
    readProject: ['project.bindings'],
    actionGlobal: ['module.settings.open-adapter'],
    actionProject: ['module.settings.configure-project'],
    required_read_models: ['settings'],
    secondaryGlobal: [],
    secondaryProject: [],
    sse_subscriptions: [],
    supported_entity_kinds: ['project'],
    feature_capabilities: ['settings.configure'],
  }),
])
