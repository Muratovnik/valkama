"""Provider-owned reference adapters behind one small public contract.

The Platform never reads provider content.  Providers may validate a stable pointer,
report bounded health, and translate an already-linked pointer to an allowlisted
open target.  They cannot return HTML, credentials, paths, search results, or a
provider body.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from .. import git_worktrees, runner
from ..analytics import LocalJournalUsageProvider
from ..executions import drivers
from ..skills import skills_inventory
from . import installed
from .adapters import ProviderError as ProviderError
from .adapters import ProviderUnavailableError as ProviderUnavailableError
from .contracts import validate_adapter_resource_ref, validate_open_target
from .transports import HttpTransport, TransportError

#: A probe of a built-in reaches the local filesystem and nothing else — a
#: `which` lookup, or up to thirty-two `exists` checks. No socket and no child
#: process, which is why one number covers every implementation here.
_LOCAL_PROBE_CEILING_MS = 250


def _diagnostic(code: str, message: str) -> dict:
    return {"code": code, "message": message[:512]}


def _action(owner_id: str, name: str) -> dict:
    return {
        "interface_version": "valkama-actions",
        "action_id": f"adapter.{owner_id}.{name}",
        "owner_kind": "adapter",
        "owner_id": owner_id,
        "input_schema_id": f"reference.{name}.v1",
        "target_kind": "adapter-resource",
        "invocation_scope_schema": "project",
    }


@dataclass(frozen=True)
class ReferenceProvider:
    adapter_id: str
    adapter_lineage_id: str
    service_owner_id: str
    service_id: str
    service_type: str
    resource_type: str
    package_id: str
    publisher_id: str
    title_key: str
    open_schemes: tuple[str, ...]
    #: Reported by the provider rather than looked up by the catalogue. The
    #: lookup existed, keyed by lineage id, and no adapter the Kernel did not
    #: already know could appear in it — which is the thing §18.2 forbids.
    capabilities: tuple[str, ...] = ()
    #: Where this provider is reached, when it is reached over the wire. The
    #: address used to be a class constant on the one provider that had one,
    #: which meant the only configurable thing about it was nothing.
    #:
    #: Not `transport`: that name is already a display label on this class
    #: (`loopback-http`, `built-in`) that the Connections list reads, and one
    #: name for a label and an address is how a reader ends up with neither.
    endpoint: HttpTransport | None = None
    core_ref_kinds: tuple[str, ...] = ()

    @property
    def service_ref(self) -> dict:
        return {"owner_id": self.service_owner_id, "service_id": self.service_id}

    @property
    def connection_ref(self) -> dict:
        return {
            "service_ref": self.service_ref,
            "adapter_lineage_id": self.adapter_lineage_id,
            "connection_id": "singleton",
        }

    @property
    def transport(self) -> str:
        return "loopback-http" if self.open_schemes != ("https",) else "built-in"

    @property
    def probe_ceiling_ms(self) -> int:
        """The endpoint's own timeout, or nothing when the probe makes no call."""

        return 0 if self.endpoint is None else self.endpoint.timeout_ms

    def service_descriptor(self) -> dict:
        return {
            "service_ref": self.service_ref,
            "service_type": self.service_type,
            "title_key": self.title_key,
            "configuration_owner": self.service_owner_id,
            "trust_owner": self.service_owner_id,
            "discovery_provenance": "provider-owned",
            "state": "registered",
            "direct_read": False,
        }

    def manifest(self) -> dict:
        placeholder_actions = [
            _action(self.adapter_id, "relation.attach"),
            _action(self.adapter_id, "relation.remove"),
            _action(self.adapter_id, "resource.open"),
        ]
        return {
            "contract_version": "valkama-adapter",
            "adapter_id": self.adapter_id,
            "version": "1.0.0",
            "title_key": self.title_key,
            "package_id": self.package_id,
            "publisher_id": self.publisher_id,
            "owner_id": self.publisher_id,
            "configuration_owner": self.service_owner_id,
            "trust_owner": self.service_owner_id,
            "execution": "local_service" if self.open_schemes != ("https",) else "built_in",
            "supported_service_types": [self.service_type],
            # Its own capability ids, not the three trait words this used to
            # carry. Those are legacy — `_LEGACY_REFERENCE_CAPABILITY_SET` in
            # the Kernel exists to migrate a store away from them — and the
            # Kernel was overwriting this field at registration to repair it.
            # A declaration that has to be patched by its reader is not one.
            "capabilities": list(self.capabilities),
            "consumes": ["card"],
            "contributions": [
                {
                    "interface_version": "valkama-contributions",
                    "contribution_id": f"{self.adapter_id}.card-relations",
                    "owner_kind": "adapter",
                    "owner_id": self.adapter_id,
                    "slot": "entity-action",
                    "entity_kinds": ["card"],
                    "content": {
                        "kind": "status",
                        "status": "ready",
                        "label": "Reference actions available",
                    },
                    "actions": placeholder_actions,
                }
            ],
            "permissions": [
                {
                    "permission_id": "relation.attach",
                    "connection_mode": "required",
                    "entity_kinds": ["adapter-resource"],
                    "target_kinds": [self.resource_type],
                },
                {
                    "permission_id": "relation.remove",
                    "connection_mode": "required",
                    "entity_kinds": ["adapter-resource"],
                    "target_kinds": [self.resource_type],
                },
                {
                    "permission_id": "resource.open",
                    "connection_mode": "required",
                    "entity_kinds": ["adapter-resource"],
                    "target_kinds": [self.resource_type],
                },
            ],
            "health_contract": {
                "timeout_ms": 500,
                "max_payload_bytes": 131072,
                "states": ["ready", "degraded", "unavailable", "not-observed"],
            },
            "direct_read": False,
        }

    def package_descriptor(self) -> dict:
        execution = "local_service" if self.open_schemes != ("https",) else "built_in"
        return {
            "package_id": self.package_id,
            "publisher_id": self.publisher_id,
            "version": "1.0.0",
            "execution": execution,
            "provenance": "provider-owned" if execution != "built_in" else "platform-built-in",
        }

    def connection(self, scope: dict | None = None, *, observe: bool = True) -> dict:
        state, diagnostics = self.health() if observe else ("not-observed", None)
        result = {
            "connection_ref": self.connection_ref,
            "applicability": scope or {"kind": "global"},
            "configuration_owner": self.service_owner_id,
            "trust_owner": self.service_owner_id,
            # Discovery can report identity and health, but never awards its
            # own trust.  Only the persisted owner lifecycle may promote this.
            "trust": "unknown",
            "health": state,
            "state": "registered",
        }
        if diagnostics is not None:
            result["diagnostics"] = diagnostics
        return result

    def action_ref(self, operation: str) -> dict:
        names = {
            "attach": "relation.attach",
            "remove": "relation.remove",
            "open": "resource.open",
        }
        if operation not in names:
            raise ProviderError("unsupported reference operation")
        return _action(self.adapter_lineage_id, names[operation])

    def permission_for(self, action_id: str) -> str:
        for operation, permission in (
            ("attach", "relation.attach"),
            ("remove", "relation.remove"),
            ("open", "resource.open"),
        ):
            if self.action_ref(operation)["action_id"] == action_id:
                return permission
        raise ProviderError("ActionRef is not owned by this provider")

    def validate_resource(self, value: dict) -> dict:
        resource = validate_adapter_resource_ref(value)
        if resource["connection_ref"] != self.connection_ref:
            raise ProviderError("resource ConnectionRef is not owned by this provider")
        if resource["resource_type"] != self.resource_type:
            raise ProviderError("resource type is not supported by this provider")
        return resource

    def health(self) -> tuple[str, dict | None]:
        return "ready", None

    def dispatch(self, capability_id: str, payload: dict) -> dict:
        """The two calls a pointer service answers, moved off the catalogue.

        They were a pair of `if` branches in `ProviderCatalog.dispatch`, which
        meant the Kernel knew this family by name. Here they are the provider's
        own business and an external pointer service can answer the same two
        without the catalogue learning anything.
        """

        if capability_id not in self.capabilities or not isinstance(payload, dict):
            raise ProviderError("provider does not implement the requested capability")
        if capability_id.endswith(".health"):
            health, diagnostics = self.health()
            result = {
                "result_type": "health",
                "provider": self.adapter_id,
                "connection_ref": self.connection_ref,
                "health": health,
            }
            if diagnostics is not None:
                result["diagnostics"] = diagnostics
            return result
        resource_ref = payload.get("resource_ref")
        if not isinstance(resource_ref, dict):
            raise ProviderError(f"{capability_id} requires resource_ref")
        return {
            "result_type": "memory-resource",
            "provider": self.adapter_id,
            "connection_ref": self.connection_ref,
            "target": self.open_target(resource_ref),
        }

    def open_target(self, resource_ref: dict) -> dict:
        raise NotImplementedError


