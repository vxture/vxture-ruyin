/**
 * vector.storage.ts - 向量数据存储
 * @package agent-server/ruyin
 *
 * Description: 封装向量相关的存储操作，支持 pgvector 向量相似度搜索
 *
 * @author AI-Generated
 * @date 2026-03-11 22:00:00
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Storage
 */

import type { VectorData } from "../types/ruyin.types";

// ============================================================================
// 向量存储接口
// ============================================================================

/**
 * 向量存储接口
 */
export interface VectorStorage {
  /** 存储向量数据 */
  storeVector(data: Omit<VectorData, "id">): Promise<VectorData>;

  /** 批量存储向量 */
  storeVectors(dataList: Omit<VectorData, "id">[]): Promise<VectorData[]>;

  /** 根据 ID 获取向量 */
  getVector(id: string): Promise<VectorData | null>;

  /** 相似度搜索 */
  similaritySearch(
    queryEmbedding: number[],
    limit?: number,
    threshold?: number,
  ): Promise<VectorData[]>;

  /** 文本相似度搜索 */
  similaritySearchByText(
    queryText: string,
    limit?: number,
    threshold?: number,
  ): Promise<VectorData[]>;

  /** 删除向量 */
  deleteVector(id: string): Promise<boolean>;

  /** 批量删除向量 */
  deleteVectors(ids: string[]): Promise<number>;

  /** 清空集合 */
  clearCollection(): Promise<boolean>;
}

// ============================================================================
// 内存向量存储实现
// ============================================================================

/**
 * 内存向量存储实现（用于开发和测试）
 */
export class MemoryVectorStorage implements VectorStorage {
  private vectors: Map<string, VectorData> = new Map();

  /**
   * 计算向量相似度（余弦相似度）
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same dimension");
    }

    const dotProduct = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  async storeVector(data: Omit<VectorData, "id">): Promise<VectorData> {
    const id = `vec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const vectorData: VectorData = {
      ...data,
      id,
    };

    this.vectors.set(id, vectorData);
    return vectorData;
  }

  async storeVectors(
    dataList: Omit<VectorData, "id">[],
  ): Promise<VectorData[]> {
    const results: VectorData[] = [];
    for (const data of dataList) {
      const result = await this.storeVector(data);
      results.push(result);
    }
    return results;
  }

  async getVector(id: string): Promise<VectorData | null> {
    return this.vectors.get(id) || null;
  }

  async similaritySearch(
    queryEmbedding: number[],
    limit: number = 10,
    threshold: number = 0.5,
  ): Promise<VectorData[]> {
    const results: Array<{ vector: VectorData; score: number }> = [];

    for (const vector of this.vectors.values()) {
      const score = this.cosineSimilarity(queryEmbedding, vector.embedding);
      if (score >= threshold) {
        results.push({ vector, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(({ vector }) => vector);
  }

  async similaritySearchByText(
    _queryText: string,
    limit: number = 10,
    threshold: number = 0.5,
  ): Promise<VectorData[]> {
    // 简单的模拟实现（实际项目中会调用真实的 embedding）
    const mockEmbedding = Array(1536)
      .fill(0)
      .map(() => Math.random());
    return this.similaritySearch(mockEmbedding, limit, threshold);
  }

  async deleteVector(id: string): Promise<boolean> {
    return this.vectors.delete(id);
  }

  async deleteVectors(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      if (this.vectors.delete(id)) {
        count++;
      }
    }
    return count;
  }

  async clearCollection(): Promise<boolean> {
    this.vectors.clear();
    return true;
  }
}

// ============================================================================
// 向量存储工厂
// ============================================================================

/**
 * 创建向量存储实例
 */
export function createVectorStorage(
  type: "memory" | "pgvector" = "memory",
): VectorStorage {
  switch (type) {
    case "memory":
      return new MemoryVectorStorage();
    case "pgvector":
      // 未来支持 pgvector 存储
      throw new Error("pgvector storage not implemented yet");
    default:
      throw new Error(`Unknown vector storage type: ${type}`);
  }
}

/**
 * 全局向量存储实例
 */
export const vectorStorage = createVectorStorage("memory");
