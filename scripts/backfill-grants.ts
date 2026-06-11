// One-off / on-demand backfill: index any on-chain grants missing from the
// `grants` table, so committee members can see them at /committee and
// /committee/reviews.
//
//   npx ts-node -r tsconfig-paths/register scripts/backfill-grants.ts
//
// This is now a thin wrapper around GrantIndexerService.reconcile() — the same
// reconciliation the backend runs automatically on startup and after each live
// GrantCreated event (see src/grant/grant-indexer.service.ts). Kept as a script
// for manual/ops use (e.g. force a re-sync without restarting the service).
//
// Requires ARBITRUM_RPC_URL and GRANT_FACTORY_ADDRESS in the environment.

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { GrantIndexerService } from '../src/grant/grant-indexer.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const indexer = app.get(GrantIndexerService);
    const { indexed, skipped, total } = await indexer.reconcile();
    console.log(
      `\nDone. Indexed ${indexed}, skipped ${skipped} (already present) of ${total} on-chain grant(s).`,
    );
    console.log('Committee pages should now show grants for member wallets.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
