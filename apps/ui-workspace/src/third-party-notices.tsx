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

const PART_LABEL: Record<string, string> = { daemon: "运行环境", ui: "界面", shell: "桌面应用" };

export function ThirdPartyNotices({ entries = THIRD_PARTY }: { entries?: ThirdPartyEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* 与「隐私政策」那三条同一行、同一个版式（owner 2026-09-15）：外观对齐，
          但底层仍是 `<button>` —— 点了是就地展开这份清单，不是去别处，所以不该
          伪装成链接。总数字**只在弹出面板里**说，这里不重复（第一眼先说清「这是
          什么」，不是「有多少个」）。 */}
      <button type="button" className="about-third-party" onClick={() => setOpen(true)}>
        三方许可
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="third-party-dialog">
          <DialogHeader>
            <DialogTitle>随包第三方组件许可</DialogTitle>
            <DialogDescription>
              以下 {entries.length} 个是随 RUYIN 一起分发的第三方开源组件，列在这里是它们的
              许可证要求的署名。许可证全文在安装目录里；技能与工具的许可证逐条写在「能力平台」页。
            </DialogDescription>
          </DialogHeader>
          <div className="third-party-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  {/* 序号右对齐（owner 2026-09-15）：数字天然右对齐读起来才整齐，
                      左对齐的话个位数与两位数对不齐左边缘。 */}
                  <TableHead className="third-party-idx">#</TableHead>
                  <TableHead>组件</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>许可证</TableHead>
                  <TableHead className="third-party-part">所属模块</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => (
                  <TableRow key={`${e.name}@${e.version}`}>
                    <TableCell className="mono text-muted-foreground third-party-idx">{i + 1}</TableCell>
                    <TableCell className="mono">{e.name}</TableCell>
                    <TableCell className="mono text-muted-foreground">{e.version}</TableCell>
                    <TableCell>{e.license}</TableCell>
                    <TableCell className="text-muted-foreground third-party-part">
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
