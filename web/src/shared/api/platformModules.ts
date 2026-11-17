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
  actionSpace: string[]
  allowed_keys: string[]
  feature_capabilities: string[]
  icon_key: string
  module_id: ModuleId
  navigation_group: NavigationGroup
  readGlobal: string[]
  readSpace: string[]
  required_read_models: string[]
  secondaryGlobal: EntityKind[]
  secondarySpace: EntityKind[]
  sse_subscriptions: string[]
  supported_entity_kinds: EntityKind[]
  title_key: string
  space_secondary_behavior?: 'all' | 'unavailable'
  space_supported_states?: ModuleUiStateName[]
  space_unsupported_reason?: string
}

const MODULE = ({
  module_id,
  navigation_group,
  title_key,
  icon_key,
  allowed_keys,
  readGlobal,
  readSpace,
  actionGlobal,
  actionSpace,
  required_read_models,
  secondaryGlobal,
  secondarySpace,
  sse_subscriptions,
  supported_entity_kinds,
  feature_capabilities,
  space_supported_states,
  space_unsupported_reason,
  space_secondary_behavior = 'all',
}: ModuleSpec): ModuleManifest => ({
  interface_version: MODULES_INTERFACE,
  module_id,
  version: '2.0.0',
  title_key,
  icon_key,
  navigation_group,
  route_namespace: module_id,
  state_schema: { schema_id: `module.${module_id}.state`, allowed_keys, max_bytes: 2048 },
  operating_levels: ['global', 'space'],
  semantics: {
    global: { read_models: readGlobal, action_semantics: actionGlobal },
    space: { read_models: readSpace, action_semantics: actionSpace },
  },
  secondary_context: {
    global: { kinds: secondaryGlobal, behavior: 'all' },
    space: { kinds: secondarySpace, behavior: space_secondary_behavior },
  },
  required_read_models,
  sse_subscriptions,
  supported_entity_kinds,
  primary_actions: actionSpace,
  secondary_actions: actionGlobal,
  inspector_owner: `module.${module_id}`,
  feature_capabilities,
  states: {
    global: { supported: [...BOTH_STATES] },
    space: {
      supported: space_supported_states ?? [...BOTH_STATES],
      ...(space_unsupported_reason === undefined
        ? {}
        : { unsupported_reason: space_unsupported_reason }),
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
    readSpace: ['planning.space', 'planning.work-items'],
    actionGlobal: ['module.planning.create-work-item', 'module.planning.open-work-item'],
    actionSpace: ['module.planning.create-work-item', 'module.planning.open-work-item'],
    required_read_models: ['planning-spaces', 'work-items'],
    secondaryGlobal: ['project', 'planning-space'],
    secondarySpace: ['planning-space', 'work-item'],
    sse_subscriptions: ['planning.changed'],
    supported_entity_kinds: ['project', 'planning-space', 'workflow', 'work-item'],
    feature_capabilities: [],
  }),
  MODULE({
    module_id: 'analytics',
    navigation_group: 'understand',
    title_key: 'platform.modules.analytics',
    icon_key: 'chart-no-axes-combined',
    // The page's view (`shared/api/analyticsAddress.ts`).
    allowed_keys: ['period', 'from', 'to', 'by', 'measure', 'filters', 'open', 'across'],
    readGlobal: ['analytics.usage', 'analytics.quota', 'analytics.uses'],
    readSpace: ['analytics.usage', 'analytics.quota', 'analytics.uses'],
    actionGlobal: ['module.analytics.report-use'],
    actionSpace: ['module.analytics.report-use'],
    required_read_models: ['usage'],
    // A task's card opens over the page, and the address names it.
    secondaryGlobal: ['work-item'],
    secondarySpace: ['work-item'],
    sse_subscriptions: [],
    supported_entity_kinds: ['project', 'work-item'],
    feature_capabilities: [],
  }),
  MODULE({
    module_id: 'decisions',
    navigation_group: 'understand',
    title_key: 'platform.modules.decisions',
    icon_key: 'agent',
    allowed_keys: ['point', 'period', 'from', 'to', 'open'],
    readGlobal: ['planning.decisions'],
    readSpace: ['planning.decisions'],
    actionGlobal: [],
    actionSpace: [],
    required_read_models: ['decisions'],
    secondaryGlobal: ['work-item'],
    secondarySpace: ['work-item'],
    sse_subscriptions: [],
    supported_entity_kinds: ['project', 'work-item'],
    feature_capabilities: [],
  }),
  MODULE({
    module_id: 'memory',
    navigation_group: 'capabilities',
    title_key: 'platform.modules.memory',
    icon_key: 'book-open',
    allowed_keys: ['query', 'provider'],
    readGlobal: ['memory.providers', 'memory.recent'],
    readSpace: ['memory.search', 'memory.linked'],
    actionGlobal: ['module.memory.attach'],
    actionSpace: ['module.memory.open'],
    required_read_models: ['memory'],
    secondaryGlobal: ['memory-resource'],
    secondarySpace: ['memory-resource', 'work-item'],
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
    readSpace: ['space.projects'],
    actionGlobal: ['module.settings.open-adapter'],
    actionSpace: ['module.settings.configure-space'],
    required_read_models: ['settings'],
    // A task's card opens over the section, and the address names it.
    secondaryGlobal: ['work-item'],
    secondarySpace: ['work-item'],
    sse_subscriptions: [],
    supported_entity_kinds: ['project', 'work-item'],
    feature_capabilities: ['settings.configure'],
  }),
])
