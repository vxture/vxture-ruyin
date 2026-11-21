# ADR-028: stable host, agent-owned inference and local capability supply

- Status: accepted owner direction, 2026-11-20; implementation is incremental.
- Authority: the owner's explicit conversation instructions on 2026-11-20.
- Related: ADR-002, ADR-008, ADR-018, ADR-020, ADR-022, ADR-025 and ADR-026.
- Supersedes conflicting central-inference wording in the current workplan and the historical RY-100 comparison note. Original decisions remain as historical records; reconcile the unavailable external RY originals when accessible under the standing local-registration exception.

## Decision

RUYIN is the low-frequency execution environment: desktop shell, package lifecycle, background scheduling, project storage, local permissions, audit and host capabilities. Agents are separately installed/versioned .ruyinpkg products. Domain changes normally update an agent package; host/native/protocol/security changes may require a host release. Microsoft Store signing/certification applies to the stable host distribution; package updates still comply with applicable distribution/content policy.

Atlas model invocation belongs to the agent and its provider adapter/SDK. RUYIN may display model metadata, but must not become an additional inference relay. A generic loop hosted by RUYIN does not move product prompts, model choice or Atlas transport ownership into the workbench. No new RUYIN chat-proxy route is introduced. The existing host contract-task gateway remains a compatibility path during migration; it must not fabricate content when unconfigured or declare all independent agents unavailable.

Runos has two separate consumption paths:

| Use | Ownership and boundary |
| --- | --- |
| Cloud agent consumption | Agent/cloud application calls the Runos platform's published MCP capabilities under its own authorized product/task identity |
| Desktop local supply | RUYIN installs/manages verified compatible skills, tools and connectors; the local capability interface reuses Runos vocabulary and execution contracts; business agents consume it under project permissions |
| Local sandbox | A future host capability with real OS isolation, bounded resources and controlled mounts/network; it is not provided merely by installing a skill or trusting a package |

A synchronized catalog is metadata, not proof of installation, readiness or invocation permission. Installing the entire cloud Runos service stack is not the desktop default. Local-only execution must fail if local supply is missing; it must not silently send customer materials to cloud Runos.

## Configuration versus software updates

Stable supported protocols permit catalog/route/provider/model/version selection changes through configuration and refreshed metadata. Changes apply to subsequent calls without reinstalling the host. Failed or incomplete refreshes retain a clearly stale same-context snapshot. Account/workspace changes cannot reuse another context's metadata. Current tasks keep their recorded inputs, decisions and result history.

New native dependencies, new execution protocols or changed security boundaries still require a tested host release. Agent packages contain browser/business resources, not native executables or OS installation scripts. Package signatures are separate from Windows host signing; neither replaces runtime project authorization.

## Verified state and open prerequisites

- Console session GET /api/runos/capabilities succeeded for the authorized test identity: 879 metadata entries over two pages. This is catalog acceptance only.
- Atlas's current published inference endpoint is POST /v1/chat guarded by S2S. An agent cloud backend can use that service protocol. A desktop direct adapter needs an approved public-client/delegation path; confidential-client secrets and downstream service tokens must not enter the renderer.
- No agent-owned Atlas direct invocation, Runos cloud execution, local Runos sandbox or new Store-installed host was certified by these metadata tests.
- The bid MVP currently submits declarative jobs to the host Harness. That existing implementation needs an incremental adapter/execution-boundary migration; changing a settings label does not complete it. Preserve queued/running jobs and prior results during that migration.

Implementation tracker: docs/70-workplan/110-capability-integration.md (P12.1-P12.6). Do not rebuild generic workbench features inside each agent.

Owner's final wording clarification in the same session: preserve the existing "private model service" settings block, label, status wording and logic. User-owned models are an optional paid capability, not a prerequisite for an agent's Atlas integration. Do not replace this block with a planned-feature panel in this batch.
