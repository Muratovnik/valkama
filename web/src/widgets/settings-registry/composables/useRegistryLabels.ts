/**
 * How the registry reads: every displayed line derived from a registry record.
 *
 * All twenty are derivations, not markup, so they live here rather than in the
 * component that shows them. They are a composable rather than a plain module
 * because each one reads the translator, and a module would have to take it as an
 * argument at every one of the thirty call sites in the template.
 */

import { useI18n } from 'vue-i18n'

import type {
  PlatformRegistryReady,
  RegistryAssignment,
  RegistryConnection,
  RegistryGrant,
} from '@/shared/api/platformApiTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'

function serviceIdentity(owner: string, service: string): string {
  return `${owner}/${service}`
}

/** A package reads as who published it, at which version. */
function packageSubtitle(item: PlatformRegistryReady['packages'][number]): string {
  return `${item.publisher_id} · ${item.version}`
}

/** A core binding reads as the adapter and the connection it points at. */
function bindingSubtitle(binding: PlatformRegistryReady['core_ref_bindings'][number]): string {
  return `${binding.adapter_lineage_id} · ${binding.connection_id}`
}

export function useRegistryLabels() {
  // `t` carries the file, so it is destructured. `te` and `d` are reached
  // through the composer: vue-i18n declares them as method signatures, which
  // is what `unbound-method` objects to, and each has one call site. The rule
  // only fires here because oxlint's type-aware pass reads `.ts` and not
  // `.vue`, where the same destructure is written in two components.
  const i18n = useI18n()
  const { t } = i18n

  function named(key: string, fallback: string): string {
    return i18n.te(key) ? t(key) : fallback
  }

  /**
   * A resolver reason is an identifier for the Kernel, not a sentence for the
   * reader. An unknown one reads as the plain refusal rather than putting
   * `connection-unhealthy` on the screen, which is what shipped.
   */
  function reasonLabel(reason: string): string {
    return named(`platform.registry.reasons.${reason}`, t('platform.registry.unavailable'))
  }

  function scopeLabel(scope: OperatingScope): string {
    return scope.kind === 'global' ? t('platform.scope.global') : scope.project_ref.project_id
  }

  function assignmentScopeLabel(scope: RegistryAssignment['scope']): string {
    return scope.kind === 'installation' ? t('platform.scope.global') : scope.project_id
  }

  function serviceTitleFor(connection: RegistryConnection, payload: PlatformRegistryReady): string {
    const ref = connection.connection_ref.service_ref
    const match = payload.services.find(
      (service) =>
        service.service_ref.owner_id === ref.owner_id &&
        service.service_ref.service_id === ref.service_id,
    )
    return match ? named(match.title_key, match.service_ref.service_id) : ref.service_id
  }

  function adapterTitleFor(lineage: string, payload: PlatformRegistryReady): string {
    const match = payload.adapters.find((adapter) => adapter.adapter_lineage_id === lineage)
    return match ? named(match.title_key, match.adapter_id) : lineage
  }

  function instanceLabel(connection: RegistryConnection): string {
    return connection.connection_ref.connection_id === 'singleton'
      ? t('platform.registry.localInstance')
      : connection.connection_ref.connection_id
  }

  /** A service's identity line: who owns it, and what type it is. */
  function serviceSubtitle(service: PlatformRegistryReady['services'][number]): string {
    const identity = serviceIdentity(service.service_ref.owner_id, service.service_ref.service_id)
    return `${identity} · ${service.service_type}`
  }

  /** A connection reads as the service it reaches, then which instance of it. */
  function connectionTitle(connection: RegistryConnection, payload: PlatformRegistryReady): string {
    return `${serviceTitleFor(connection, payload)} · ${instanceLabel(connection)}`
  }

  /** Under that, the adapter it runs over and the scope it applies in. */
  function connectionSubtitle(
    connection: RegistryConnection,
    payload: PlatformRegistryReady,
  ): string {
    const adapter = adapterTitleFor(connection.connection_ref.adapter_lineage_id, payload)
    return `${adapter} · ${scopeLabel(connection.applicability)}`
  }

  /** An assignment is identified by its id and the scope it holds in. */
  function assignmentSubtitle(assignment: RegistryAssignment): string {
    return `${assignment.assignment_id} · ${assignmentScopeLabel(assignment.scope)}`
  }

  /** A grant likewise. */
  function grantSubtitle(grant: RegistryGrant): string {
    return `${grant.grant_id} · ${scopeLabel(grant.applicability)}`
  }

  // The facts under each identity, built here rather than in the template: a
  // definition list is a list of label/value pairs, and reading it as one is
  // easier than reading eight `<dt>`/`<dd>` pairs spelled out in markup.
  function adapterDetails(adapter: PlatformRegistryReady['adapters'][number]) {
    return [
      { label: t('platform.registry.package'), value: adapter.package_id },
      { label: t('platform.registry.owner'), value: adapter.owner_id },
    ]
  }

  function serviceDetails(service: PlatformRegistryReady['services'][number]) {
    return [
      { label: t('platform.registry.configurationOwner'), value: service.configuration_owner },
      {
        label: t('platform.registry.directRead'),
        value: service.direct_read ? t('platform.registry.allowed') : t('platform.registry.denied'),
      },
    ]
  }

  function connectionDetails(connection: RegistryConnection) {
    return [
      { label: t('platform.registry.transport'), value: connection.transport },
      { label: t('platform.registry.capabilities'), value: connection.capabilities.join(', ') },
      {
        label: t('platform.registry.state'),
        value: t(`platform.registry.lifecycle.${connection.state}`),
      },
      { label: t('platform.registry.scope'), value: scopeLabel(connection.scope) },
      {
        label: t('platform.registry.lastChecked'),
        value: connection.last_checked_at
          ? i18n.d(new Date(connection.last_checked_at), 'activity')
          : t('platform.registry.notChecked'),
      },
    ]
  }

  function assignmentDetails(assignment: RegistryAssignment) {
    return [
      {
        label: t('platform.registry.connections'),
        value: String(assignment.connection_ids.length),
      },
      { label: t('platform.registry.owner'), value: assignment.changed_by },
    ]
  }

  function grantDetails(grant: RegistryGrant) {
    return [
      { label: t('platform.registry.entities'), value: grant.entity_kinds.join(', ') },
      {
        label: t('platform.registry.grantedAt'),
        value: i18n.d(new Date(grant.granted_at), 'activity'),
      },
    ]
  }

  function packageDetails(item: PlatformRegistryReady['packages'][number]) {
    return [{ label: t('platform.registry.execution'), value: item.execution }]
  }

  return {
    adapterDetails,
    adapterTitleFor,
    assignmentDetails,
    assignmentSubtitle,
    bindingSubtitle,
    connectionDetails,
    connectionSubtitle,
    connectionTitle,
    grantDetails,
    grantSubtitle,
    instanceLabel,
    named,
    reasonLabel,
    packageDetails,
    packageSubtitle,
    scopeLabel,
    serviceDetails,
    serviceIdentity,
    serviceSubtitle,
    serviceTitleFor,
  }
}
