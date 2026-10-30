"""The vocabulary the Kernel's own contracts are spelled in.

The closed value sets and field readers a manifest, a grant or a relation is
checked against. The refusals and the readers an identity needs live in
`store_identity.primitives`, beneath this module; everything here is written in
those terms, which is what keeps one rejection reason from being spelled two
ways.
"""

from __future__ import annotations

import re
from datetime import datetime

from ...store_identity.primitives import (
    _SAFE_TEXT,
    ENTITY_KINDS,
    ContractError,
    _text,
)

# Defined beneath the registry so the module manifest can use them without
# loading this package; re-exported for the registry contracts that spell
# themselves in this module's vocabulary.
from ...store_identity.primitives import _list as _list
from ...store_identity.primitives import _reject_unsafe_tree as _reject_unsafe_tree
from ...store_identity.primitives import _semver as _semver
from ..module_manifest import MODULES_INTERFACE as MODULES_INTERFACE

ADAPTER_INTERFACE = "valkama-adapter"
ACTIONS_INTERFACE = "valkama-actions"
RELATIONS_INTERFACE = "valkama-relations"
CONTRIBUTIONS_INTERFACE = "valkama-contributions"
#: A deliberate exception to the `valkama-*` interface grammar, and the fifth
#: name in this repository that stays spelled the old way. The envelope this
#: discriminates is authored by the workspace projects registry and only read
#: here: an id this product consumes rather than publishes cannot be renamed by
#: this product alone, so spelling it `valkama-project-resource-binding` would
#: not rename anything — it would stop matching the documents on disk.
OPERATING_SCOPE_INTERFACE = "project-resource-binding"
#: Every module this build declares, and the closed vocabulary a module-owned
#: ActionRef and a module contribution are checked against. `memory` was the
#: seventh module and was added to the registry and to the browser's copy of
#: this list without reaching here, so its own primary action —
#: `module.memory.attach` — was refused by the contract that publishes it.
PLATFORM_MODULE_IDS = (
    "planning",
    "sessions",
    "analytics",
    "improvements",
    "skills",
    "memory",
    "settings",
)
_MODULE_ID_SET = frozenset(PLATFORM_MODULE_IDS)
AUTHORIZATION_TARGET_KINDS = ENTITY_KINDS | {"adapter-resource"}
RELATION_STATES = frozenset({"resolved", "unavailable", "missing", "ambiguous", "malformed"})
ASSIGNMENT_STATES = frozenset({"enabled", "disabled"})
CAPABILITY_IDS = frozenset(
    {
        "execution.launch",
        "execution.resume",
        "execution.stop",
        "session.observe",
        "telemetry.query",
        "skills.catalog",
        "skills.activate",
        "memory.open",
        "memory.health",
        "artifact.inspect",
    }
)
CONNECTION_CARDINALITIES = frozenset({"one", "one-or-more"})
CONNECTION_MODES = frozenset({"required", "none"})
EXECUTION_MODES = frozenset({"built_in", "local_service", "local_process"})
TRUST_STATES = frozenset({"trusted", "restricted", "blocked", "unknown"})
HEALTH_STATES = frozenset({"ready", "not-observed", "degraded", "unavailable"})
CONTRIBUTION_SLOTS = frozenset(
    {
        "entity-relation-resolver",
        "entity-action",
        "inspector-section",
        "normalized-event-source",
        "settings-connection-entry",
        "read-model-provider",
        "status-diagnostics",
    }
)
_URI_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]{1,31}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_ACTION_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})*$")
_SCHEMA_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{0,95}$")
_RELATION_KIND_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_UTC_TIMESTAMP_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\s]{1,80}Z$")


def _local_text(value, where, *, max_length=512):
    """Bounded text that never reaches the browser, so the browser rule is off.

    `_text` refuses a path-shaped or URI-shaped string because everything it
    guards ends up rendered. One field does not: the transport half of an
    installation record, which exists to hold an argv naming an absolute
    interpreter and is never published with the manifest.

    The bounds stay — length, no control characters — because they are about
    the value being a value. Only the boundary rule is lifted, and the reason
    it can be lifted is that there is no boundary here.
    """

    if not isinstance(value, str) or len(value) > max_length or not _SAFE_TEXT.fullmatch(value):
        raise ContractError(f"{where} must be bounded text")
    return value


def _revision(value, where="revision"):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ContractError(f"{where} must be a non-negative integer")
    return value


def _timestamp(value, where="timestamp"):
    if not isinstance(value, str) or len(value) > 64:
        raise ContractError(f"{where} must be an RFC3339 timestamp")
    try:
        datetime.fromisoformat(value)
    except ValueError:
        raise ContractError(f"{where} must be an RFC3339 timestamp") from None
    return value


def _schema_id(value, where):
    if not isinstance(value, str) or not _SCHEMA_ID_RE.fullmatch(value):
        raise ContractError(f"{where} must match the frontend schema ID grammar")
    return value


def _nonempty_text(value, where, *, max_length):
    result = _text(value, where, max_length=max_length)
    if not result:
        raise ContractError(f"{where} must be non-empty bounded text")
    return result


def _utc_timestamp(value, where):
    if not isinstance(value, str) or len(value) > 96 or not _UTC_TIMESTAMP_RE.fullmatch(value):
        raise ContractError(f"{where} must be an ISO UTC timestamp ending in Z")
    try:
        datetime.fromisoformat(value)
    except ValueError:
        raise ContractError(f"{where} must be an ISO UTC timestamp ending in Z") from None
    return value


def _provider_version(value, where):
    return _semver(value, where)


def _relation_kind(value, where):
    if not isinstance(value, str) or not _RELATION_KIND_RE.fullmatch(value):
        raise ContractError(f"{where} must match the frontend relation-kind grammar")
    return value


def validate_semver(value):
    return _semver(value, "semver")


def _positive_revision(value, where):
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ContractError(f"{where} must be a positive integer")
    return value


def _sha256(value, where):
    if not isinstance(value, str) or not _SHA256_RE.fullmatch(value):
        raise ContractError(f"{where} must be a lowercase SHA-256 digest")
    return value
