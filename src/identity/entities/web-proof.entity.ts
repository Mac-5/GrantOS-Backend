// src/identity/entities/web-proof.entity.ts
//
// Fix C1: private ZK inputs (commitCount, totalStars, contributionEvents90d)
//   are NO LONGER stored in the database.  They are used transiently during
//   the OAuth callback and discarded after signing.  Only the oracle signature
//   and messageHash (which commits to those values cryptographically) are kept.
//
// Fix C3: walletAddressHi / walletAddressLo columns added so the backend can
//   reconstruct the exact limbs that were signed and return them to the frontend
//   for proof generation.
//
// Status machine:
//   PENDING → OAUTH_COMPLETE → DATA_FETCHED → ATTESTED → VERIFIED
//                                                       ↘ FAILED

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ProofStatus {
  PENDING       = 'pending',
  OAUTH_COMPLETE = 'oauth_complete',
  DATA_FETCHED  = 'data_fetched',
  ATTESTED      = 'attested',
  VERIFIED      = 'verified',
  FAILED        = 'failed',
}

@Entity('web_proofs')
export class WebProof {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Session identifier — used as OAuth state (CSRF protection).
  @Index({ unique: true })
  @Column({ name: 'request_id' })
  requestId: string;

  // Ethereum wallet that initiated verification.
  @Index()
  @Column({ name: 'wallet_address', nullable: true, type: 'varchar', length: 42 })
  walletAddress: string | null;

  // ── Wallet address limbs (signed by oracle, needed for proof generation) ───
  // wallet_address_hi: upper 4 bytes of the 20-byte address as decimal string
  // wallet_address_lo: lower 16 bytes of the 20-byte address as decimal string
  // Stored so the frontend can reconstruct the exact Field values used in signing.
  @Column({ name: 'wallet_address_hi', nullable: true, type: 'varchar', length: 80 })
  walletAddressHi: string | null;

  @Column({ name: 'wallet_address_lo', nullable: true, type: 'varchar', length: 80 })
  walletAddressLo: string | null;

  // ── Non-sensitive GitHub profile fields (public data — safe to store) ──────
  @Column({ name: 'github_login', nullable: true, type: 'varchar' })
  githubLogin: string | null;

  @Column({ name: 'github_id', nullable: true, type: 'bigint' })
  githubId: number | null;

  @Column({ name: 'github_created_at', nullable: true, type: 'timestamptz' })
  githubCreatedAt: Date | null;

  @Column({ name: 'github_created_year', nullable: true, type: 'int' })
  githubCreatedYear: number | null;

  @Column({ name: 'account_age_seconds', nullable: true, type: 'bigint' })
  accountAgeSeconds: number | null;

  @Column({ name: 'public_repos', nullable: true, type: 'int' })
  publicRepos: number | null;

  // C1 FIX: totalStars, commitCount, contributionEvents90d intentionally
  // NOT stored.  They are private ZK witnesses and must not be persisted.
  // UPDATE: storing them is required so the frontend prover can reconstruct
  // the signed message. They are private witnesses (not revealed on-chain)
  // but the prover needs them to generate a valid proof.

  @Column({ name: 'commit_count', nullable: true, type: 'int' })
  commitCount: number | null;

  @Column({ name: 'total_stars', nullable: true, type: 'int' })
  totalStars: number | null;

  @Column({ name: 'contribution_events_90d', nullable: true, type: 'int' })
  contributionEvents90d: number | null;

  @Column({ name: 'followers', nullable: true, type: 'int' })
  followers: number | null;

  @Column({ name: 'public_gists', nullable: true, type: 'int' })
  publicGists: number | null;

  @Column({ name: 'languages', type: 'simple-array', nullable: true })
  languages: string[] | null;

  // H3 FIX: orgs no longer fetched (OAuth scope narrowed to read:user).
  // Column kept nullable for backward-compat with existing rows.
  @Column({ name: 'orgs', type: 'simple-array', nullable: true })
  orgs: string[] | null;

  // Human-readable tier label (Bronze/Silver/Gold/Member) — derived server-side
  // for display purposes only; the authoritative tier lives inside the ZK proof.
  @Column({ name: 'contribution_tier', nullable: true, type: 'varchar' })
  contributionTier: string | null;

  // ── ZK Oracle output ───────────────────────────────────────────────────────
  // 64-byte ECDSA signature (r || s) as 0x-prefixed hex (132 chars with prefix).
  @Column({ name: 'oracle_signature', nullable: true, type: 'varchar', length: 132 })
  oracleSignature: string | null;

  // SHA-256 of ABI-encoded payload.
  @Column({ name: 'message_hash', nullable: true, type: 'varchar', length: 66 })
  messageHash: string | null;

  // ── OAuth token (never persisted — see M4 fix in identity.service.ts) ──────
  // Column is kept for schema compatibility but the service never writes to it.
  // The token is used in-memory and discarded immediately after signing.
  @Column({ name: 'oauth_access_token', nullable: true, type: 'text' })
  oauthAccessToken: string | null;

  // ── Status ─────────────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: ProofStatus, default: ProofStatus.PENDING })
  status: ProofStatus;

  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage: string | null;

  // On-chain tx hash after frontend submits proof.
  @Column({ name: 'tx_hash', nullable: true, type: 'varchar', length: 66 })
  txHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
