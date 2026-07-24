/**
 * JSON Schema for the Ruyin Runtime Contract - the L1 (structural) validation
 * layer. Design authority: docs/30-design/30-contract-schema.md sections 3-14.
 *
 * `additionalProperties: false` everywhere is load-bearing: on capabilities it
 * is what structurally enforces R6 (no model/provider binding keys).
 */

export const SUPPORTED_CONTRACT_VERSIONS = ["0.1"];

const ID = { type: "string", pattern: "^[a-z][a-z0-9_]*$" };
const SEMVER = { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" };
const NONEMPTY = { type: "string", minLength: 1 };
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
    "workspace",
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
        id: { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$" },
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
    workspace: {
      type: "object",
      additionalProperties: false,
      required: ["type", "lifecycle"],
      properties: {
        type: { enum: ["persistent", "project", "document"] },
        lifecycle: { enum: ["continuous", "finite", "versioned"] },
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
                  enum: ["cloud", "local", "lan", "private", "external", "workspace"],
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
        required: ["id", "category", "risk", "default"],
        properties: {
          id: ID,
          category: {
            enum: ["local_read", "local_write", "query", "generate", "export", "external_send"],
          },
          risk: { enum: ["low", "medium", "high"] },
          default: PERMISSION_VALUE,
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
