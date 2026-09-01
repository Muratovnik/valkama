"""EXT-001: the contract every adapter already satisfied, written down.

This is extraction rather than design. Two families of provider existed before
this file — `ReferenceProvider` over a pointer service and
`BuiltinCapabilityProvider` over a Valkama-owned implementation — and both
already answered the same questions. Naming them is the whole of EXT-001,
because a contract invented beside working code is a second answer, and this
repository has spent the year removing those.

The count went up by one after it was written, and that is the extraction
working rather than failing: the first provider from outside the two families
hit `core_ref_kinds`, which the seeding path reads from everything and which
both built-in families happened to have. A contract only its authors satisfy is
not one, and the way to find out is to write something that was not there when
it was drafted.

What the extraction *changed* is where two of the answers live. The catalogue
used to branch on the provider's Python class to dispatch, and to carry a
hardcoded table of which capabilities the reference family had. Both are the
same defect wearing different clothes: the Kernel knowing its providers by name.
An external adapter could not be added without editing that table and that
branch, which §18.2 forbids in as many words — the point of the layer is adding
a tool without changing the Kernel.

So a provider now reports its own capabilities and dispatches its own calls.
The catalogue routes by `ConnectionRef` and nothing else, and the proof that
the contract is real is that the HTTP transport in `transports.py` plugs in
without the catalogue learning anything about it.

Deliberately not in the contract:

- **Manifest discovery.** Where a manifest comes from is the installer's
  question, not the provider's; §18.4 lists four sources and a provider that
  knew which one it came from would be answering for the installer.
- **Trust.** A provider reports health and identity; only the persisted owner
  lifecycle promotes trust, and `connection()` returning `"trust": "unknown"`
  is the existing rule this keeps.
- **Rendering.** §18.6 is explicit that an adapter contributes normalized data
  to a module section and never a screen, so nothing here returns markup.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


class ProviderError(ValueError):
    """A provider refused a call, and the refusal is part of the contract.

    Here rather than beside the built-in providers because the protocol below
    names it as *the* refusal family, and a family only the built-ins could
    reach is not one: `ExternalAdapterError` derived from `Exception`, so a
    dispatched external refusal escaped every handler written for a provider
    error and became a generic failure — the fictional universality §15.4
    forbids, arriving as a 500 instead of a typed no.
    """


class ProviderUnavailableError(ProviderError):
    """The provider could not be reached, as distinct from refusing."""


@runtime_checkable
class Provider(Protocol):
    """What the Kernel may assume about any adapter, built-in or external.

    Runtime-checkable so the conformance tool can answer honestly about an
    object it was handed, but the checkable part is only method presence —
    a shape is not a contract, and the behaviour below is what the tests and
    `valkama adapter check` actually verify.
    """

    #: Stable identity of the implementation. Distinct from the lineage, which
    #: survives a version change, and from the ConnectionRef, which identifies
    #: one configured instance of it.
    adapter_id: str

    #: The identity that outlives versions. Refs point at this, so it may not
    #: change when the implementation does.
    adapter_lineage_id: str

    @property
    def connection_ref(self) -> dict:
        """The one key the catalogue routes by."""

    @property
    def transport(self) -> str:
        """A display label for the Connections list: how this is reached, in a word.

        One of `built-in`, `local-file`, `local-process`, `loopback-http`,
        `remote-https`. Distinct from an address and from `execution`, and the
        second field the first external provider found missing from this
        contract — both were things the two built-in families happened to have.
        """

    @property
    def core_ref_kinds(self) -> tuple[str, ...]:
        """Core ref kinds this provider claims, and the Kernel binds to it.

        Named here because the first external provider found it missing: the
        seeding path reads it from every provider, and a contract that did not
        mention it was a contract only the built-ins happened to satisfy.

        Claiming one is a takeover — the Kernel refuses two claimants for a
        kind — so an installed adapter claims none. A manifest asserting
        ownership of `memory` on installation would displace the provider the
        owner already has, without the owner deciding anything.
        """

    @property
    def capabilities(self) -> tuple[str, ...]:
        """Capability ids this provider answers, reported by the provider.

        Reported rather than looked up: a table in the Kernel is a second place
        to be wrong, and it was wrong — it listed the reference family by
        lineage id and no external adapter could appear in it at all.
        """

    def manifest(self) -> dict:
        """The `valkama-adapter` manifest, valid against `validate_adapter_manifest`."""

    def package_descriptor(self) -> dict:
        """Where the implementation came from and how it executes."""

    def service_descriptor(self) -> dict:
        """The service this adapter speaks for, and who owns its configuration."""

    @property
    def probe_ceiling_ms(self) -> int:
        """The enforced upper bound on one `health()` call, in milliseconds.

        Reported by the provider because only the provider knows what its probe
        costs, and *enforced* rather than declared: the Kernel decides from this
        number whether a read can afford to probe at all, so a figure nothing
        holds to would make the read's own bound fictional. A manifest's
        `health_contract.timeout_ms` is the wrong source for the same reason it
        is the wrong source for a payload bound — it is chosen by the party
        being probed.
        """

    def health(self) -> tuple[str, dict | None]:
        """One of HEALTH_STATES, and a typed diagnostic when it is not `ready`.

        Never raises. A provider that cannot be reached is `unavailable` with a
        reason, because an exception here would take down a health sweep that
        exists precisely to survive one provider being down.
        """

    def connection(self, scope: dict | None = None, *, observe: bool = True) -> dict:
        """This provider as a Connection record, optionally without probing."""

    def dispatch(self, capability_id: str, payload: dict) -> dict:
        """Answer one capability call, or refuse it.

        Refusal is `ProviderError`, including for a capability the provider does
        not implement: the catalogue no longer knows which those are, and a
        provider silently returning nothing for a capability it does not have
        would be the fictional universality §15.4 forbids one layer down.
        """


__all__ = ["Provider", "ProviderError", "ProviderUnavailableError"]
