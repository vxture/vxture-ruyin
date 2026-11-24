import type {AIGatewayPort,CapabilityTurnRequest} from "@vxture/ruyin-core";
import {CapabilityClient,type CapabilityClientConfig} from "./capability-client.js";
import {LocalModelGateway,type LocalModelConfig} from "./local-model-gateway.js";

export class ModelNotConfiguredError extends Error {
  readonly code = "MODEL_NOT_CONFIGURED";
  constructor() {
    super("MODEL_NOT_CONFIGURED: Connect an authorized model service before starting generation.");
    this.name = "ModelNotConfiguredError";
  }
}

/** Legacy contract-task transport only; not an Atlas relay or an agent-wide router.
 * Product-owned Atlas integration is independent of this compatibility path.
 */
export class RuntimeGateway implements AIGatewayPort {
  private readonly remote: CapabilityClient | undefined;
  constructor(private readonly options: {
    capabilityBase: string;
    token: NonNullable<CapabilityClientConfig["token"]>;
    localModel: () => LocalModelConfig | undefined;
  }) {
    if (options.capabilityBase) this.remote = new CapabilityClient({baseUrl: options.capabilityBase,token: options.token});
  }

  get surface(): "configured" | "local_model" | "unavailable" {
    return this.remote ? "configured" : this.options.localModel() ? "local_model" : "unavailable";
  }

  async turn(request: CapabilityTurnRequest) {
    if (this.remote) return this.remote.turn(request);
    const config = this.options.localModel();
    if (!config) throw new ModelNotConfiguredError();
    return new LocalModelGateway(config).turn(request);
  }
}
