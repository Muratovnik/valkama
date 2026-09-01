"""The vocabulary every Platform contract is spelled in.

Field readers, the closed value sets, the patterns an identifier must match,
and the five refusals. Nothing here knows what a manifest or a relation is;
everything above it is written in these terms, which is what keeps one
rejection reason from being spelled two ways.
"""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

MODULES_INTERFACE = "valkama-modules"
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
ENTITY_KINDS = frozenset(
    {
        "project",
        "planning-space",
        "workflow",
        "work-item",
        "execution",
        "session",
        "skill",
        "memory-resource",
        "artifact",
        "improvement-case",
        "service",
        "connection",
        "registry",
    }
)
AUTHORIZATION_TARGET_KINDS = ENTITY_KINDS | {"adapter-resource"}
RELATION_STATES = frozenset({"resolved", "unavailable", "missing", "ambiguous", "malformed"})
SCOPE_KINDS = frozenset({"global", "project"})
ASSIGNMENT_SCOPE_KINDS = frozenset({"installation", "project"})
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
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_URI_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]{1,31}$")
_SAFE_TEXT = re.compile(r"^[^\x00\r\n]{0,512}$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_PROJECT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,159}$")
# A planning space key and the work-item reference built from it. Both belong to
# the Planning domain's grammar, restated here because a Kernel contract may not
# import a module the Kernel sits below.
_SPACE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")
_WORK_ITEM_REFERENCE_RE = re.compile(r"^[A-Z][A-Z0-9]{1,7}-[1-9][0-9]{0,8}$")
_SEMVER_RE = re.compile(
    r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    r"(?:-(?:(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)
_ACTION_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})*$")
_SCHEMA_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{0,95}$")
_RELATION_KIND_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_UTC_TIMESTAMP_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\s]{1,80}Z$")


class ContractError(ValueError):
    """Base class for all malformed or unsafe contract payloads."""


class UnknownFieldError(ContractError):
    pass


class MissingFieldError(ContractError):
    pass


class InvalidDiscriminantError(ContractError):
    pass


class UnsafePayloadError(ContractError):
    pass


def _object(value, required, optional=(), where="object"):
    if not isinstance(value, dict):
        raise ContractError(f"{where} must be an object")
    required = tuple(required)
    allowed = set(required) | set(optional)
    unknown = set(value) - allowed
    if unknown:
        raise UnknownFieldError(f"{where} has unknown field(s): {', '.join(sorted(unknown))}")
    missing = [key for key in required if key not in value]
    if missing:
        raise MissingFieldError(f"{where} is missing: {', '.join(missing)}")
    return value


def _identifier(value, where, *, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value):
        raise ContractError(f"{where} must be a non-empty identifier")
    if not _IDENTIFIER.fullmatch(value):
        raise ContractError(f"{where} is not a canonical identifier")
    return value


def _text(value, where, *, max_length=512):
    if not isinstance(value, str) or len(value) > max_length or not _SAFE_TEXT.fullmatch(value):
        raise ContractError(f"{where} must be bounded text")
    _reject_unsafe_text(value, where)
    return value


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


def _uuid(value, where):
    if not isinstance(value, str) or not _UUID_RE.fullmatch(value):
        raise ContractError(f"{where} must be a canonical lowercase UUID")
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError):
        raise ContractError(f"{where} must be a canonical UUID") from None
    if str(parsed) != value:
        raise ContractError(f"{where} must use lowercase canonical UUID form")
    return value


def _list(value, where, *, item=None, unique=True, max_items=256):
    if not isinstance(value, list) or len(value) > max_items:
        raise ContractError(f"{where} must be a bounded list")
    result = []
    seen = set()
    for index, item_value in enumerate(value):
        normalized = item(item_value, f"{where}[{index}]") if item else item_value
        if unique:
            marker = _freeze(normalized)
            if marker in seen:
                raise ContractError(f"{where} contains a duplicate item")
            seen.add(marker)
        result.append(normalized)
    return result


def _freeze(value):
    if isinstance(value, dict):
        return tuple(sorted((key, _freeze(item)) for key, item in value.items()))
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


_UNSAFE_KEYS = re.compile(
    r"(?:secret|password|token|credential|private[_-]?key|raw|transcript|(?:^|[_-])body(?:$|[_-])|"
    r"memory[_-]?body|provider[_-]?body|search[_-]?result|javascript|(?:^|[_-])script(?:$|[_-])|"
    r"(?:^|[_-])command(?:$|[_-])|<script|html|(?:^|[_-])path(?:$|[_-])|filepath)",
    re.IGNORECASE,
)
_UNSAFE_TEXT_PATTERNS = (
    re.compile(r"<\s*/?\s*[A-Za-z][^>]*>", re.IGNORECASE),
    re.compile(r"\bjavascript\s*:", re.IGNORECASE),
    re.compile(r"(?:^|\s)(?:[A-Za-z]:[\\/]|//|/)(?:[^\s]{1,})"),
)


def _reject_unsafe_text(value, where):
    for pattern in _UNSAFE_TEXT_PATTERNS:
        if pattern.search(value):
            raise UnsafePayloadError(f"{where} contains an unsafe path, URI, or executable value")


def _reject_unsafe_tree(value, where="payload"):
    if isinstance(value, dict):
        for key, child in value.items():
            if _UNSAFE_KEYS.search(str(key)):
                raise UnsafePayloadError(f"{where}.{key} is not permitted at the browser boundary")
            _reject_unsafe_tree(child, f"{where}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_unsafe_tree(child, f"{where}[{index}]")
    elif isinstance(value, str):
        _reject_unsafe_text(value, where)


def _enum(value, choices, where):
    if not isinstance(value, str) or value not in choices:
        raise InvalidDiscriminantError(f"{where} must be one of {sorted(choices)}")
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


def _project_id(value, where):
    if not isinstance(value, str) or not _PROJECT_ID_RE.fullmatch(value):
        raise ContractError(f"{where} must be a lowercase project slug")
    return value


def _space_key(value, where):
    if not isinstance(value, str) or not _SPACE_KEY_RE.fullmatch(value):
        raise ContractError(f"{where} must be a short uppercase planning space key")
    return value


def _work_item_reference(value, where):
    if not isinstance(value, str) or not _WORK_ITEM_REFERENCE_RE.fullmatch(value):
        raise ContractError(f"{where} must be a work item reference such as VAL-142")
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


def _semver(value, where):
    if not isinstance(value, str) or len(value) > 128 or not _SEMVER_RE.fullmatch(value):
        raise ContractError(f"{where} must be canonical SemVer 2.0.0")
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
