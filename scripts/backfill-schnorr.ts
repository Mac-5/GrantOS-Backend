// One-off backfill: add the missing Grumpkin-Schnorr oracle signature to an
// identity attestation that predates the v3 circuit.
//
//   npx ts-node -r tsconfig-paths/register scripts/backfill-schnorr.ts 0xYourWallet
//
// Why this exists: rows created before the v3 migration only have the ECDSA
// `oracle_signature` (what the on-chain OracleAttestationVerifier checks via
// ecrecover). The v3 ZK proof flow also needs `oracle_schnorr_signature`, which
// is signed over the GitHub stats ALREADY stored on the row — so we can recompute
// it without re-running OAuth or touching anything on-chain.
//
// Boots a Nest standalone context so it reuses the app's exact DB config and the
// same ORACLE_SCHNORR_PRIVATE_KEY the circuit was pinned against.

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { IdentityService } from '../src/identity/identity.service';
import { WebProof, ProofStatus } from '../src/identity/entities/web-proof.entity';

async function main() {
  const wallet = process.argv[2]?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) {
    throw new Error('Usage: ts-node scripts/backfill-schnorr.ts 0x<40-hex-wallet>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const repo = app.get<Repository<WebProof>>(getRepositoryToken(WebProof));
    const identity = app.get(IdentityService);

    // Prefer the VERIFIED row (the one blocking re-verify); fall back to ATTESTED.
    const row =
      (await repo.findOne({ where: { walletAddress: wallet, status: ProofStatus.VERIFIED } })) ??
      (await repo.findOne({ where: { walletAddress: wallet, status: ProofStatus.ATTESTED } }));

    if (!row) {
      throw new Error(`No VERIFIED/ATTESTED web_proofs row for wallet ${wallet}`);
    }
    if (row.oracleSchnorrSignature) {
      console.log(`Row ${row.requestId} already has a Schnorr signature — nothing to do.`);
      return;
    }

    const schnorr = await identity.generateSchnorrAttestation(row);
    if (!schnorr) {
      throw new Error(
        'generateSchnorrAttestation returned null — is ORACLE_SCHNORR_PRIVATE_KEY set in this env?',
      );
    }

    await repo.update({ requestId: row.requestId }, { oracleSchnorrSignature: schnorr });
    console.log(`Backfilled Schnorr signature on row ${row.requestId} (wallet ${wallet}).`);
    console.log(`  oracle_schnorr_signature = ${schnorr}`);
    console.log('Re-run milestone proof generation — it should pass the v3 check now.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
