/**
 * JSON Schema for the Ruyin Runtime Contract - the L1 (structural) validation
 * layer. Design authority: docs/30-design/30-contract-schema.md sections 3-14.
 *
 * `additionalProperties: false` everywhere is load-bearing: on capabilities it
 * is what structurally enforces R6 (no model/provider binding keys).
 */

export const SUPPORTED_CONTRACT_VERSIONS = ["0.1"];

const ID = { type: "string", pattern: "^[a-z][a-z0-9_]*$" };
/**
 * Agent Skills name (agentskills.io): lowercase letters, digits and single
 * hyphens, at most 64 characters, and the directory name must equal it - the
 * last part is the registry's business, the first two are this pattern's.
 */
const SKILL_NAME = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", maxLength: 64 };
const SEMVER = { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" };
const NONEMPTY = { type: "string", minLength: 1 };

/**
 * A tool's parameter shape: JSON Schema draft 2020-12, restricted to an object
 * at the top so the Tool Gate can address parameters by name.
 *
 * `x-ruyin-ref` marks the parameters that need more than type checking before
 * a call is let through: a `path` must fall inside a granted folder, and a
 * `context_item` must belong to this task's context set (50-harness 5.2).
 * Without the annotation the gate would have to guess what a parameter means,
 * and guessing wrong means letting the call through.
 */
const TOOL_IO_SCHEMA = {
  type: "object",
  required: ["type", "properties"],
  properties: {
    type: { const: "object" },
    properties: {
      type: "object",
      // Property definitions are ordinary JSON Schema - only the Ruyin
      // annotation is constrained here.
      additionalProperties: {
        type: "object",
        properties: { "x-ruyin-ref": { enum: ["path", "context_item"] } },
      },
    },
    required: { type: "array", items: { type: "string" } },
  },
};
const DATA_CLASS = {
  enum: ["source", "core", "generated", "derived", "temporary"],
};
const SYNC_POLICY = {
  enum: ["local_only", "cloud_only", "bidirectional", "manual", "selective"],
};
const PERMISSION_VALUE = { enum: ["allow", "ask", "deny"] };

export const contractJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "product",
    "project",
    "objects",
    "states",
    "context",
    "capabilities",
    "tools",
    "tasks",
    "permissions",
    "sync",
  ],
  properties: {
    contract: { type: "string", pattern: "^\\d+\\.\\d+$" },
    product: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "version", "publisher", "runtime"],
      properties: {
        id: { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$" },
        name: NONEMPTY,
        version: SEMVER,
        publisher: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        runtime: {
          type: "object",
          additionalProperties: false,
          required: ["minimum"],
          properties: { minimum: SEMVER },
        },
      },
    },
    project: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        // Two business forms, one field. The retired `lifecycle` had three
        // values that mapped one-to-one onto the three `type` values - the
        // same thing said twice. `document`/`versioned` folded into `project`:
        // versions are a property of the produced result, not of the container.
        type: { enum: ["continuous", "project"] },
        operations: {
          type: "array",
          items: { enum: ["create", "open", "archive", "restore"] },
        },
      },
    },
    objects: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name"],
        properties: {
          id: ID,
          name: NONEMPTY,
          primary: { type: "boolean" },
          relations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["to", "kind"],
              properties: {
                to: ID,
                kind: { enum: ["contains", "references", "derives"] },
              },
            },
          },
        },
      },
    },
    states: {
      type: "object",
      additionalProperties: false,
      required: ["object", "initial", "items"],
      properties: {
        object: ID,
        initial: ID,
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "transitions"],
            properties: {
              name: ID,
              transitions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["to"],
                  properties: { to: ID, confirm: { enum: ["human"] } },
                },
              },
            },
          },
        },
      },
    },
    context: {
      type: "object",
      additionalProperties: false,
      required: ["types"],
      properties: {
        types: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "required", "sources", "class", "sensitivity"],
            properties: {
              id: ID,
              name: NONEMPTY,
              required: { type: "boolean" },
              sources: {
                type: "array",
                items: {
                  enum: ["cloud", "local", "lan", "private", "external", "project"],
                },
              },
              class: DATA_CLASS,
              sensitivity: { enum: ["low", "medium", "high"] },
            },
          },
        },
      },
    },
    capabilities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "description"],
        properties: {
          id: ID,
          kind: { enum: ["analysis", "generation", "retrieval", "verification"] },
          description: NONEMPTY,
        },
      },
    },
    tools: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "risk", "default", "input_schema"],
        properties: {
          id: ID,
          category: {
            enum: ["local_read", "local_write", "query", "generate", "export", "external_send"],
          },
          risk: { enum: ["low", "medium", "high"] },
          default: PERMISSION_VALUE,
          provider: { enum: ["runtime", "connector"] },
          input_schema: TOOL_IO_SCHEMA,
          output_schema: TOOL_IO_SCHEMA,
        },
      },
    },
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "objective",
          "input_types",
          "output_types",
          "capabilities",
          "tools",
          "verification",
        ],
        properties: {
          id: ID,
          objective: NONEMPTY,
          input_types: { type: "array", items: ID },
          output_types: { type: "array", items: ID },
          constraints: { type: "array", items: NONEMPTY },
          capabilities: { type: "array", items: ID },
          tools: { type: "array", items: ID },
          skills: { type: "array", items: SKILL_NAME },
          verification: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "kind"],
              properties: {
                id: ID,
                kind: { enum: ["automated", "ai_assisted", "human"] },
              },
            },
          },
        },
      },
    },
    permissions: {
      type: "object",
      additionalProperties: false,
      required: ["local_read", "local_write", "delete", "external_send", "sync_to_cloud"],
      properties: {
        local_read: PERMISSION_VALUE,
        local_write: PERMISSION_VALUE,
        delete: PERMISSION_VALUE,
        external_send: PERMISSION_VALUE,
        sync_to_cloud: PERMISSION_VALUE,
      },
    },
    sync: {
      type: "object",
      additionalProperties: false,
      required: ["default", "classes"],
      properties: {
        default: SYNC_POLICY,
        classes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["class", "policy"],
            properties: { class: DATA_CLASS, policy: SYNC_POLICY },
          },
        },
      },
    },
  },
};
