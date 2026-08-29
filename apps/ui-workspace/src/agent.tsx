/**
 * Agent dock - the AI companion column docked at the shell's right edge
 * (ShellDock narrow). A structural placeholder until the AI Gateway lands
 * (liaison L3(c)): the surface, entry point and audit promise are part of
 * the product's shape today; the conversation arrives with the gateway.
 */

import { Button, EmptyState, Icon, ShellIconButton } from "@vxture/design-system";

export function AgentDock({ onClose }: { onClose: () => void }) {
  return (
    <div className="agent-dock">
      <div className="agent-dock-head">
        <Icon name="sparkles" size="sm" className="text-primary-text" />
        <span className="text-title-sm font-medium">如影助手</span>
        <span className="ml-auto">
          <ShellIconButton icon="chevron-right" label="收起助手" onClick={onClose} />
        </span>
      </div>
      <div className="agent-dock-body">
        <EmptyState
          icon="brain"
          title="智能体尚未接通"
          description="AI Gateway（liaison L3-c）就绪后，这里将提供跨工作空间的对话式协作：解析招标文件、生成方案草稿、审阅覆盖缺口。"
          action={
            <Button variant="outline" disabled>
              等待平台接通
            </Button>
          }
        />
      </div>
      <div className="agent-dock-foot text-body-sm text-muted-foreground">
        每次推理传输都经人工确认与哈希链审计；推理传输 ≠ 数据存储。
      </div>
    </div>
  );
}
