// src/identity/dto/identity.dto.ts
//
// Changes from v1:
//   - AttestationResponseDto now includes walletAddressHi / walletAddressLo
//     (needed by the frontend prover for the C3 wallet-binding fix).
//   - AttestationResponseDto NO LONGER includes commitCount / totalStars /
//     contributionEvents90d — these are private ZK inputs (C1 fix).
//   - VerificationStatusDto similarly pruned of private inputs.

import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Request DTOs ───────────────────────────────────────────────────────────────

export class InitVerificationDto {
  @ApiPropertyOptional({
    description: 'UUID for this session. Auto-generated if omitted.',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @ApiProperty({
    description: 'Wallet address initiating verification (EVM 0x… or Stellar G…)',
    example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  })
  @IsString()
  @Matches(/^(0x[a-fA-F0-9]{40}|G[A-Z2-7]{55})$/, {
    message: 'walletAddress must be an EVM 0x-address or a Stellar G-address',
  })
  walletAddress: string;
}

export class ConfirmTxDto {
  @ApiProperty({
    description: 'On-chain transaction hash after proof submission (EVM 0x… or Stellar 64-hex / contract id)',
    example: '0xabc123...',
  })
  @IsString()
  // Accept an EVM tx hash (0x + 64 hex), a Stellar tx hash (64 hex), or a
  // Stellar contract/account id (C…/G… base32, 56 chars).
  @Matches(/^(0x)?[a-fA-F0-9]{64}$|^[A-Z2-7]{56}$/, {
    message: 'txHash must be an EVM 0x-hash, a Stellar tx hash, or a Stellar contract id',
  })
  txHash: string;

  @ApiProperty({
    description: 'Chain the verification landed on',
    enum: ['evm', 'stellar'],
    required: false,
    default: 'evm',
  })
  @IsOptional()
  @IsString()
  chain?: 'evm' | 'stellar';
}

export class VerifyZkProofDto {
  @ApiProperty({ example: '0xabcdef1234' })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]+$/, { message: 'proof must be 0x-prefixed hex' })
  proof: string;

  @ApiProperty({ type: [String], example: ['1', '12345678', '2021', '3638845938', '...'] })
  @IsArray()
  @IsString({ each: true })
  publicInputs: string[];
}

// ── Response DTOs ──────────────────────────────────────────────────────────────

export class InitVerificationResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  requestId: string;
}

export class OAuthUrlResponseDto {
  @ApiProperty({ example: 'https://github.com/login/oauth/authorize?...' })
  oauthUrl: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  requestId: string;
}

export class AttestationResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  requestId: string;

  @ApiPropertyOptional({ example: '0xabcdef...' })
  oracleSignature?: string | null;

  @ApiPropertyOptional({
    example: '0xabcdef...',
    description: '64-byte Grumpkin Schnorr signature (s ‖ e) for the v3 ZK circuit',
  })
  oracleSchnorrSignature?: string | null;

  @ApiPropertyOptional({ example: '0xdeadbeef...' })
  messageHash?: string | null;

  @ApiPropertyOptional({ example: 'attested' })
  status?: string;

  // ── GitHub public profile fields ──────────────────────────────────────────
  @ApiPropertyOptional({ example: 'alice' })
  githubLogin?: string | null;

  @ApiPropertyOptional({ example: 12345678 })
  githubId?: number | null;

  @ApiPropertyOptional()
  githubCreatedAt?: Date | null;

  @ApiPropertyOptional({ example: 2019 })
  githubCreatedYear?: number | null;

  @ApiPropertyOptional({ example: 157680000 })
  accountAgeSeconds?: number | null;

  @ApiPropertyOptional({ example: 42 })
  publicRepos?: number | null;

  @ApiPropertyOptional({ example: 200 })
  followers?: number | null;

  @ApiPropertyOptional({ example: 5 })
  publicGists?: number | null;

  @ApiPropertyOptional({ example: ['TypeScript', 'Rust', 'Solidity'] })
  languages?: string[] | null;

  @ApiPropertyOptional({ example: 'Gold' })
  contributionTier?: string | null;

  // ── C3: Wallet address limbs for ZK proof generation ─────────────────────
  // These are the exact Field values the prover must pass to the circuit.
  @ApiPropertyOptional({
    description: 'Upper 4 bytes of walletAddress as decimal string (wallet_address_hi in circuit)',
    example: '3638845938',
  })
  walletAddressHi?: string | null;

  @ApiPropertyOptional({
    description: 'Lower 16 bytes of walletAddress as decimal string (wallet_address_lo in circuit)',
    example: '140075495586578064988875286336449888325',
  })
  walletAddressLo?: string | null;

  // The exact public inputs the on-chain OracleAttestationVerifier checks:
  // [tier, githubId, githubCreatedYear, walletAddressHi, walletAddressLo] as
  // 32-byte words. The frontend passes `oracleSignature` as `proof` and this
  // array as `publicInputs` to verifyIdentity — no ZK proving required.
  @ApiPropertyOptional({ type: [String] })
  publicInputs?: string[];

  // Private ZK witnesses — retained for backwards compatibility / analytics.
  // No longer required by the frontend (verification is now a native ecrecover).
  @ApiPropertyOptional({ example: 763 })
  commitCount?: number | null;

  @ApiPropertyOptional({ example: 7 })
  totalStars?: number | null;

  @ApiPropertyOptional({ example: 100 })
  contributionEvents90d?: number | null;
}

export class ConfirmResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '0xabc123...' })
  txHash: string;
}

export class VerificationStatusDto {
  @ApiProperty({ example: 'attested' })
  status: string;

  @ApiPropertyOptional({ example: 'alice' })
  githubLogin?: string | null;

  @ApiPropertyOptional({ example: 12345678 })
  githubId?: number | null;

  @ApiPropertyOptional({ example: 42 })
  publicRepos?: number | null;

  @ApiPropertyOptional({ example: 200 })
  followers?: number | null;

  @ApiPropertyOptional({ example: 'Gold' })
  contributionTier?: string | null;

  @ApiPropertyOptional({ example: '0xabcdef...' })
  oracleSignature?: string | null;

  @ApiPropertyOptional({
    example: '0xabcdef...',
    description: '64-byte Grumpkin Schnorr signature (s ‖ e) for the v3 ZK circuit',
  })
  oracleSchnorrSignature?: string | null;

  @ApiPropertyOptional({ example: '0xdeadbeef...' })
  messageHash?: string | null;

  @ApiPropertyOptional({ example: '0xabc...' })
  txHash?: string | null;

  @ApiPropertyOptional({ example: 'GitHub API rate limit exceeded' })
  errorMessage?: string | null;
}

export class VerifyZkProofResponseDto {
  @ApiProperty({ example: true })
  valid: boolean;

  @ApiPropertyOptional({ example: 'Proof verification failed: malformed commitment.' })
  error?: string;
}
