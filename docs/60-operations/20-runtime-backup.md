# Runtime data backup and recovery

General settings includes Backup and restore. The shipped offline engine and
manual developer helper copy encrypted data and its existing keys together.
It verifies every file and opens disposable database copies to run SQLite
integrity checks, including committed WAL data. It does not decode keys into
an export or replace an existing directory. The UI restore operation changes the
location pointer only after a verified copy is ready in a new directory.
On Windows the original user and machine are still required to unwrap DPAPI.
This is not a cross-machine migration facility or a scheduled backup service.

## Desktop workflow

In Settings / General / Backup and restore, select Backup and choose a local
parent folder. Ruyin creates a new timestamped destination inside it. Prepare
shows the exact path for confirmation; Restart runs the offline operation before
the runtime opens stores. Active tasks, rendering and downloads must finish
first. A queued operation can be cancelled before restart. Browser access allows
manual paths and shows that the next desktop startup must execute the operation.

For Restore, select a complete backup directory and a new destination. Files,
original keys and database integrity must verify both before and after copying.
Only then does Ruyin switch to that copy. The current directory and backup remain
intact. The backup's account, installed agents and settings become current;
external granted-folder files remain at their existing paths. No current
directory is overwritten. A failed or interrupted operation is reported after
startup and is never silently repeated. Retry with a new destination.

Settings / General / Diagnostics explicitly checks local registrations and
resources without running tools, downloading components or probing configured
connector servers. Export report downloads an allowlisted JSON with status,
counts and runtime version; account identifiers, credentials, project data,
names, paths and raw logs are excluded. It does not certify a successful model
request or tool execution. No report is uploaded automatically.

## Create and verify

Build the local host first. Close the runtime using this data directory, then
use its supported Node executable. The source-built host and harness share
the directory ownership lock; an active owner makes the helper refuse.
Older launchers may not take that lock, so closing them remains necessary.
Use an existing local parent for a new destination outside the data directory
and system temporary directories. Do not choose a cloud-synced destination
without deciding separately whether its contents may leave the machine.

```powershell
$runtimeNode = 'C:/Program Files/Ruyin/resources/node/node.exe'
& $runtimeNode scripts/dev/runtime-backup.mjs create 'C:/RuyinData' 'D:/RuyinBackups/2026-11-21'
& $runtimeNode scripts/dev/runtime-backup.mjs verify 'D:/RuyinBackups/2026-11-21'
```

The destination appears only after the copied files, original key set and
database checks pass. `.ruyin-backup.json` records paths, sizes and SHA256
digests; it contains no decrypted key or document content. Incomplete copies
have a `.partial-...` suffix, never count as a successful backup, and are left
for inspection. Existing destinations, symbolic links, changed source files
and incomplete keys are refused. Hashes detect accidental alteration; they
are not a publisher signature or protection against an attacker rewriting
both files and their manifest.

## Restore verification

Keep the verified backup immutable. Copy it into a new, separate data root;
do not merge it with current data. Start an isolated runtime against that copy
on an unused loopback port. Confirm original project IDs, saved document
revisions and applicable audit records before using the restored copy.
External folder grants retain their original paths; a backup does not copy
files held outside the data directory. Stop the verification runtime afterward.

An existing database with a missing `key.enc`, or protected data with a
missing master key, must not receive a newly generated replacement key.
Restore the original matching keys from a complete backup. If unavailable,
preserve DB/WAL files and surviving keys; standalone result exports can help
partial reconstruction but cannot unlock the encrypted database.

## Acceptance on 2026-11-21

The isolated P17 review data was backed up to
`C:/Users/stonesomker/.ruyin/backups/2026-11-21-p17.7-ui-review`:
60 files, 7,400,664 bytes, three encrypted databases. File hashes and database
integrity checks passed. A separate restored runtime exposed all three original
project IDs. The backup verified again after that runtime stopped.
This does not recover the earlier 62501 test data whose original keys are missing.
