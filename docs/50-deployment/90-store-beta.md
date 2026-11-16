# Microsoft Store beta

The Store product is a draft, not a published or certified release.
Partner Center: https://partner.microsoft.com/en-US/dashboard/products/9PC52HV8RJ4N/overview

Submission 1 has been created as a draft (ID `1152921505702421794`).
The `ruyin-store-753` package has been uploaded and Partner Center reports
`Validated` / Packages `Complete`. No certification or publication has started.
Pricing/availability, properties and submission options are complete. The draft
uses a zero Store acquisition price, direct-link-only discoverability, and a
manual publishing hold. Chinese and English descriptions have been saved;
both listings now include an actual packaged login screenshot and are Complete.
Age ratings are at the preview step: consent to share the publisher name and
developer email with IARC was explicitly granted. The owner confirmed that
pornographic, gory and discriminatory content is prohibited and restrictions
are enforced by the model services. The revised questionnaire generates
Microsoft 12+ / ESRB Teen (regional ratings vary). Saving the rating still
requires acceptance of IARC Terms of Use and confirmation of legal adulthood;
an explicit at-action confirmation is pending. No agreement has been accepted.
The runFullTrust justification is saved; Microsoft approval is still pending.

## Identity

| Field | Value |
| --- | --- |
| Store ID | 9PC52HV8RJ4N |
| Package identity | VxtureStudio.RUYIN |
| Publisher | CN=9B432893-508A-4CA0-927B-271209E9FE0F |
| Publisher display name | Vxture Studio |
| Package family | VxtureStudio.RUYIN_hwrbg2tvfk1sa |

These are public package identifiers, not credentials.

## Build

Run `node scripts/release/pack.mjs --store` on Windows. This reuses the
daemon deployment, bundled runtimes and read-only payload smoke checks.
The Store configuration generates AppX, a format accepted on the Store's
MSIX/AppX submission path. The CI `store-package` job checks the identity
inside the generated archive and retains it as an artifact.

The seed step materializes uv's Python directory aliases before its offline
verification. MakeAppx rejects directory junctions in its file mapping; retaining
each alias as a real directory preserves uv's lookup paths.

Validated build: commit `19a9db7`, CI run `43955125124`, artifact
`ruyin-store-753`. Store AppX construction, archive identity checks and payload
smoke passed, as did the separate NSIS packaged smoke. This is build validation,
not a Store-installed test or certification result.

The following documentation/diagnostic update `746c0e4` also passed all CI jobs
in run `43956532976`. The uploaded AppX SHA256 is
`b5e6bc8ad4f250ee39272a149b46ab2b545cff0fc53a73c45f566794f3f32c97`.
The existing local NSIS installation has not been replaced or uninstalled.

Screenshot capture build `f884202` passed every CI job in run `43962317073`.
Artifact `ruyin-store-screenshots-758` contains `store-login.png`, captured from
the packaged UI on a clean runner. Capture is opt-in via
`RUYIN_SMOKE_SCREENSHOT` during `--smoke`, refuses an authenticated workspace,
and does not alter the normal application startup path.

This unsigned submission package is not an installer users can trust or
install directly. Microsoft signs the certified package for Store distribution.
No certificate is added to a user's device by this workflow.

## Remaining validation before submission

- Install the Store-signed beta and test activation, loopback UI, daemon,
  bundled Node/Python tools, PDF export and Accounts login/recovery/logout.
- Verify the packaged filesystem and AppData behavior preserves the existing
  location pointer, encrypted data and DPAPI access.
- Test migration from NSIS without concurrent daemons or conflicting shortcuts.
  A Store package has a different installation identity; it is not an
  automatic in-place NSIS upgrade. Do not uninstall or move existing data
  until migration has been verified.
- Review Store-managed updates, capabilities, listings, privacy disclosure
  and certification requirements. Existing NSIS update behavior is unchanged.

The current CI payload smoke runs the unpacked executable. It does not prove
that Store-installed activation or data migration works.
