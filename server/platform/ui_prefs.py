"""The last route the shell remembers: one grammar for the write and for the store's proof.

The app shell saves the route through `validate_ui_prefs`, and bringing a store up holds
every row of `platform_ui_prefs` to the same function before it stamps the store. The two
once read it apart: when a planning space became an operating scope, the bring-up kept the
grammar of the stores it migrates from, and a store refused to open once the web had saved
a route in a space. The migrations that read an older catalog keep their own readers.

It reads the module list, the identity vocabulary and the read envelope's refusal, and
nothing that brings a store up, so the app shell loads it.
"""

from __future__ import annotations

from ..store_identity.primitives import ContractError
from ..store_identity.refs import validate_entity_ref, validate_operating_scope
from ..ui_state import PlatformHttpError
from . import modules as platform_modules

_FIELDS = frozenset({"module_id", "scope", "resource_ref"})
_REQUIRED = frozenset({"module_id", "scope"})


def validate_ui_prefs(value) -> dict:
    """A last route as this build writes it: a module, its scope and, maybe, a resource."""

    if not isinstance(value, dict) or set(value) - _FIELDS or _REQUIRED - set(value):
        raise ContractError("request body has missing or unknown fields")
    module_id = value["module_id"]
    if not isinstance(module_id, str) or module_id not in platform_modules.module_ids():
        raise PlatformHttpError(400, "error", "UI preference names an unknown module")
    prefs = {"module_id": module_id, "scope": validate_operating_scope(value["scope"])}
    if "resource_ref" in value:
        prefs["resource_ref"] = validate_entity_ref(value["resource_ref"])
    return prefs


__all__ = ["validate_ui_prefs"]
