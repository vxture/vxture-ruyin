# @vxture/ruyin-workbench-ui

The original RUYIN project workflow, product home/catalog, library picker,
settings/task/confirmation panels, typed UI client and localization. The native
workspace imports these same modules; this package is their single source.
Electron chrome, global app/settings and the runtime daemon stay in `apps/`.

```tsx
import { ProjectWorkflowNav, ProductHome, ProjectPanel } from "@vxture/ruyin-workbench-ui";
import "@vxture/ruyin-workbench-ui/styles.css";
```

The host supplies the runtime client, verified project scope and product canvas.
Presentation never authorizes execution or substitutes for server checks. The
default client remains the native bearer transport; a product Web host supplies
its same-origin cookie transport. No native secret or provider credential is
included. CSS uses the existing design-system token and theme contract.

All rights reserved.
