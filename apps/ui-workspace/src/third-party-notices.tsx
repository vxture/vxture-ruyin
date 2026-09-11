/**
 * 关于页里的「第三方组件许可」（TD-058）。
 *
 * **RUYIN 本身是闭源商业软件 —— 这一块与我们的授权无关。** 安装包里重新分发了别人的
 * 开源组件，它们的许可证（MIT / BSD / Apache-2.0……）要求随附署名。这里列的是**真的
 * 随包的那些**：清单由 `scripts/release/third-party.mjs` 从守护进程与界面的生产依赖、
 * 外加 Electron 生成，CI 比对它有没有过期；许可证全文随安装包。
 *
 * 技能与工具的许可证不在这里重复 —— 它们逐条在「能力平台」页上，抄第二份就会两份各自漂。
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vxture/design-system";
import { THIRD_PARTY, type ThirdPartyEntry } from "./third-party-list";

const PART_LABEL: Record<string, string> = { daemon: "运行时", ui: "界面", shell: "桌面壳" };

export function ThirdPartyNotices({ entries = THIRD_PARTY }: { entries?: ThirdPartyEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="about-third-party" onClick={() => setOpen(true)}>
        随包第三方组件许可（{entries.length}）
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="third-party-dialog">
          <DialogHeader>
            <DialogTitle>随包第三方组件许可</DialogTitle>
            <DialogDescription>
              RUYIN 本身是闭源商业软件。以下 {entries.length} 个是随安装包分发的第三方开源组件 ——
              列在这里是它们的许可证要求的署名。许可证全文在安装目录的
              resources\THIRD-PARTY-NOTICES.txt；Chromium 的在安装目录下的 LICENSES.chromium.html。
              技能与工具的许可证逐条在「能力平台」页。
            </DialogDescription>
          </DialogHeader>
          <div className="third-party-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>组件</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>许可证</TableHead>
                  <TableHead>随哪一块</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={`${e.name}@${e.version}`}>
                    <TableCell className="mono">{e.name}</TableCell>
                    <TableCell className="mono text-muted-foreground">{e.version}</TableCell>
                    <TableCell>{e.license}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.usedBy.map((u) => PART_LABEL[u] ?? u).join("、")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