class AgentMemoryReferenceProvider(ReferenceProvider):
    """The first provider whose address is configuration rather than source.

    Its URL was a class constant and its health hand-rolled the bounded call
    that `transports` now owns. Nothing about the behaviour changed — same
    address, same 350 ms, same 128 KB — but the address is in the manifest, so
    this is the built-in that demonstrates the external contract instead of
    describing it.
    """

    def __init__(self):
        super().__init__(
            adapter_id="agentmemory-reference",
            adapter_lineage_id="agentmemory-reference-v1",
            service_owner_id="agentmemory",
            service_id="local-reference-service",
            service_type="knowledge-reference",
            resource_type="memory",
            package_id="agentmemory.reference-adapter",
            publisher_id="agentmemory",
            title_key="platform.adapters.agentmemory-reference",
            open_schemes=("agentmemory",),
            capabilities=("memory.open", "memory.health"),
            endpoint=HttpTransport(
                base_url="http://127.0.0.1:3111",
                timeout_ms=350,
                max_payload_bytes=128 * 1024,
            ),
            core_ref_kinds=("memory",),
        )

    def health(self) -> tuple[str, dict | None]:
        if self.endpoint is None:
            return "not-observed", None
        try:
            payload = self.endpoint.get_json("/agentmemory/health")
        except TransportError:
            # The transport's own code is deliberately not surfaced. It names
            # how the call failed, and this reports what that means for the
            # capability; a reader of a Connection wants the second.
            return "unavailable", {
                "code": "provider_unavailable",
                "message": "Reference service health is unavailable",
            }
        detail = payload.get("health")
        connection = detail.get("connectionState") if isinstance(detail, dict) else None
        if str(payload.get("status", "")).lower() == "healthy" and connection == "connected":
            return "ready", None
        return "degraded", {
            "code": "provider_degraded",
            "message": "Reference service reported degraded health",
        }

    def open_target(self, resource_ref: dict) -> dict:
        resource = self.validate_resource(resource_ref)
        target = {
            "target_kind": "external-resource",
            "uri": f"agentmemory://memory/{quote(resource['external_id'], safe='')}",
            "connection_ref": self.connection_ref,
        }
        return validate_open_target(
            target, allowed_kinds={"external-resource"}, allowed_schemes=self.open_schemes
        )


