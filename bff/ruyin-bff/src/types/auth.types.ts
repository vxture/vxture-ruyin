/**
 * auth.types.ts - Ruyin Agent auth context types
 * @package @vxture/bff-ruyin
 *
 * Description: Request-scoped authentication types for the Ruyin Agent BFF.
 *
 * @author AI-Generated
 * @date 2026-04-22
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Types
 */

import type { OAuthProviderType } from "@vxture/core-auth";

export interface AgentViewer {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  permissions: string[];
  provider: OAuthProviderType;
}

export interface RequestContext {
  user?: AgentViewer;
  accessToken?: string;
}
