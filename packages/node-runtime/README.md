# @vxture/ruyin-node-runtime

The original RUYIN durable Node host adapters, consumed by the native daemon
and a product's own server. The isomorphic kernel remains in `ruyin-core`.
This package starts no HTTP server and carries no credentials, tenant policy,
platform RP, arbitrary code executor or synchronization behavior.

```ts
import { SqliteStoragePort, BackgroundJobs, TaskRunner } from '@vxture/ruyin-node-runtime';
import type { StorageKeyProvider } from '@vxture/ruyin-node-runtime';
```

Hosts inject their protected key provider, authenticated namespace, source
reader and layout engine. Native Word layout remains the default. Server hosts
must explicitly supply a verified server layout implementation. A service must
not use the desktop's development plaintext master-key fallback.

The canonical Python reader and hash-locked requirements are packed unchanged
from this repository's resource sources. Installing Python and its locked
dependencies, bounding subprocess resources, and validating actual rendering
fidelity are the host's responsibilities. Per-container stores require exclusive
process ownership; this adapter does not add distributed locking or replication.

All rights reserved.