class NotesReferenceProvider(ReferenceProvider):
    def __init__(self):
        super().__init__(
            adapter_id="notes-reference",
            adapter_lineage_id="notes-reference-v1",
            service_owner_id="valkama-notes",
            service_id="in-memory-reference-service",
            service_type="notes-reference",
            resource_type="note",
            package_id="valkama.notes-reference-adapter",
            publisher_id="valkama-notes",
            title_key="platform.adapters.notes-reference",
            open_schemes=("https",),
            capabilities=("memory.open",),
        )

    def open_target(self, resource_ref: dict) -> dict:
        resource = self.validate_resource(resource_ref)
        if resource["external_id"].startswith("fail-"):
            raise ProviderUnavailableError(
                "Note provider deliberately reported an unavailable pointer"
            )
        target = {
            "target_kind": "external-resource",
            "uri": f"https://notes.invalid/resource/{quote(resource['external_id'], safe='')}",
            "connection_ref": self.connection_ref,
        }
        return validate_open_target(
            target, allowed_kinds={"external-resource"}, allowed_schemes=self.open_schemes
        )


@dataclass(frozen=True)
class BuiltinCapabilityProvider:
    """A bounded adapter over one existing Valkama-owned implementation."""

    adapter_id: str
    adapter_lineage_id: str
    service_owner_id: str
    service_id: str
    service_type: str
    title_key: str
    package_id: str
    capabilities: tuple[str, ...]
    transport: str
    implementation: str
    client: str = ""
    core_ref_kinds: tuple[str, ...] = ()

    @property
    def service_ref(self) -> dict:
        return {"owner_id": self.service_owner_id, "service_id": self.service_id}

    @property
    def connection_ref(self) -> dict:
        return {
            "service_ref": self.service_ref,
            "adapter_lineage_id": self.adapter_lineage_id,
            "connection_id": "local",
        }

    @property
    def probe_ceiling_ms(self) -> int:
        return _LOCAL_PROBE_CEILING_MS

    def service_descriptor(self) -> dict:
        return {
            "service_ref": self.service_ref,
            "service_type": self.service_type,
            "title_key": self.title_key,
            "configuration_owner": self.service_owner_id,
            "trust_owner": self.service_owner_id,
            "discovery_provenance": "platform-built-in",
            "state": "registered",
            "direct_read": False,
        }

    def manifest(self) -> dict:
        return {
            "contract_version": "valkama-adapter",
            "adapter_id": self.adapter_id,
            "version": "1.0.0",
            "title_key": self.title_key,
            "package_id": self.package_id,
            "publisher_id": "valkama",
            "owner_id": "valkama",
            "configuration_owner": self.service_owner_id,
            "trust_owner": self.service_owner_id,
            "execution": "local_process" if self.transport == "local-process" else "built_in",
            "supported_service_types": [self.service_type],
            "capabilities": list(self.capabilities),
            "consumes": [],
            "contributions": [],
            "permissions": [
                {
                    "permission_id": capability,
                    "connection_mode": "required",
                    "entity_kinds": ["registry"],
                }
                for capability in self.capabilities
            ],
            "health_contract": {
                "timeout_ms": 500,
                "max_payload_bytes": 8192,
                "states": ["ready", "degraded", "unavailable", "not-observed"],
            },
            "direct_read": False,
        }

    def package_descriptor(self) -> dict:
        return {
            "package_id": self.package_id,
            "publisher_id": "valkama",
            "version": "1.0.0",
            "execution": "local_process" if self.transport == "local-process" else "built_in",
            "provenance": "platform-built-in",
        }

    def health(self) -> tuple[str, dict | None]:
        try:
            if self.implementation == "execution":
                runner.client_binary(self.client)
            elif self.implementation == "telemetry":
                journal = LocalJournalUsageProvider()
                roots = journal.claude_roots if self.client == "claude" else journal.codex_roots
                if not roots or not any(Path(root).exists() for root in roots[:32]):
                    return "unavailable", _diagnostic(
                        "source_not_configured", "No configured local telemetry source was found"
                    )
            elif self.implementation == "git" and shutil.which("git") is None:
                return "unavailable", _diagnostic(
                    "provider_unavailable", "Git is not available on PATH"
                )
            return "ready", None
        except (OSError, runner.LaunchError):
            return "unavailable", _diagnostic(
                "provider_unavailable", "The configured local provider is unavailable"
            )

    def connection(self, scope: dict | None = None, *, observe: bool = True) -> dict:
        health, diagnostics = self.health() if observe else ("not-observed", None)
        record = {
            "connection_ref": self.connection_ref,
            "applicability": scope or {"kind": "global"},
            "configuration_owner": self.service_owner_id,
            "trust_owner": self.service_owner_id,
            "trust": "unknown",
            "health": health,
            "state": "registered",
        }
        if diagnostics is not None:
            record["diagnostics"] = diagnostics
        return record

    def dispatch(self, capability_id: str, payload: dict) -> dict:
        if capability_id not in self.capabilities or not isinstance(payload, dict):
            raise ProviderError("provider does not implement the requested capability")
        if self.implementation == "telemetry":
            session_id = payload.get("session_id")
            if not isinstance(session_id, str) or not session_id:
                raise ProviderError("telemetry query requires session_id")
            observed = LocalJournalUsageProvider().usage_for_session(
                session_id,
                client=self.client,
                path=payload.get("path"),
                as_of=payload.get("as_of"),
                date_from=payload.get("date_from"),
                date_to=payload.get("date_to"),
            )
            return {
                "result_type": "telemetry",
                "provider": self.adapter_id,
                "connection_ref": self.connection_ref,
                "observation": observed,
            }
        if self.implementation == "execution":
            work_item = payload.get("work_item")
            if not isinstance(work_item, str) or not work_item:
                raise ProviderError("execution operation requires a work item reference")
            result: object
            if capability_id == "execution.stop":
                result = runner.RUNNER.stop(work_item)
            elif capability_id == "session.observe":
                result = [
                    item for item in runner.RUNNER.running() if item.get("client") == self.client
                ]
            else:
                launch = dict(payload.get("launch") or {})
                launch["client"] = self.client
                result = runner.RUNNER.launch(
                    work_item,
                    launch,
                    str(payload.get("planning_space") or ""),
                    str(payload.get("resume_session_id") or "")
                    if capability_id == "execution.resume"
                    else "",
                )
            return {
                "result_type": "session" if capability_id == "session.observe" else "execution",
                "provider": self.adapter_id,
                "connection_ref": self.connection_ref,
                "value": result,
            }
        if self.implementation == "skills":
            if capability_id == "skills.catalog":
                result = skills_inventory.inventory_payload(
                    user_home=payload.get("user_home"),
                )
            else:
                activation_key = payload.get("key")
                if not isinstance(activation_key, str) or not activation_key:
                    raise ProviderError("skills activation requires key")
                result = skills_inventory.update_skill_activation(
                    key=activation_key,
                    client=self.client,
                    enabled=payload.get("enabled"),
                    user_home=payload.get("user_home"),
                )
            return {
                "result_type": "skill",
                "provider": self.adapter_id,
                "connection_ref": self.connection_ref,
                "catalog": result,
            }
        if self.implementation == "git":
            repo = payload.get("repo")
            git_ref = payload.get("git_ref", "HEAD")
            if not isinstance(repo, str) or not repo or not isinstance(git_ref, str) or not git_ref:
                raise ProviderError("artifact inspection requires repo and git_ref")
            resolved = git_worktrees.git_text(
                repo, "rev-parse", "--verify", f"{git_ref}^{{commit}}"
            )
            if resolved.returncode:
                raise ProviderUnavailableError("Git could not resolve the requested artifact")
            return {
                "result_type": "artifact",
                "provider": self.adapter_id,
                "connection_ref": self.connection_ref,
                "artifact": {"kind": "git-commit", "artifact_id": resolved.stdout.strip()},
            }
        raise ProviderError("provider operation is not dispatchable")


