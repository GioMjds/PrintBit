import { migrateLegacyDbJsonToSqlite } from '@/core/database/db';

function printCounts(label: string, counts: Record<string, number>): void {
  const parts = Object.entries(counts).map(([key, value]) => `${key}=${value}`);
  console.log(`[DB MIGRATE] ${label}: ${parts.join(', ')}`);
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const migration = await migrateLegacyDbJsonToSqlite({ force });

  console.log(
    `[DB MIGRATE] source=${migration.source} force=${force ? 'yes' : 'no'} imported=${migration.imported ? 'yes' : 'no'}`,
  );

  if (migration.source === 'none') {
    console.log('[DB MIGRATE] No legacy source detected (db.json or runtime_state).');
    return;
  }

  if (migration.result.skipped) {
    console.log('[DB MIGRATE] Import skipped (already completed or no import candidates).');
    return;
  }

  printCounts('attempted', migration.result.attempted);
  printCounts('inserted', migration.result.inserted);
  printCounts('skipped-orphans', migration.result.skippedOrphans);
}

main().catch((error: unknown) => {
  console.error(
    '[DB MIGRATE] Migration failed.',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
