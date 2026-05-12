// src/identity/dto/identity.dto.ts
// Data Transfer Objects for the GitHub OAuth Oracle + EAS Identity Binding flow.
// Validated by class-validator before touching any service logic.

import {
  IsArray,
  IsEthereumAddress,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Request DTOs ──────────────────────────────────────────────────────────────

export class InitVerificationDto {
  @ApiPropertyOptional({
    description:
      'UUID to track this verification session. Auto-generated if omitted.',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @ApiProperty({
    description: 'The wallet address of the builder initiating verification',
    example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  })
  @IsEthereumAddress()
  walletAddress: string;
}

export class ConfirmTxDto {
  @ApiProperty({
    description:
      'The on-chain transaction hash after any additional action is submitted',
    example: '0xabc123...',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'txHash must be a valid 32-byte hex string prefixed with 0x',
  })
  txHash: string;
}

export class VerifyZkProofDto {
  @ApiProperty({
    description: 'Generated proof bytes encoded as 0x-prefixed hex',
    example: '0xabcdef1234',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]+$/, {
    message: 'proof must be a valid hex string prefixed with 0x',
  })
  proof: string;

  @ApiProperty({
    description: 'Public inputs returned by proof generation',
    type: [String],
    example: ['1', '12345678', '2019'],
  })
  @IsArray()
  @IsString({ each: true })
  publicInputs: string[];
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

export class InitVerificationResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  requestId: string;
}

export class OAuthUrlResponseDto {
  @ApiProperty({
    description: 'The GitHub OAuth authorization URL to redirect the user to.',
    example: 'https://github.com/login/oauth/authorize?client_id=...&state=...',
  })
  oauthUrl: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  requestId: string;
}

export class AttestationResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  requestId: string;

  @ApiPropertyOptional({ example: '0xabcdef1234567890...' })
  oracleSignature?: string | null;

  @ApiPropertyOptional({ example: '0xdeadbeef...' })
  messageHash?: string | null;

  @ApiPropertyOptional({ example: 'attested' })
  status?: string;

  // GitHub data
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

  @ApiPropertyOptional({ example: 128 })
  totalStars?: number | null;

  @ApiPropertyOptional({ example: 200 })
  followers?: number | null;

  @ApiPropertyOptional({ example: 1500 })
  commitCount?: number | null;

  @ApiPropertyOptional({ example: 85 })
  contributionEvents90d?: number | null;

  @ApiPropertyOptional({ example: 5 })
  publicGists?: number | null;

  @ApiPropertyOptional({ example: ['TypeScript', 'Rust', 'Solidity'] })
  languages?: string[] | null;

  @ApiPropertyOptional({ example: ['ethereum', 'openzeppelin'] })
  orgs?: string[] | null;

  @ApiPropertyOptional({ example: 'Gold' })
  contributionTier?: string | null;
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

  @ApiPropertyOptional({ example: 2019 })
  githubCreatedYear?: number | null;

  @ApiPropertyOptional({ example: 42 })
  publicRepos?: number | null;

  @ApiPropertyOptional({ example: 128 })
  totalStars?: number | null;

  @ApiPropertyOptional({ example: 200 })
  followers?: number | null;

  @ApiPropertyOptional({ example: 1500 })
  commitCount?: number | null;

  @ApiPropertyOptional({ example: 'Gold' })
  contributionTier?: string | null;

  @ApiPropertyOptional({ example: '0xabcdef...' })
  oracleSignature?: string | null;

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

  @ApiPropertyOptional({
    example: 'Proof verification failed: malformed commitment.',
  })
  error?: string;
}
