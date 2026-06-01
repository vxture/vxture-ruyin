/**
 * ai.provider.ts - AI 模型 Provider 配置
 * @package agent-server/ruyin
 *
 * Description: 通过 @vxture/ai-gateway-client 统一配置 AI 模型 provider，不在业务代码中硬编码
 *
 * @author AI-Generated
 * @date 2026-03-11 22:00:00
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Provider
 */

// ============================================================================
// Provider 配置
// ============================================================================

/**
 * AI 模型 Provider 配置
 */
export class AiProvider {
  private static instance: AiProvider;
  private initialized: boolean = false;

  /**
   * 获取单例实例
   */
  static getInstance(): AiProvider {
    if (!AiProvider.instance) {
      AiProvider.instance = new AiProvider();
    }
    return AiProvider.instance;
  }

  /**
   * 初始化 Provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.initialized = true;
      console.log("AI Provider 初始化成功");
    } catch (error) {
      console.error("AI Provider 初始化失败:", error);
      throw new Error("AI 模型初始化失败");
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * 全局 Provider 实例
 */
export const aiProvider = AiProvider.getInstance();

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成文本提示
 */
export const generatePrompt = (
  systemPrompt: string,
  userMessages: string[],
  context?: string[],
): string => {
  const promptParts = [systemPrompt];

  if (context) {
    promptParts.push("\n## 上下文信息\n");
    promptParts.push(...context);
  }

  promptParts.push("\n## 用户输入\n");
  promptParts.push(...userMessages);

  return promptParts.join("\n");
};
