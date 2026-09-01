"""Provider-neutral in-memory registries for the Valkama kernel.

The registry is intentionally process-local and throwaway.  It models identity
and authorization semantics without opening a live database or loading adapter
code.  Removed identities become tombstones, and every security-sensitive
lookup fails closed when the exact owner/scope/connection cannot be proven.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

from .capabilities import resolve_capability as resolve_capability_assignment
from .contracts import (
    ContractError,
    planning_space_ref,
    planning_work_item_ref,
    validate_action_input_descriptor,
    validate_action_ref,
    validate_adapter_manifest,
    validate_assignment,
    validate_connection,
    validate_connection_ref,
    validate_contribution,
    validate_invocation_context,
    validate_module_manifest,
    validate_permission_grant,
    validate_service_descriptor,
    validate_service_ref,
)
from .scope import ProjectResourceBindingReader, ScopeError


class RegistryError(ContractError):
    pass


class DuplicateRegistrationError(RegistryError):
    pass


class TombstonedIdentityError(RegistryError):
    pass


class InvalidLineageError(RegistryError):
    pass


class ScopeMismatchError(RegistryError):
    pass


class MissingConnectionError(RegistryError):
    pass


class AmbiguousConnectionError(RegistryError):
    pass


class PermissionDeniedError(RegistryError):
    pass


class UndeclaredPermissionError(PermissionDeniedError):
    pass


class RevokedPermissionError(PermissionDeniedError):
    pass


class ActionCollisionError(RegistryError):
    pass


class ResolverCollisionError(RegistryError):
    pass


def _key(value):
    if isinstance(value, dict):
        return tuple(sorted((key, _key(child)) for key, child in value.items()))
    if isinstance(value, list):
        return tuple(_key(child) for child in value)
    return value


def _scope_key(scope):
    if scope["kind"] == "global":
        return ("global",)
    return ("project", scope["project_ref"]["project_id"])


def _scope_project(scope):
    return None if scope["kind"] == "global" else scope["project_ref"]["project_id"]


def _now():
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class PlatformRegistry:
    """Strict in-memory implementation of the Phase 0 registry contracts."""

    def __init__(self, *, scope_reader=None, lineage_factory=None):
        self.scope_reader = scope_reader or ProjectResourceBindingReader()
        self._lineage_factory = lineage_factory or (lambda: str(uuid4()))
        self.services: dict[tuple, dict] = {}
        self.service_tombstones: dict[tuple, dict] = {}
        self.adapters: dict[str, dict] = {}
        self.adapters_by_id: dict[str, str] = {}
        self.adapter_tombstones: dict[str, dict] = {}
        self.connections: dict[tuple, dict] = {}
        self.connection_tombstones: dict[tuple, dict] = {}
        self.assignments: dict[tuple[str, tuple], dict] = {}
        self.grants: dict[str, dict] = {}
        self.revoked_grants: dict[str, dict] = {}
        self.actions: dict[str, dict] = {}
        self.action_inputs: dict[str, dict] = {}
        self.contributions: dict[str, dict] = {}
        self.modules: dict[str, dict] = {}
        self.module_tombstones: set[str] = set()
        self.core_resolvers: dict[str, dict] = {}
        self.audit: list[dict] = []

    # -- Service lifecycle -------------------------------------------------

    def register_service(self, descriptor):
        service = validate_service_descriptor(descriptor)
        ref = service["service_ref"]
        key = _key(ref)
        if key in self.services:
            raise DuplicateRegistrationError("ServiceRef is already registered")
        if key in self.service_tombstones:
            raise TombstonedIdentityError("ServiceRef is tombstoned and cannot be taken over")
        if service["state"] == "tombstoned":
            raise RegistryError("new service cannot be registered as tombstoned")
        self.services[key] = deepcopy(service)
        self._event("service.registered", service_ref=ref)
        return deepcopy(service)

    def get_service(self, service_ref):
        ref = validate_service_ref(service_ref)
        record = self.services.get(_key(ref))
        if record is not None:
            return deepcopy(record)
        tombstone = self.service_tombstones.get(_key(ref))
        return deepcopy(tombstone) if tombstone is not None else None

    # -- Adapter lineage lifecycle ---------------------------------------

    def register_adapter(self, manifest):
        adapter = validate_adapter_manifest(manifest)
        adapter_id = adapter["adapter_id"]
        adapter_lineage_id = self._lineage_factory()
        if not isinstance(adapter_lineage_id, str) or not adapter_lineage_id:
            raise InvalidLineageError(
                "registry lineage_factory returned an invalid adapter_lineage_id"
            )
        old_lineage = self.adapters_by_id.get(adapter_id)
        if old_lineage is not None:
            raise DuplicateRegistrationError("adapter_id is already registered by another lineage")
        tombstones = [
            item
            for item in self.adapter_tombstones.values()
            if item.get("adapter_id") == adapter_id
        ]
        restoring_tombstone = False
        if tombstones:
            tombstone = tombstones[0]
            immutable_owner = ("adapter_id", "publisher_id", "owner_id", "package_id")
            if any(tombstone[key] != adapter[key] for key in immutable_owner):
                raise TombstonedIdentityError(
                    "adapter_id tombstone belongs to another immutable owner"
                )
            adapter_lineage_id = tombstone["adapter_lineage_id"]
            restoring_tombstone = True
        existing_lineage = self.adapters.get(adapter_lineage_id)
        if existing_lineage is not None:
            raise DuplicateRegistrationError("adapter lineage is already registered")
        if adapter_lineage_id in self.adapter_tombstones and not restoring_tombstone:
            raise TombstonedIdentityError("adapter lineage is tombstoned and cannot be taken over")
        adapter["adapter_lineage_id"] = adapter_lineage_id
        bound_contributions = [
            validate_contribution(
                self._bind_adapter_contribution(
                    item, adapter_id, adapter_lineage_id, adapter["version"]
                )
            )
            for item in adapter["contributions"]
        ]
        contribution_ids = [item["contribution_id"] for item in bound_contributions]
        if len(contribution_ids) != len(set(contribution_ids)):
            raise DuplicateRegistrationError("adapter manifest contains duplicate contribution_id")
        collision = next((item for item in contribution_ids if item in self.contributions), None)
        if collision is not None:
            raise DuplicateRegistrationError(f"contribution_id {collision!r} is already registered")
        bound_actions = [
            action for contribution in bound_contributions for action in contribution["actions"]
        ]
        action_ids = [item["action_id"] for item in bound_actions]
        if len(action_ids) != len(set(action_ids)):
            raise ActionCollisionError("adapter manifest contains duplicate ActionRef")
        action_collision = next((item for item in action_ids if item in self.actions), None)
        if action_collision is not None:
            raise ActionCollisionError(f"ActionRef {action_collision!r} is already registered")
        adapter["contributions"] = bound_contributions
        if restoring_tombstone:
            self.adapter_tombstones.pop(adapter_lineage_id, None)
        self.adapters[adapter_lineage_id] = deepcopy(adapter)
        self.adapters_by_id[adapter_id] = adapter_lineage_id
        for contribution in bound_contributions:
            self.contributions[contribution["contribution_id"]] = deepcopy(contribution)
        for action in bound_actions:
            self.actions[action["action_id"]] = deepcopy(action)
        self._event(
            "adapter.registered", adapter_lineage_id=adapter_lineage_id, adapter_id=adapter_id
        )
        return deepcopy(adapter)

    def remove_adapter(self, adapter_lineage_id):
        lineage = self._lineage(adapter_lineage_id)
        adapter = self.adapters.pop(lineage, None)
        if adapter is None:
            tombstone = self.adapter_tombstones.get(lineage)
            if tombstone is None:
                raise RegistryError("adapter lineage is not registered")
            return deepcopy(tombstone)
        self.adapters_by_id.pop(adapter["adapter_id"], None)
        for contribution in adapter["contributions"]:
            self.contributions.pop(contribution["contribution_id"], None)
            for action in contribution["actions"]:
                self.actions.pop(action["action_id"], None)
                self.action_inputs.pop(action["action_id"], None)
        tombstone = {
            "adapter_lineage_id": lineage,
            "adapter_id": adapter["adapter_id"],
            "owner_id": adapter["owner_id"],
            "package_id": adapter["package_id"],
            "publisher_id": adapter["publisher_id"],
            "adapter_version": adapter["version"],
            "state": "tombstoned",
            "removed_at": _now(),
        }
        self.adapter_tombstones[lineage] = tombstone
        self._event("adapter.removed", adapter_lineage_id=lineage, adapter_id=adapter["adapter_id"])
        return deepcopy(tombstone)

    def get_adapter(self, adapter_lineage_id):
        lineage = self._lineage(adapter_lineage_id)
        record = self.adapters.get(lineage)
        if record is not None:
            return deepcopy(record)
        tombstone = self.adapter_tombstones.get(lineage)
        return deepcopy(tombstone) if tombstone is not None else None

    # -- Connection lifecycle --------------------------------------------

    def register_connection(self, connection):
        record = validate_connection(connection)
        ref = record["connection_ref"]
        service_key = _key(ref["service_ref"])
        if service_key not in self.services:
            raise RegistryError("ConnectionRef references an unknown ServiceRef")
        lineage = ref["adapter_lineage_id"]
        adapter = self.adapters.get(lineage)
        if adapter is None:
            raise RegistryError("ConnectionRef references an unknown adapter lineage")
        if (
            adapter["supported_service_types"]
            and self.services[service_key]["service_type"] not in adapter["supported_service_types"]
        ):
            raise RegistryError("adapter manifest does not support the Service type")
        key = _key(ref)
        if key in self.connections:
            raise DuplicateRegistrationError("ConnectionRef is already registered")
        if key in self.connection_tombstones:
            raise TombstonedIdentityError("ConnectionRef is tombstoned and cannot be taken over")
        self.connections[key] = deepcopy(record)
        self._event("connection.registered", connection_ref=ref)
        return deepcopy(record)

    def remove_connection(self, connection_ref):
        ref = validate_connection_ref(connection_ref)
        key = _key(ref)
        record = self.connections.pop(key, None)
        if record is None:
            tombstone = self.connection_tombstones.get(key)
            if tombstone is None:
                raise RegistryError("ConnectionRef is not registered")
            return deepcopy(tombstone)
        tombstone = {"connection_ref": ref, "state": "tombstoned", "removed_at": _now()}
        self.connection_tombstones[key] = tombstone
        self._event("connection.removed", connection_ref=ref)
        return deepcopy(tombstone)

    def get_connection(self, connection_ref):
        ref = validate_connection_ref(connection_ref)
        record = self.connections.get(_key(ref))
        if record is not None:
            return deepcopy(record)
        tombstone = self.connection_tombstones.get(_key(ref))
        return deepcopy(tombstone) if tombstone is not None else None

    # -- Assignment and connection resolution ---------------------------

    def register_assignment(self, assignment):
        record = validate_assignment(assignment)
        scope = record["scope"]
        scope_key = (
            ("installation",)
            if scope["kind"] == "installation"
            else ("project", scope["project_id"])
        )
        key = (record["capability_id"], scope_key)
        if key in self.assignments:
            raise DuplicateRegistrationError("one assignment is allowed per capability and scope")
        for connection_id in record["connection_ids"]:
            matches = [
                item
                for item in self.connections.values()
                if ":".join(
                    (
                        item["connection_ref"]["service_ref"]["owner_id"],
                        item["connection_ref"]["service_ref"]["service_id"],
                        item["connection_ref"]["adapter_lineage_id"],
                        item["connection_ref"]["connection_id"],
                    )
                )
                == connection_id
            ]
            if len(matches) != 1:
                raise MissingConnectionError(
                    "assignment connection_id must identify exactly one Connection"
                )
            connection = matches[0]
            lineage = connection["connection_ref"]["adapter_lineage_id"]
            adapter = self.adapters.get(lineage)
            if adapter is None or record["capability_id"] not in adapter["capabilities"]:
                raise PermissionDeniedError(
                    "assigned Connection adapter does not implement the capability"
                )
            operating_scope = (
                {"kind": "global"}
                if scope["kind"] == "installation"
                else {
                    "kind": "project",
                    "project_ref": {"project_id": scope["project_id"]},
                }
            )
            self._check_connection_scope(connection, operating_scope)
        self.assignments[key] = deepcopy(record)
        self._event("assignment.registered", assignment_id=record["assignment_id"], scope=scope)
        return deepcopy(record)

    def resolve_capability(self, capability_id, project_id=None):
        return resolve_capability_assignment(
            capability_id,
            project_id=project_id,
            assignments=list(self.assignments.values()),
            connections=list(self.connections.values()),
        )

    def _resolved_adapter_routes(self, adapter_lineage_id, scope):
        lineage = self._lineage(adapter_lineage_id)
        operating_scope = self._scope(scope)
        project_id = (
            operating_scope["project_ref"]["project_id"]
            if operating_scope["kind"] == "project"
            else None
        )
        routes = []
        seen = set()
        for capability_id, _ in sorted(self.assignments):
            resolution = self.resolve_capability(capability_id, project_id)
            if resolution["state"] != "ready":
                continue
            assignment = resolution["assignment"]
            for connection in resolution["connections"]:
                ref = connection["connection_ref"]
                if ref["adapter_lineage_id"] != lineage:
                    continue
                identity = (assignment["assignment_id"], _key(ref))
                if identity not in seen:
                    routes.append((assignment, connection))
                    seen.add(identity)
        return routes

    def resolve_connection(self, adapter_lineage_id, applicability, *, connection_ref=None):
        scope = self._scope(applicability)
        routes = self._resolved_adapter_routes(adapter_lineage_id, scope)
        if connection_ref is not None:
            selected = validate_connection_ref(connection_ref)
            matches = [
                connection
                for _, connection in routes
                if _key(connection["connection_ref"]) == _key(selected)
            ]
            if len(matches) != 1:
                raise MissingConnectionError("selected connection is not in the exact assignment")
            connection = matches[0]
            self._require_usable_connection(connection)
            return deepcopy(connection)
        connections = {_key(connection["connection_ref"]): connection for _, connection in routes}
        if len(connections) == 0:
            return None
        if len(connections) == 1:
            connection = next(iter(connections.values()))
            self._require_usable_connection(connection)
            return deepcopy(connection)
        raise AmbiguousConnectionError("multiple resolved connections require explicit selection")

    def resolved_assignment_for_connection(self, adapter_lineage_id, applicability, connection_ref):
        selected = validate_connection_ref(connection_ref)
        assignments = {
            assignment["assignment_id"]: assignment
            for assignment, connection in self._resolved_adapter_routes(
                adapter_lineage_id, applicability
            )
            if _key(connection["connection_ref"]) == _key(selected)
        }
        if len(assignments) != 1:
            raise PermissionDeniedError(
                "connection must have one exact enabled capability assignment"
            )
        return deepcopy(next(iter(assignments.values())))

    def _check_connection_scope(self, connection, assignment_scope):
        conn_scope = connection["applicability"]
        if assignment_scope["kind"] == "global":
            if conn_scope["kind"] != "global":
                raise ScopeMismatchError(
                    "Global assignment cannot include Project-scoped Connection"
                )
            return
        target_project = _scope_project(assignment_scope)
        if conn_scope["kind"] == "global":
            return
        if _scope_project(conn_scope) != target_project:
            raise ScopeMismatchError(
                "Project assignment cannot include another Project's Connection"
            )

    @staticmethod
    def _require_usable_connection(connection):
        if connection is None:
            raise MissingConnectionError("assigned ConnectionRef is removed or unavailable")
        if connection["state"] != "registered":
            raise PermissionDeniedError("selected Connection is not active")
        if connection["trust"] != "trusted":
            raise PermissionDeniedError("selected Connection is not trusted")
        if connection["health"] != "ready":
            raise PermissionDeniedError("selected Connection is not healthy")

    # -- Permission declaration/grant/enforcement ------------------------

    def grant_permission(self, grant):
        record = validate_permission_grant(grant)
        lineage = record["adapter_lineage_id"]
        adapter = self.adapters.get(lineage)
        if adapter is None:
            raise RegistryError("grant references an unknown adapter lineage")
        declaration = next(
            (
                item
                for item in adapter["permissions"]
                if item["permission_id"] == record["permission_id"]
            ),
            None,
        )
        if declaration is None:
            raise UndeclaredPermissionError("permission is not declared by the adapter manifest")
        if not set(record["entity_kinds"]).issubset(declaration["entity_kinds"]):
            raise PermissionDeniedError(
                "PermissionGrant entity kinds must be a subset of the declaration"
            )
        if declaration["connection_mode"] == "required" and record["connection_ref"] is None:
            raise MissingConnectionError(
                "connection-bound permission requires an exact ConnectionRef"
            )
        if declaration["connection_mode"] == "none" and record["connection_ref"] is not None:
            raise ScopeMismatchError(
                "connection-independent permission cannot carry a ConnectionRef"
            )
        scope = record["applicability"]
        if record["connection_ref"] is not None:
            connection = self.connections.get(_key(record["connection_ref"]))
            if connection is None:
                raise MissingConnectionError("grant references an unknown ConnectionRef")
            if connection["connection_ref"]["adapter_lineage_id"] != lineage:
                raise ScopeMismatchError("grant ConnectionRef belongs to another adapter lineage")
            self._check_connection_scope(connection, scope)
        if record["grant_id"] in self.grants or record["grant_id"] in self.revoked_grants:
            raise DuplicateRegistrationError("grant_id is immutable and already used")
        self.grants[record["grant_id"]] = deepcopy({**record, "active": record.get("active", True)})
        self._event("permission.granted", grant_id=record["grant_id"], applicability=scope)
        return deepcopy(self.grants[record["grant_id"]])

    def revoke_permission(self, grant_id, *, revoked_by="owner"):
        if not isinstance(grant_id, str) or not grant_id:
            raise ContractError("grant_id is required")
        grant = self.grants.pop(grant_id, None)
        if grant is None:
            if grant_id in self.revoked_grants:
                return deepcopy(self.revoked_grants[grant_id])
            raise RegistryError("grant_id is not registered")
        tombstone = {
            "grant_id": grant_id,
            "state": "revoked",
            "revoked_by": revoked_by,
            "revoked_at": _now(),
            "grant": grant,
        }
        self.revoked_grants[grant_id] = tombstone
        self._event("permission.revoked", grant_id=grant_id, revoked_by=revoked_by)
        return deepcopy(tombstone)

    def authorize(
        self,
        invocation_context,
        permission_id,
        *,
        entity_ref=None,
        connection_ref=None,
        adapter_lineage_id=None,
    ):
        context = validate_invocation_context(invocation_context)
        if entity_ref is not None:
            raise PermissionDeniedError("InvocationContext.target is the sole authorization target")
        target = context["target"]
        target_kind = target.get("kind", "adapter-resource")
        if not isinstance(permission_id, str) or not permission_id:
            raise ContractError("permission_id is required")
        lineage, target_connection = self._target_lineage_and_connection(
            target, connection_ref, adapter_lineage_id=adapter_lineage_id
        )
        adapter = self.adapters.get(lineage)
        if adapter is None:
            raise PermissionDeniedError("adapter lineage is unavailable")
        declaration = next(
            (item for item in adapter["permissions"] if item["permission_id"] == permission_id),
            None,
        )
        if declaration is None:
            raise UndeclaredPermissionError("permission is not declared by the adapter manifest")
        if target_kind not in declaration["entity_kinds"]:
            raise PermissionDeniedError("target EntityRef kind is not declared for this permission")
        scope = context["invocation_scope"]
        routes = self._resolved_adapter_routes(lineage, scope)
        assignments = {
            assignment["assignment_id"]: assignment
            for assignment, connection in routes
            if target_connection is None
            or _key(connection["connection_ref"]) == _key(target_connection)
        }
        if len(assignments) != 1:
            raise PermissionDeniedError(
                "adapter capability assignment is absent or ambiguous for this exact scope"
            )
        assignment = next(iter(assignments.values()))
        if declaration["connection_mode"] == "required":
            if target_connection is None:
                raise MissingConnectionError(
                    "connection-bound permission requires an exact ConnectionRef"
                )
            self.resolve_connection(lineage, scope, connection_ref=target_connection)
        else:
            if target_connection is not None:
                raise ScopeMismatchError(
                    "connection-independent permission cannot select a ConnectionRef"
                )
            if assignment["connection_ids"]:
                raise ScopeMismatchError(
                    "connection-independent assignment must have no connection_ids"
                )
        grant = self._find_grant(lineage, permission_id, scope, target_connection)
        if grant is None:
            if self._revoked_matches(lineage, permission_id, scope, target_connection):
                raise RevokedPermissionError("permission grant is revoked")
            raise PermissionDeniedError(
                "no active exact-scope PermissionGrant authorizes this invocation"
            )
        if target_connection is not None and _key(grant["connection_ref"]) != _key(
            target_connection
        ):
            raise PermissionDeniedError(
                "invocation ConnectionRef does not match the granted ConnectionRef"
            )
        if target_kind not in grant["entity_kinds"]:
            raise PermissionDeniedError(
                "target EntityRef kind is outside the exact PermissionGrant"
            )
        self._authorize_target_scope(target, scope, grant)
        self._event(
            "permission.authorized",
            permission_id=permission_id,
            adapter_lineage_id=lineage,
            view_scope=context["view_scope"],
            invocation_scope=scope,
        )
        return deepcopy(grant)

    def _find_grant(self, lineage, permission_id, scope, connection_ref):
        for grant in self.grants.values():
            if not grant.get("active", True):
                continue
            if grant["adapter_lineage_id"] != lineage or grant["permission_id"] != permission_id:
                continue
            if _scope_key(grant["applicability"]) != _scope_key(scope):
                continue
            if connection_ref is None:
                if grant["connection_ref"] is not None:
                    continue
            elif _key(grant["connection_ref"]) != _key(connection_ref):
                continue
            return grant
        return None

    def _authorize_target_scope(self, target, scope, grant):
        if "kind" not in target:
            if scope["kind"] == "project" and not grant["data_scope_ids"]:
                raise ScopeMismatchError(
                    "Project adapter-resource authorization requires an exact bound data scope"
                )
            return
        if scope["kind"] == "global":
            if target["kind"] in {"planning-space", "work-item"}:
                raise ScopeMismatchError(
                    "project-owned Planning entity requires an exact Project invocation scope"
                )
            return
        project_id = scope["project_ref"]["project_id"]
        if target["kind"] == "project":
            if target["project_id"] != project_id:
                raise ScopeMismatchError("target project does not match invocation scope")
        elif target["kind"] in {"planning-space", "work-item"}:
            planning_ref = (
                planning_space_ref(target)
                if target["kind"] == "planning-space"
                else planning_work_item_ref(target)
            )
            try:
                self.scope_reader.authorize(target, project_id)
            except ScopeError as error:
                raise ScopeMismatchError(str(error)) from error
            if target["kind"] == "work-item":
                data_scope_id = planning_ref["space_ref"]["data_scope_id"]
                if grant["data_scope_ids"] and data_scope_id not in grant["data_scope_ids"]:
                    raise ScopeMismatchError("target work-item data scope is outside the grant")
        elif target["kind"] in {
            "workflow",
            "execution",
            "session",
            "skill",
            "memory-resource",
            "artifact",
            "improvement-case",
            "service",
            "connection",
            "registry",
        }:
            # These entities need an explicit relation/owner check in a later
            # phase; no implicit project attribution is allowed here.
            raise ScopeMismatchError("target has no exact Project resource binding")

    def _target_lineage_and_connection(self, target, connection_ref, *, adapter_lineage_id=None):
        target_conn = None
        if "kind" not in target:
            target_conn = target["connection_ref"]
        elif target["kind"] == "connection":
            target_conn = {
                "service_ref": target["service_ref"],
                "adapter_lineage_id": target["adapter_lineage_id"],
                "connection_id": target["connection_id"],
            }
        if connection_ref is not None:
            explicit = validate_connection_ref(connection_ref)
            if target_conn is not None and _key(target_conn) != _key(explicit):
                raise ScopeMismatchError("explicit ConnectionRef does not match target")
            target_conn = explicit
        if target_conn is None:
            if adapter_lineage_id is None:
                raise MissingConnectionError(
                    "connection-independent authorization still requires an exact adapter lineage"
                )
            return self._lineage(adapter_lineage_id), None
        return target_conn["adapter_lineage_id"], target_conn

    def _revoked_matches(self, lineage, permission_id, scope, connection_ref):
        for item in self.revoked_grants.values():
            grant = item.get("grant") or {}
            if (
                grant.get("adapter_lineage_id") != lineage
                or grant.get("permission_id") != permission_id
            ):
                continue
            if _scope_key(grant.get("applicability", {"kind": "global"})) != _scope_key(scope):
                continue
            if connection_ref is None and grant.get("connection_ref") is None:
                return True
            if (
                connection_ref is not None
                and grant.get("connection_ref") is not None
                and _key(grant["connection_ref"]) == _key(connection_ref)
            ):
                return True
        return False

    # -- Action and module registry --------------------------------------

    def register_action(self, action):
        record = validate_action_ref(action)
        action_id = record["action_id"]
        if action_id in self.actions:
            raise ActionCollisionError("ActionRef is already registered")
        owner_kind = record["owner_kind"]
        if owner_kind == "adapter" and record["owner_id"] not in self.adapters:
            raise InvalidLineageError("adapter ActionRef owner lineage is not registered")
        if owner_kind == "module" and record["owner_id"] not in self.modules:
            raise RegistryError("module ActionRef owner is not registered")
        self.actions[action_id] = deepcopy(record)
        self._event("action.registered", action_id=action_id)
        return deepcopy(record)

    def register_module(self, module):
        record = validate_module_manifest(module)
        module_id = record["module_id"]
        if module_id in self.modules:
            raise DuplicateRegistrationError("module_id is already registered")
        if module_id in self.module_tombstones:
            raise TombstonedIdentityError("module_id is tombstoned and cannot be taken over")
        self.modules[module_id] = deepcopy(record)
        # Module manifests carry stable action IDs; full ActionRef declarations
        # are registered separately by the action owner and are not invented
        # from a string-only module manifest.
        self._event("module.registered", module_id=module_id)
        return deepcopy(record)

    def list_modules(self):
        return [deepcopy(self.modules[key]) for key in sorted(self.modules)]

    def get_action(self, action_id):
        record = self.actions.get(action_id)
        return deepcopy(record) if record is not None else None

    def list_actions(self):
        return [deepcopy(self.actions[key]) for key in sorted(self.actions)]

    def register_action_input(self, descriptor):
        record = validate_action_input_descriptor(descriptor)
        action_id = record["action_id"]
        if action_id not in self.actions:
            raise RegistryError("action input descriptor owner ActionRef is unavailable")
        if action_id in self.action_inputs:
            raise DuplicateRegistrationError("action input descriptor is already registered")
        self.action_inputs[action_id] = deepcopy(record)
        self._event("action-input.registered", action_id=action_id)
        return deepcopy(record)

    def get_action_input(self, action_id):
        record = self.action_inputs.get(action_id)
        return deepcopy(record) if record is not None else None

    def operation_for_action(self, action_id):
        record = self.action_inputs.get(action_id)
        return record["operation"] if record is not None else None

    def get_contribution(self, contribution_id):
        record = self.contributions.get(contribution_id)
        return deepcopy(record) if record is not None else None

    def list_contributions(self, *, slot=None, entity_kind=None):
        result = []
        for key in sorted(self.contributions):
            record = self.contributions[key]
            if slot is not None and record["slot"] != slot:
                continue
            if entity_kind is not None and entity_kind not in record["entity_kinds"]:
                continue
            result.append(deepcopy(record))
        return result

    # -- Core-ref resolver binding ---------------------------------------

    def bind_core_ref_resolver(
        self, core_ref_kind, service_ref, adapter_lineage_id, connection_id, *, binding_version="1"
    ):
        if (
            not isinstance(core_ref_kind, str)
            or not core_ref_kind
            or not isinstance(binding_version, str)
            or not binding_version
        ):
            raise ContractError("core ref kind and binding version are required")
        ref = validate_service_ref(service_ref)
        lineage = self._lineage(adapter_lineage_id)
        service_key = _key(ref)
        if service_key not in self.services:
            raise RegistryError("core-ref resolver references an unknown service")
        adapter = self.adapters.get(lineage)
        if adapter is None:
            raise InvalidLineageError("core-ref resolver references an unavailable adapter")
        service = self.services[service_key]
        if service.get("direct_read") is not False or adapter.get("direct_read") is not False:
            raise PermissionDeniedError(
                "core-ref resolver must be pointer-only (direct_read=false)"
            )
        connection_ref = {
            "service_ref": ref,
            "adapter_lineage_id": lineage,
            "connection_id": connection_id,
        }
        connection_ref = validate_connection_ref(connection_ref)
        if _key(connection_ref) not in self.connections:
            raise MissingConnectionError("core-ref resolver references an unknown connection")
        existing = self.core_resolvers.get(core_ref_kind)
        binding = {
            "core_ref_kind": core_ref_kind,
            "service_ref": ref,
            "adapter_lineage_id": lineage,
            "connection_id": connection_id,
            "binding_version": binding_version,
            "direct_read": False,
        }
        if existing is not None:
            if _key(existing) == _key(binding):
                return deepcopy(existing)
            raise ResolverCollisionError("only one active core-ref resolver binding is allowed")
        self.core_resolvers[core_ref_kind] = binding
        self._event(
            "core_ref_resolver.bound", core_ref_kind=core_ref_kind, adapter_lineage_id=lineage
        )
        return deepcopy(binding)

    def resolve_core_ref(self, core_ref_kind):
        binding = self.core_resolvers.get(core_ref_kind)
        return deepcopy(binding) if binding is not None else None

    # -- Utilities --------------------------------------------------------

    def _lineage(self, value):
        if not isinstance(value, str) or not value:
            raise InvalidLineageError("adapter_lineage_id is required")
        return value

    @staticmethod
    def _bind_adapter_contribution(contribution, adapter_id, lineage, adapter_version):
        record = deepcopy(contribution)
        if record["owner_kind"] != "adapter" or record["owner_id"] != adapter_id:
            raise InvalidLineageError(
                "manifest adapter contribution owner_id must be its adapter_id placeholder"
            )
        record["owner_id"] = lineage
        if "provenance" in record:
            if record["provenance"]["adapter_id"] != adapter_id:
                raise InvalidLineageError(
                    "manifest contribution provenance adapter_id must match adapter_id"
                )
            record["provenance"]["adapter_lineage_id"] = lineage
            record["provenance"]["adapter_version"] = adapter_version
        bound_actions = []
        for action in record["actions"]:
            prefix = f"adapter.{adapter_id}."
            if (
                action["owner_kind"] != "adapter"
                or action["owner_id"] != adapter_id
                or not action["action_id"].startswith(prefix)
            ):
                raise InvalidLineageError(
                    "manifest action owner must use its adapter_id placeholder"
                )
            bound = deepcopy(action)
            bound["owner_id"] = lineage
            bound["action_id"] = f"adapter.{lineage}.{action['action_id'][len(prefix) :]}"
            bound_actions.append(validate_action_ref(bound))
        record["actions"] = bound_actions
        return record

    @staticmethod
    def _scope(value):
        from .contracts import validate_operating_scope

        return validate_operating_scope(value)

    def _event(self, kind, **details):
        self.audit.append({"kind": kind, "at": _now(), **deepcopy(details)})


__all__ = [
    "ActionCollisionError",
    "AmbiguousConnectionError",
    "DuplicateRegistrationError",
    "InvalidLineageError",
    "MissingConnectionError",
    "PermissionDeniedError",
    "PlatformRegistry",
    "RegistryError",
    "ResolverCollisionError",
    "RevokedPermissionError",
    "ScopeMismatchError",
    "TombstonedIdentityError",
    "UndeclaredPermissionError",
]
