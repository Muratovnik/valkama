"""Strict, provider-neutral Valkama Phase 0 contracts.

The platform boundary is deliberately represented by ordinary JSON-compatible
dictionaries. Validators return a defensive, normalized copy and reject
unknown keys, malformed discriminants, unsafe payloads, and values that would
let a provider smuggle executable/browser-owned data through the contract.
This package has no imports from a provider or from the application around it.

The split follows the platform contract's own distinctions rather than file
size: `primitives` is the vocabulary everything else is spelled in, `refs` is
identity, `manifests` is what exists, `authorization` is what may act, and
`relations` is what points at what. Those are the boundaries a reader has to
keep straight anyway — a definition is not an assignment, and neither is a
grant — so the layout states them instead of leaving them to a comment.
"""

from __future__ import annotations

from .authorization import (
    validate_action_input_descriptor as validate_action_input_descriptor,
)
from .authorization import validate_action_ref as validate_action_ref
from .authorization import validate_assignment as validate_assignment
from .authorization import validate_connection as validate_connection
from .authorization import validate_invocation_context as validate_invocation_context
from .authorization import validate_open_target as validate_open_target
from .authorization import validate_permission_grant as validate_permission_grant
from .manifests import TRANSPORT_KINDS as TRANSPORT_KINDS
from .manifests import validate_adapter_manifest as validate_adapter_manifest
from .manifests import validate_adapter_transport as validate_adapter_transport
from .manifests import validate_contribution as validate_contribution
from .manifests import validate_health_contract as validate_health_contract
from .manifests import validate_module_manifest as validate_module_manifest
from .manifests import (
    validate_permission_declaration as validate_permission_declaration,
)
from .manifests import validate_service_descriptor as validate_service_descriptor
from .primitives import ACTIONS_INTERFACE as ACTIONS_INTERFACE
from .primitives import ADAPTER_INTERFACE as ADAPTER_INTERFACE
from .primitives import AUTHORIZATION_TARGET_KINDS as AUTHORIZATION_TARGET_KINDS
from .primitives import CAPABILITY_IDS as CAPABILITY_IDS
from .primitives import CONNECTION_CARDINALITIES as CONNECTION_CARDINALITIES
from .primitives import CONNECTION_MODES as CONNECTION_MODES
from .primitives import CONTRIBUTION_SLOTS as CONTRIBUTION_SLOTS
from .primitives import CONTRIBUTIONS_INTERFACE as CONTRIBUTIONS_INTERFACE
from .primitives import ENTITY_KINDS as ENTITY_KINDS
from .primitives import EXECUTION_MODES as EXECUTION_MODES
from .primitives import HEALTH_STATES as HEALTH_STATES
from .primitives import MODULES_INTERFACE as MODULES_INTERFACE
from .primitives import PLATFORM_MODULE_IDS as PLATFORM_MODULE_IDS
from .primitives import RELATION_STATES as RELATION_STATES
from .primitives import RELATIONS_INTERFACE as RELATIONS_INTERFACE
from .primitives import SCOPE_KINDS as SCOPE_KINDS
from .primitives import ContractError as ContractError
from .primitives import InvalidDiscriminantError as InvalidDiscriminantError
from .primitives import MissingFieldError as MissingFieldError
from .primitives import UnknownFieldError as UnknownFieldError
from .primitives import UnsafePayloadError as UnsafePayloadError
from .primitives import validate_semver as validate_semver
from .refs import planning_space_entity as planning_space_entity
from .refs import planning_space_ref as planning_space_ref
from .refs import planning_work_item_entity as planning_work_item_entity
from .refs import planning_work_item_ref as planning_work_item_ref
from .refs import validate_adapter_resource_ref as validate_adapter_resource_ref
from .refs import validate_assignment_scope as validate_assignment_scope
from .refs import validate_connection_ref as validate_connection_ref
from .refs import validate_data_scope_id as validate_data_scope_id
from .refs import validate_entity_ref as validate_entity_ref
from .refs import validate_operating_scope as validate_operating_scope
from .refs import validate_planning_space_ref as validate_planning_space_ref
from .refs import validate_project_ref as validate_project_ref
from .refs import validate_registry_ref as validate_registry_ref
from .refs import validate_service_ref as validate_service_ref
from .refs import validate_session_ref as validate_session_ref
from .refs import validate_skill_ref as validate_skill_ref
from .refs import validate_work_item_ref as validate_work_item_ref
from .relations import validate_presentation as validate_presentation
from .relations import (
    validate_project_registry_projection as validate_project_registry_projection,
)
from .relations import (
    validate_project_resource_binding as validate_project_resource_binding,
)
from .relations import validate_provenance as validate_provenance
from .relations import validate_relation as validate_relation
