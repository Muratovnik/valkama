"""Laws the wire contracts obey for every payload, not for the chosen examples.

`test_platform_contracts.py` states what each validator does with particular values.
This file states what all of them do with any value: a validator normalizes
once and for all, invents no field, shares no substructure with its input, and
refuses both an unknown key and a missing one. Those are the properties a
provider adapter relies on without ever being told, and they are the ones an
example set silently stops covering as the module grows.

The strategies are written from the module's own regular expressions rather
than from a sample of realistic values, so widening a pattern without widening
the tests here is what fails.
"""

from __future__ import annotations

import copy
import os
import string
import sys
import unittest

from hypothesis import given
from hypothesis import strategies as st

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server.platform import contracts as platform_contracts
from tests.property_settings import use_gate_profile

use_gate_profile()

# Mirrors _IDENTIFIER and _PROJECT_ID_RE, shortened: length is bounded by the
# validator and nothing here is testing how a 128-character name behaves.
IDENTIFIERS = st.from_regex(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,24}", fullmatch=True)
PROJECT_IDS = st.from_regex(r"[a-z][a-z0-9-]{0,24}", fullmatch=True)
UUIDS = st.uuids(version=4).map(str)
# Bounded text a validator accepts: no controls, no markup, no path or scheme
# shape. The alphabet excludes the characters _reject_unsafe_text hunts for, so
# a rejection here would be a real change in what counts as safe.
TEXT_ALPHABET = string.ascii_letters + string.digits + " -_."
SAFE_TEXT = st.text(alphabet=TEXT_ALPHABET, min_size=1, max_size=60).map(str.strip).filter(bool)
# A planning space key: uppercase, two to eight characters, no separator. Mirrors
# _SPACE_KEY_RE, which is what makes `QA-142` split into exactly two readings.
SPACE_KEYS = st.from_regex(r"[A-Z][A-Z0-9]{1,7}", fullmatch=True)

PROJECT_REFS = st.fixed_dictionaries({"project_id": PROJECT_IDS})
OPERATING_SCOPES = st.one_of(
    st.just({"kind": "global"}),
    st.fixed_dictionaries({"kind": st.just("project"), "project_ref": PROJECT_REFS}),
)
SPACE_REFS = st.fixed_dictionaries({"data_scope_id": UUIDS, "space_key": SPACE_KEYS})
WORK_ITEM_REFS = SPACE_REFS.flatmap(
    lambda space: st.integers(min_value=1, max_value=1_000_000).map(
        lambda number: {"space_ref": space, "reference": f"{space['space_key']}-{number}"}
    )
)
SESSION_REFS = st.fixed_dictionaries({"client_family": IDENTIFIERS, "session_id": IDENTIFIERS})
SKILL_REFS = st.one_of(
    st.fixed_dictionaries({"skill_key": SAFE_TEXT, "source_scope": st.just("global")}),
    st.fixed_dictionaries(
        {
            "skill_key": SAFE_TEXT,
            "source_scope": st.just("project"),
            "project_id": PROJECT_IDS,
        }
    ),
)
SERVICE_REFS = st.fixed_dictionaries({"owner_id": IDENTIFIERS, "service_id": IDENTIFIERS})
CONNECTION_REFS = st.fixed_dictionaries(
    {
        "service_ref": SERVICE_REFS,
        "adapter_lineage_id": IDENTIFIERS,
        "connection_id": IDENTIFIERS,
    }
)
REGISTRY_REFS = st.fixed_dictionaries({"registry_id": IDENTIFIERS})
ADAPTER_RESOURCE_REFS = st.fixed_dictionaries(
    {
        "connection_ref": CONNECTION_REFS,
        "resource_type": IDENTIFIERS,
        "external_id": IDENTIFIERS,
    }
)

