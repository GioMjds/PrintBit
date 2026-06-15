import { getSqliteDb } from '../sqlite-storage';

export interface PricingAnalysisCacheEntry {
  fileHash: string;
  configFingerprint: string;
  algorithmVersion: number;
  contentType: string;
  pageCount: number;
  analysisJson: string;
  createdAt: string;
  updatedAt: string;
}

export class PricingAnalysisCacheSqliteStore {
  getByHash(
    fileHash: string,
    configFingerprint: string,
    algorithmVersion: number,
  ): PricingAnalysisCacheEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          file_hash,
          config_fingerprint,
          algorithm_version,
          content_type,
          page_count,
          analysis_json,
          created_at,
          updated_at
         FROM pricing_analysis_cache
         WHERE file_hash = ? AND config_fingerprint = ? AND algorithm_version = ?
         LIMIT 1`,
      )
      .get(fileHash, configFingerprint, algorithmVersion) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.toEntry(row);
  }

  upsert(entry: PricingAnalysisCacheEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT INTO pricing_analysis_cache (
          file_hash,
          config_fingerprint,
          algorithm_version,
          content_type,
          page_count,
          analysis_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_hash, config_fingerprint) DO UPDATE SET
          algorithm_version = excluded.algorithm_version,
          content_type = excluded.content_type,
          page_count = excluded.page_count,
          analysis_json = excluded.analysis_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        entry.fileHash,
        entry.configFingerprint,
        entry.algorithmVersion,
        entry.contentType,
        Math.max(0, Math.floor(entry.pageCount)),
        entry.analysisJson,
        entry.createdAt,
        entry.updatedAt,
      );
  }

  private toEntry(row: Record<string, unknown>): PricingAnalysisCacheEntry {
    return {
      fileHash: String(row.file_hash ?? ''),
      configFingerprint: String(row.config_fingerprint ?? ''),
      algorithmVersion:
        typeof row.algorithm_version === 'number' &&
        Number.isFinite(row.algorithm_version)
          ? Math.max(0, Math.floor(row.algorithm_version))
          : 0,
      contentType: String(row.content_type ?? ''),
      pageCount:
        typeof row.page_count === 'number' && Number.isFinite(row.page_count)
          ? Math.max(0, Math.floor(row.page_count))
          : 0,
      analysisJson: String(row.analysis_json ?? ''),
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
    };
  }
}

export const pricingAnalysisCacheStore = new PricingAnalysisCacheSqliteStore();
