"""The vocabulary an identity is spelled in.

The five refusals, the field readers and the closed value sets that a store,
a planning space, a work item, a project or an operating scope is checked
against. Nothing here knows what a manifest is: the module manifest and the
adapter contract are written on top of this vocabulary, which is what keeps one
rejection reason from being spelled two ways.
"""

from __future__ import annotations

import re
from uuid import UUID

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
    }
)
SCOPE_KINDS = frozenset({"global", "project"})
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_TEXT = re.compile(r"^[^\x00\r\n]{0,512}$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_PROJECT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,159}$")
# A planning space key and the work-item reference built from it. Both belong to
# the Planning domain's grammar, restated here because an identity contract may
# not import a module that sits above it.
_SPACE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")
_WORK_ITEM_REFERENCE_RE = re.compile(r"^[A-Z][A-Z0-9]{1,7}-[1-9][0-9]{0,8}$")


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


_UNSAFE_TEXT_PATTERNS = (
    re.compile(r"<\s*/?\s*[A-Za-z][^>]*>", re.IGNORECASE),
    re.compile(r"\bjavascript\s*:", re.IGNORECASE),
    re.compile(r"(?:^|\s)(?:[A-Za-z]:[\\/]|//|/)(?:[^\s]{1,})"),
)


def _reject_unsafe_text(value, where):
    for pattern in _UNSAFE_TEXT_PATTERNS:
        if pattern.search(value):
            raise UnsafePayloadError(f"{where} contains an unsafe path, URI, or executable value")


def _enum(value, choices, where):
    if not isinstance(value, str) or value not in choices:
        raise InvalidDiscriminantError(f"{where} must be one of {sorted(choices)}")
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


# Generic bounded-value validators, beneath everything that routes, so the
# module manifest and the adapter contract share one spelling of each.
_SEMVER_RE = re.compile(
    r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    r"(?:-(?:(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


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


def _semver(value, where):
    if not isinstance(value, str) or len(value) > 128 or not _SEMVER_RE.fullmatch(value):
        raise ContractError(f"{where} must be canonical SemVer 2.0.0")
    return value