#: Who publishes each agent client, and what the registry calls its service.
#: The adapter id itself comes from the driver, so the registry that publishes
#: it and the execution row that records which adapter ran cannot disagree.
_EXECUTION_VENDORS = {
    "claude": (
        "anthropic",
        "claude-code",
        "platform.integrations.claudeCode",
        "valkama.claude-code",
    ),
    "codex": ("openai", "codex", "platform.integrations.codex", "valkama.codex"),
}


def _execution_providers() -> tuple[BuiltinCapabilityProvider, ...]:
    """One registered adapter per driver, built from the driver's own answer."""

    capabilities = ("execution.launch", "execution.resume", "execution.stop", "session.observe")
    providers = []
    for driver in drivers.all_capabilities():
        owner, service_id, title_key, package_id = _EXECUTION_VENDORS[driver.client]
        providers.append(
            BuiltinCapabilityProvider(
                driver.adapter_lineage_id,
                driver.adapter_lineage_id,
                owner,
                service_id,
                "agent-execution",
                title_key,
                package_id,
                capabilities,
                "local-process",
                "execution",
                driver.client,
            )
        )
    return tuple(providers)


def _builtin_capability_providers() -> tuple[BuiltinCapabilityProvider, ...]:
    return (
        *_execution_providers(),
        BuiltinCapabilityProvider(
            "claude-journal-telemetry",
            "claude-journal-telemetry",
            "anthropic",
            "claude-journal",
            "local-telemetry",
            "platform.integrations.claudeJournal",
            "valkama.claude-journal",
            ("telemetry.query",),
            "local-file",
            "telemetry",
            "claude",
        ),
        BuiltinCapabilityProvider(
            "codex-rollout-telemetry",
            "codex-rollout-telemetry",
            "openai",
            "codex-rollout",
            "local-telemetry",
            "platform.integrations.codexRollout",
            "valkama.codex-rollout",
            ("telemetry.query",),
            "local-file",
            "telemetry",
            "codex",
        ),
        BuiltinCapabilityProvider(
            "codex-skills",
            "codex-skills",
            "openai",
            "codex-skills",
            "skills-provider",
            "platform.integrations.codexSkills",
            "valkama.codex-skills",
            ("skills.catalog", "skills.activate"),
            "local-process",
            "skills",
            "codex",
        ),
        BuiltinCapabilityProvider(
            "claude-skills",
            "claude-skills",
            "anthropic",
            "claude-skills",
            "skills-provider",
            "platform.integrations.claudeSkills",
            "valkama.claude-skills",
            ("skills.catalog", "skills.activate"),
            "local-file",
            "skills",
            "claude",
        ),
        BuiltinCapabilityProvider(
            "git-artifacts",
            "git-artifacts",
            "git",
            "local-git",
            "artifact-provider",
            "platform.integrations.git",
            "valkama.git-artifacts",
            ("artifact.inspect",),
            "local-process",
            "git",
        ),
    )


