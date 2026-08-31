/**
 * Ruyin Runtime Contract types.
 *
 * Design authority: docs/30-design/30-contract-schema.md (03-A). Field-level
 * comments are intentionally omitted - the design doc is the single source of
 * truth for semantics; these types mirror its section numbers.
 */

/**
 * The two business forms Ruyin supports: `continuous` runs alongside the
 * business with no finish line (customer relations), `project` opens a fresh
 * container per engagement and closes it on delivery (a tender).
 */
export type WorkspaceType = "continuous" | "project";
export type WorkspaceOperation = "create" | "open" | "archive" | "restore";
export type RelationKind = "contains" | "references" | "derives";
export type ContextSource =
  | "cloud"
  | "local"
  | "lan"
  | "private"
  | "external"
  | "workspace";
export type DataClass =
  | "source"
  | "core"
  | "generated"
  | "derived"
  | "temporary";
export type Sensitivity = "low" | "medium" | "high";
export type CapabilityKind =
  | "analysis"
  | "generation"
  | "retrieval"
  | "verification";
export type ToolCategory =
  | "local_read"
  | "local_write"
  | "query"
  | "generate"
  | "export"
  | "external_send";
export type RiskLevel = "low" | "medium" | "high";
export type PermissionValue = "allow" | "ask" | "deny";
export type SyncPolicy =
  | "local_only"
  | "cloud_only"
  | "bidirectional"
  | "manual"
  | "selective";
export type VerificationKind = "automated" | "ai_assisted" | "human";

export interface ProductIdentity {
  id: string;
  name: string;
  version: string;
  publisher: string;
  runtime: { minimum: string };
}

export interface WorkspaceDefinition {
  type: WorkspaceType;
  operations?: WorkspaceOperation[];
}

/** Parameters that need a gate check beyond their JSON type. */
export type ToolRefKind = "path" | "context_item";

/** JSON Schema draft 2020-12, object-typed, with Ruyin's ref annotation. */
export interface ToolIoSchema {
  type: "object";
  properties: Record<string, { "x-ruyin-ref"?: ToolRefKind } & Record<string, unknown>>;
  required?: string[];
}

export interface ObjectRelation {
  to: string;
  kind: RelationKind;
}

export interface BusinessObject {
  id: string;
  name: string;
  primary?: boolean;
  relations?: ObjectRelation[];
}

export interface StateTransition {
  to: string;
  confirm?: "human";
}

export interface StateItem {
  name: string;
  transitions: StateTransition[];
}

export interface StateMachine {
  object: string;
  initial: string;
  items: StateItem[];
}

export interface ContextType {
  id: string;
  name: string;
  required: boolean;
  sources: ContextSource[];
  class: DataClass;
  sensitivity: Sensitivity;
}

export interface Capability {
  id: string;
  kind: CapabilityKind;
  description: string;
}

export interface Tool {
  id: string;
  category: ToolCategory;
  risk: RiskLevel;
  default: PermissionValue;
  /** Required: a tool the gate cannot validate is a tool it cannot let through. */
  input_schema: ToolIoSchema;
  output_schema?: ToolIoSchema;
}

export interface VerificationRule {
  id: string;
  kind: VerificationKind;
}

export interface TaskDefinition {
  id: string;
  objective: string;
  input_types: string[];
  output_types: string[];
  constraints?: string[];
  capabilities: string[];
  tools: string[];
  verification: VerificationRule[];
}

export interface Permissions {
  local_read: PermissionValue;
  local_write: PermissionValue;
  delete: PermissionValue;
  external_send: PermissionValue;
  sync_to_cloud: PermissionValue;
}

export interface SyncClassPolicy {
  class: DataClass;
  policy: SyncPolicy;
}

export interface SyncContract {
  default: SyncPolicy;
  classes: SyncClassPolicy[];
}

export interface RuyinContract {
  contract: string;
  product: ProductIdentity;
  workspace: WorkspaceDefinition;
  objects: BusinessObject[];
  states: StateMachine;
  context: { types: ContextType[] };
  capabilities: Capability[];
  tools: Tool[];
  tasks: TaskDefinition[];
  permissions: Permissions;
  sync: SyncContract;
}

export interface ValidationError {
  /** Rule id: R1..R11 for semantic rules, L1 for structural (JSON Schema) failures. */
  rule: string;
  /** Dotted path into the contract document, e.g. `tools[2].default`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}
