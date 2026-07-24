/**
 * Dev-mode product loading: scan a directory of unpacked product dirs, parse
 * and validate each ruyin.product.yaml (signature verification is skipped in
 * dev mode by design - docs/40-implementation/10-product-integration-guide.md
 * section 7; packaged/signed loading arrives with the release pipeline, W4).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseContract,
  validateContract,
  type RuyinContract,
  type ValidationError,
} from "@vxture/ruyin-contract-schema";

export interface LoadedProduct {
  id: string;
  name: string;
  version: string;
  path: string;
  contract: RuyinContract;
}

export interface ProductLoadFailure {
  path: string;
  errors: ValidationError[];
}

export interface ProductScan {
  loaded: LoadedProduct[];
  failed: ProductLoadFailure[];
}

const MANIFEST = "ruyin.product.yaml";

export function loadProducts(productsDir: string): ProductScan {
  const loaded: LoadedProduct[] = [];
  const failed: ProductLoadFailure[] = [];
  if (!existsSync(productsDir)) return { loaded, failed };
  for (const entry of readdirSync(productsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(productsDir, entry.name, MANIFEST);
    if (!existsSync(manifest)) continue;
    let raw: unknown;
    try {
      raw = parseContract(readFileSync(manifest, "utf8"));
    } catch (cause) {
      failed.push({
        path: manifest,
        errors: [
          {
            rule: "L1",
            path: "(root)",
            message: `YAML parse error: ${cause instanceof Error ? cause.message : String(cause)}`,
          },
        ],
      });
      continue;
    }
    const result = validateContract(raw);
    if (!result.ok) {
      failed.push({ path: manifest, errors: result.errors });
      continue;
    }
    const contract = raw as RuyinContract;
    loaded.push({
      id: contract.product.id,
      name: contract.product.name,
      version: contract.product.version,
      path: manifest,
      contract,
    });
  }
  return { loaded, failed };
}