class ProviderCatalog:
    """Dispatch providers only by the validated ConnectionRef contract."""

    def __init__(self, providers=None):
        self._explicit = providers is not None
        values = list(
            providers
            if providers is not None
            else (
                *_builtin_capability_providers(),
                AgentMemoryReferenceProvider(),
                NotesReferenceProvider(),
                # Declared in files rather than in code, and otherwise the same
                # thing: they seed, register and answer through the identical
                # path. An external adapter that took a second route would be a
                # second class with a second set of defects.
                *installed.installed_providers(),
            )
        )
        self._providers = {self._key(provider.connection_ref): provider for provider in values}
        if len(self._providers) != len(values):
            raise ProviderError("duplicate provider ConnectionRef")

    @staticmethod
    def _key(connection_ref: dict) -> tuple[str, str, str, str]:
        service = connection_ref["service_ref"]
        return (
            service["owner_id"],
            service["service_id"],
            connection_ref["adapter_lineage_id"],
            connection_ref["connection_id"],
        )

    def all(self) -> list[ReferenceProvider | BuiltinCapabilityProvider]:
        return list(self._providers.values())

    def seed_providers(self) -> list[ReferenceProvider | BuiltinCapabilityProvider]:
        if self._explicit:
            return self.all()
        return [
            provider
            for provider in self.all()
            if provider.adapter_lineage_id != "notes-reference-v1"
        ]

    @staticmethod
    def capabilities_for(provider) -> list[str]:
        """What this provider says it answers.

        It used to be a table here for one family and a field for the other.
        A table in the Kernel cannot describe an adapter the Kernel has not met.
        """

        return list(provider.capabilities)

    def installation_defaults(self) -> dict[str, dict]:
        by_lineage = {provider.adapter_lineage_id: provider for provider in self.all()}
        mapping = {
            "execution.launch": "codex-execution",
            "execution.resume": "codex-execution",
            "execution.stop": "codex-execution",
            "session.observe": "codex-execution",
            "telemetry.query": "codex-rollout-telemetry",
            "skills.catalog": "codex-skills",
            "skills.activate": "codex-skills",
            "memory.open": "agentmemory-reference-v1",
            "memory.health": "agentmemory-reference-v1",
            "artifact.inspect": "git-artifacts",
        }
        return {
            capability: by_lineage[lineage].connection_ref
            for capability, lineage in mapping.items()
            if lineage in by_lineage
        }

    def dispatch(self, connection_ref: dict, capability_id: str, payload: dict) -> dict:
        """Route by ConnectionRef and let the provider answer.

        The branch on provider class that used to live here is the reason an
        external adapter could not be added without editing the Kernel. Routing
        is the catalogue's job; answering is not.
        """

        return self.resolve_connection(connection_ref).dispatch(capability_id, payload)

    def resolve(self, resource_ref: dict) -> ReferenceProvider:
        resource = validate_adapter_resource_ref(resource_ref)
        provider = self._providers.get(self._key(resource["connection_ref"]))
        if provider is None:
            raise ProviderUnavailableError("resource provider is not registered")
        provider.validate_resource(resource)
        return provider

    def resolve_connection(self, connection_ref: dict) -> ReferenceProvider:
        provider = self._providers.get(self._key(connection_ref))
        if provider is None:
            raise ProviderUnavailableError("ConnectionRef provider is not registered")
        return provider


__all__ = [
    "AgentMemoryReferenceProvider",
    "BuiltinCapabilityProvider",
    "NotesReferenceProvider",
    "ProviderCatalog",
    "ProviderError",
    "ProviderUnavailableError",
    "ReferenceProvider",
]
