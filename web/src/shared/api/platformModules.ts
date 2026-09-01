/**
 * Explicitly non-authoritative manifests for transport/offline recovery only.
 *
 * Normal routing, navigation, and module state validate the persisted server
 * registrations instead. Importing this table is an explicit offline choice.
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
    allowed_keys: ['query', 'view', 'status'],
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
    module_id: 'sessions',
    navigation_group: 'work',
    title_key: 'platform.modules.sessions',
    icon_key: 'activity',
    allowed_keys: ['query', 'view'],
    readGlobal: ['sessions.fleet', 'sessions.attention', 'sessions.unlinked'],
    readProject: ['sessions.project-linked', 'sessions.attention'],
    actionGlobal: ['module.sessions.attach-orphan'],
    actionProject: ['module.sessions.open'],
    required_read_models: ['sessions', 'session-links'],
    secondaryGlobal: ['execution', 'session'],
    secondaryProject: [],
    sse_subscriptions: ['sessions.changed'],
    supported_entity_kinds: ['project', 'execution', 'session', 'work-item'],
    feature_capabilities: ['session.observe'],
  }),
  MODULE({
    module_id: 'analytics',
    navigation_group: 'understand',
    title_key: 'platform.modules.analytics',
    icon_key: 'chart-no-axes-combined',
    allowed_keys: ['query', 'metric', 'date_from', 'date_to'],
    readGlobal: ['analytics.portfolio', 'analytics.compare'],
    readProject: ['analytics.project', 'analytics.sources'],
    actionGlobal: ['module.analytics.drill-down'],
    actionProject: ['module.analytics.open-source'],
    required_read_models: ['analytics'],
    secondaryGlobal: [],
    secondaryProject: ['planning-space', 'work-item', 'artifact'],
    sse_subscriptions: ['analytics.changed'],
    supported_entity_kinds: [
      'project',
      'planning-space',
      'work-item',
      'execution',
      'session',
      'artifact',
    ],
    feature_capabilities: ['telemetry.query'],
  }),
  MODULE({
    module_id: 'improvements',
    navigation_group: 'understand',
    title_key: 'platform.modules.improvements',
    icon_key: 'sparkles',
    allowed_keys: ['query', 'status'],
    readGlobal: ['improvements.cross-scope', 'improvements.unassigned'],
    readProject: [],
    actionGlobal: ['module.improvements.open'],
    actionProject: [],
    required_read_models: ['improvements'],
    secondaryGlobal: ['work-item', 'improvement-case'],
    secondaryProject: [],
    sse_subscriptions: ['improvements.changed'],
    supported_entity_kinds: ['project', 'work-item', 'improvement-case'],
    feature_capabilities: [],
    project_supported_states: ['unavailable'],
    project_unsupported_reason: 'improvements_project_scope_unsupported',
    project_secondary_behavior: 'unavailable',
  }),
  MODULE({
    module_id: 'skills',
    navigation_group: 'capabilities',
    title_key: 'platform.modules.skills',
    icon_key: 'key-round',
    allowed_keys: ['query', 'status', 'view'],
    readGlobal: ['skills.catalog', 'skills.assignments'],
    readProject: ['skills.applicability', 'skills.activation'],
    actionGlobal: ['module.skills.assign'],
    actionProject: ['module.skills.activate'],
    required_read_models: ['skills'],
    secondaryGlobal: ['skill'],
    secondaryProject: ['skill'],
    sse_subscriptions: ['skills.changed'],
    supported_entity_kinds: ['project', 'skill', 'registry'],
    feature_capabilities: ['skills.catalog', 'skills.activate'],
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
    readGlobal: [
      'registry.modules',
      'registry.adapters',
      'registry.services',
      'registry.connections',
      'registry.grants',
    ],
    readProject: [
      'project.assignments',
      'project.connections',
      'project.grants',
      'project.bindings',
    ],
    actionGlobal: ['module.settings.open-adapter'],
    actionProject: ['module.settings.configure-project'],
    required_read_models: ['registry', 'settings'],
    secondaryGlobal: ['connection', 'registry'],
    secondaryProject: ['connection', 'registry'],
    sse_subscriptions: ['registry.changed'],
    supported_entity_kinds: ['project', 'service', 'connection', 'registry'],
    feature_capabilities: ['settings.configure'],
  }),
])