# Each entry is a validator and a strategy for payloads it must accept. Every
# strategy produces exactly the keys that contract requires, which is what lets
# the deletion law below treat any present key as load-bearing.
CONTRACTS = {
    "project_ref": (platform_contracts.validate_project_ref, PROJECT_REFS),
    "operating_scope": (platform_contracts.validate_operating_scope, OPERATING_SCOPES),
    "planning_space_ref": (platform_contracts.validate_planning_space_ref, SPACE_REFS),
    "work_item_ref": (platform_contracts.validate_work_item_ref, WORK_ITEM_REFS),
    "session_ref": (platform_contracts.validate_session_ref, SESSION_REFS),
    "skill_ref": (platform_contracts.validate_skill_ref, SKILL_REFS),
    "service_ref": (platform_contracts.validate_service_ref, SERVICE_REFS),
    "connection_ref": (platform_contracts.validate_connection_ref, CONNECTION_REFS),
    "registry_ref": (platform_contracts.validate_registry_ref, REGISTRY_REFS),
    "adapter_resource_ref": (
        platform_contracts.validate_adapter_resource_ref,
        ADAPTER_RESOURCE_REFS,
    ),
}
PAYLOADS = st.one_of(
    *(st.tuples(st.just(name), strategy) for name, (_validator, strategy) in CONTRACTS.items())
)
# Cannot collide with a real field: every optional key in these contracts
# contains an underscore, and this alphabet has none.
FOREIGN_KEYS = st.from_regex(r"[a-z]{1,12}", fullmatch=True)

DANGEROUS_SCHEMES = ("file", "javascript", "data", "vbscript", "smb")


def poison(value: object) -> None:
    """Write into every dictionary a validator returned, at every depth."""
    if isinstance(value, dict):
        for child in value.values():
            poison(child)
        value["poisoned"] = True
    elif isinstance(value, list):
        for child in value:
            poison(child)


class ContractLawTests(unittest.TestCase):
    @given(PAYLOADS)
    def test_validation_is_idempotent(self, case) -> None:
        # A normalized payload is what the platform stores and hands back, so
        # validating it a second time has to be a no-op or the same value would
        # mean two things depending on how far it had travelled.
        name, payload = case
        validate, _strategy = CONTRACTS[name]
        once = validate(payload)
        self.assertEqual(once, validate(once))

    @given(PAYLOADS)
    def test_the_result_shares_no_structure_with_its_input(self, case) -> None:
        # The docstring promises a defensive copy. A shared nested dictionary
        # would let a caller edit a payload the platform has already accepted.
        name, payload = case
        validate, _strategy = CONTRACTS[name]
        result = validate(payload)
        pristine = copy.deepcopy(result)
        poison(result)
        self.assertEqual(pristine, validate(payload))

    @given(PAYLOADS)
    def test_no_field_is_invented(self, case) -> None:
        name, payload = case
        validate, _strategy = CONTRACTS[name]
        self.assertLessEqual(set(validate(payload)), set(payload))

    @given(PAYLOADS, FOREIGN_KEYS)
    def test_an_unknown_field_is_refused(self, case, key) -> None:
        name, payload = case
        validate, _strategy = CONTRACTS[name]
        if key in payload:
            return
        with self.assertRaises(platform_contracts.UnknownFieldError):
            validate({**payload, key: "value"})

    @given(PAYLOADS, st.integers(min_value=0))
    def test_every_field_a_valid_payload_carries_is_required(self, case, choice) -> None:
        # Nothing in these strategies is decoration: drop any key and the
        # contract must say what is missing rather than fill in a default.
        name, payload = case
        validate, _strategy = CONTRACTS[name]
        keys = sorted(payload)
        removed = keys[choice % len(keys)]
        with self.assertRaises(platform_contracts.MissingFieldError):
            validate({key: value for key, value in payload.items() if key != removed})


