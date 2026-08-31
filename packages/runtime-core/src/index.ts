export * from "./ports.js";
export { emitAudit, genesisHash, verifyAuditChain } from "./audit.js";
export type { AuditInput } from "./audit.js";
export {
  Harness,
  HarnessError,
  interruptedResumePoint,
  pendingCheckpoint,
} from "./harness.js";
export type {
  Checkpoint,
  CheckpointChoice,
  CheckpointDecision,
  CheckpointKind,
  HarnessDeps,
  ResumePoint,
  TaskInstanceRecord,
  TaskInstanceState,
  TaskResult,
  VerificationOutcome,
} from "./harness.js";
export {
  ContractInvalidError,
  NeedsHumanConfirmationError,
  ProjectNotFoundError,
  ProjectRuntime,
  isPathGranted,
} from "./project.js";
export type { ProjectView, PendingConfirmation } from "./project.js";
export { decideTool, validateToolCall } from "./tool-gate.js";
export type {
  CallValidation,
  GateDecision,
  GateInput,
  GateSource,
  ValidationInput,
} from "./tool-gate.js";
export { MemoryStoragePort } from "./memory-storage.js";
export { MemoryConnector } from "./memory-connector.js";
