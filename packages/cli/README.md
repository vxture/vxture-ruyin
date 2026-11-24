# @vxture/ruyin-cli

如影（Ruyin）开发者命令行 `ruyin`。

```text
ruyin lint <path...>                                   契约静态校验（R 系列，清单见 30-contract-schema §15）
ruyin pack <productDir> [--out <dir>]                  产品目录 → <id>-<version>.ruyinpkg
ruyin registry <productsDir> --out <dir> --base-url <url>
                                                       打全部产品并写静态产品库（index.json + SHA256SUMS）
```

- `pack` 产出的包含 CHECKSUMS，**不含 SIGNATURE**：签名根就位前不写占位签名，包照实说自己未签名；正式版 Runtime 拒装未签名包。
- `ruyin dev`（本地调试加载）尚未落地。
- 设计权威：vxture-ruyin 仓库 `docs/40-implementation/10-product-integration-guide.md`。

独立产品构建使用已发布包的公开入口；不读取 RUYIN checkout 中的私有构建路径：

```ts
import { packProduct, writeZip } from "@vxture/ruyin-cli";

const ui = writeZip([{ name: "index.html", data: Buffer.from("<main>Product</main>") }]);
// Write ui.zip and the matching contract into the product staging directory.
const candidate = packProduct("./product-staging");
// candidate.buffer is unsigned; production signing remains a separate step.
```

`writeZip` 输出确定性归档，`packProduct` 复用命令行的完整契约与文件校验。
只声明上述公开导出；不保证包内未导出的文件路径稳定。

All rights reserved.