class SpaceKeyLawTests(unittest.TestCase):
    @given(SPACE_REFS, st.sampled_from((" ", "	", "  ", " 	")))
    def test_a_space_key_is_never_accepted_with_padding(self, ref, padding) -> None:
        # A space is addressed by key, so " QA" and "QA" must not both resolve;
        # one of them is a typo.
        with self.assertRaises(platform_contracts.ContractError):
            platform_contracts.validate_planning_space_ref(
                {**ref, "space_key": padding + ref["space_key"]}
            )

    @given(SPACE_REFS)
    def test_an_uppercase_scope_id_is_never_accepted(self, ref) -> None:
        # Two spellings of one UUID are two scope keys everywhere downstream.
        scope = ref["data_scope_id"]
        if scope == scope.upper():
            return
        with self.assertRaises(platform_contracts.ContractError):
            platform_contracts.validate_planning_space_ref({**ref, "data_scope_id": scope.upper()})

    @given(WORK_ITEM_REFS)
    def test_a_reference_must_belong_to_the_space_it_is_paired_with(self, ref) -> None:
        # The pair is the identity. A reference from another space would route a
        # read to a store that does not hold the item.
        other = "OTH" if ref["space_ref"]["space_key"] != "OTH" else "OTX"
        with self.assertRaises(platform_contracts.ContractError):
            platform_contracts.validate_work_item_ref({**ref, "reference": f"{other}-1"})


class OpenTargetLawTests(unittest.TestCase):
    @given(st.sampled_from(DANGEROUS_SCHEMES), IDENTIFIERS, IDENTIFIERS)
    def test_a_dangerous_scheme_is_refused_even_when_the_caller_allows_it(
        self, scheme, host, kind
    ) -> None:
        # The allowlist is a caller's opinion; these five schemes are the
        # module's own floor, and an adapter must not be able to lower it.
        with self.assertRaises(platform_contracts.UnsafePayloadError):
            platform_contracts.validate_open_target(
                {"target_kind": kind, "uri": f"{scheme}://{host}"},
                allowed_kinds={kind},
                allowed_schemes={scheme},
            )

    @given(
        st.from_regex(r"[a-z][a-z0-9+.-]{1,10}", fullmatch=True),
        st.from_regex(r"[a-z][a-z0-9+.-]{1,10}", fullmatch=True),
        IDENTIFIERS,
        IDENTIFIERS,
    )
    def test_a_scheme_outside_the_allowlist_is_refused(self, scheme, allowed, host, kind) -> None:
        if scheme == allowed or scheme in DANGEROUS_SCHEMES:
            return
        with self.assertRaises(platform_contracts.UnsafePayloadError):
            platform_contracts.validate_open_target(
                {"target_kind": kind, "uri": f"{scheme}://{host}"},
                allowed_kinds={kind},
                allowed_schemes={allowed},
            )

    @given(IDENTIFIERS, IDENTIFIERS)
    def test_an_empty_allowlist_is_refused_rather_than_read_as_permissive(self, kind, host) -> None:
        # An adapter that forgot to declare its schemes must fail closed.
        with self.assertRaises(platform_contracts.ContractError):
            platform_contracts.validate_open_target(
                {"target_kind": kind, "uri": f"https://{host}"},
                allowed_kinds={kind},
                allowed_schemes=set(),
            )


class SemverLawTests(unittest.TestCase):
    @given(
        st.integers(min_value=0, max_value=999),
        st.integers(min_value=0, max_value=999),
        st.integers(min_value=0, max_value=999),
    )
    def test_a_release_version_is_returned_unchanged(self, major, minor, patch) -> None:
        version = f"{major}.{minor}.{patch}"
        self.assertEqual(version, platform_contracts.validate_semver(version))

    @given(
        st.integers(min_value=1, max_value=999),
        st.integers(min_value=0, max_value=999),
        st.integers(min_value=0, max_value=999),
    )
    def test_a_padded_component_is_refused(self, major, minor, patch) -> None:
        # 01.2.3 and 1.2.3 are the same release written twice, and a version
        # that sorts by string would order them apart.
        with self.assertRaises(platform_contracts.ContractError):
            platform_contracts.validate_semver(f"0{major}.{minor}.{patch}")


if __name__ == "__main__":
    unittest.main()
