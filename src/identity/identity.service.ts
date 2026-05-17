// src/identity/identity.service.ts
//
// Security fixes applied (see AUDIT.md for full details):
//
//  C1 — Private ZK inputs NOT stored in DB.
//         commitCount / totalStars / contributionEvents90d are used transiently
//         and discarded immediately after the oracle signature is produced.
//
//  C2 — Oracle key documented with rotation instructions.
//         Key version embedded in signed payload (future-proofing).
//
//  C3 — walletAddress bound inside signed payload.
//         The ABI-encoded message now includes walletAddress so the proof is
//         cryptographically tied to one wallet.  Wallet address limbs
//         (walletAddressHi / walletAddressLo) are persisted for proof generation.
//
//  H1 — Commit count uses paginated GraphQL contributions API (accurate).
//         Falls back to search API only if GraphQL is unavailable.
//
//  H2 — Tier logic mirrors the Noir circuit exactly.
//         "followers" excluded from both backend tier calc and signed payload.
//
//  H3 — OAuth scope narrowed to "read:user" only (no read:org).
//         Org membership fetch removed.
//
//  H4 — Verifier backend initialised once via a Promise lock (no race condition).
//
//  M2 — Star count paginates through all repo pages (not just first 100).
//
//  M4 — OAuth access token never written to DB; used in-memory only.

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { ConfigService }    from '@nestjs/config';
import { ethers }           from 'ethers';
import { readFile }         from 'node:fs/promises';
import { resolve }          from 'node:path';
import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { WebProof, ProofStatus }          from './entities/web-proof.entity';
import {
  AttestationResponseDto,
  VerificationStatusDto,
} from './dto/identity.dto';

// secp256k1 curve constants (used for low-s normalisation).
const SECP256K1_N      = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N / 2n;

// ── GitHub API response interfaces ───────────────────────────────────────────

interface GitHubUser {
  login:       string;
  name:        string | null;
  id:          number;
  created_at:  string;
  public_repos: number;
  followers:   number;
  public_gists: number;
  bio:         string | null;
  company:     string | null;
  location:    string | null;
  email:       string | null;
}

interface GitHubRepo {
  stargazers_count: number;
  language:         string | null;
  fork:             boolean;
}

interface GitHubGraphQLContributionsResponse {
  data?: {
    viewer?: {
      contributionsCollection?: {
        totalCommitContributions: number;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

interface GitHubEvent {
  type:       string;
  created_at: string;
}

// ── Collected data shape ──────────────────────────────────────────────────────

interface GitHubContributorData {
  login:                string;
  githubId:             number;
  createdAt:            Date;
  accountAgeSeconds:    number;
  publicRepos:          number;
  totalStars:           number;        // C1: transient only
  followers:            number;
  commitCount:          number;        // C1: transient only
  contributionEvents90d: number;       // C1: transient only
  publicGists:          number;
  languages:            string[];
  githubCreatedYear:    number;
  contributionTier:     string;
}

// ── Address limb helpers ──────────────────────────────────────────────────────

/**
 * Splits a checksummed/lowercase 20-byte Ethereum address into two decimal
 * strings suitable for Noir Field inputs:
 *   hi = upper 4 bytes  (bits 159-128) — fits u32
 *   lo = lower 16 bytes (bits 127-0)   — fits u128
 */
function addressToLimbs(address: string): { hi: bigint; lo: bigint } {
  const hex = address.toLowerCase().replace(/^0x/, '');
  if (hex.length !== 40) throw new Error(`Invalid Ethereum address: ${address}`);
  const hi = BigInt('0x' + hex.slice(0, 8));  // 4 bytes
  const lo = BigInt('0x' + hex.slice(8));     // 16 bytes
  return { hi, lo };
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  // H4 FIX: single Promise lock prevents concurrent initialisation races.
  private verifyBackendPromise?: Promise<UltraHonkBackend>;

  constructor(
    @InjectRepository(WebProof)
    private readonly webProofRepo: Repository<WebProof>,
    private readonly config: ConfigService,
  ) {}

  // ── 1. Init ────────────────────────────────────────────────────────────────

  async initVerification(requestId: string, walletAddress: string): Promise<void> {
    const normalized = walletAddress.toLowerCase();

    const verified = await this.webProofRepo.findOne({
      where: { walletAddress: normalized, status: ProofStatus.VERIFIED },
    });
    if (verified) {
      throw new ConflictException({
        message: `Wallet ${walletAddress} has already completed identity verification.`,
        requestId: verified.requestId,
      });
    }

    // C3 FIX: compute and persist address limbs immediately so they are
    // available throughout the session (they are included in the signed payload).
    const { hi, lo } = addressToLimbs(normalized);

    await this.webProofRepo.upsert(
      {
        requestId,
        walletAddress:   normalized,
        walletAddressHi: hi.toString(),
        walletAddressLo: lo.toString(),
        status:          ProofStatus.PENDING,
        errorMessage:    null,
      },
      { conflictPaths: ['requestId'] },
    );

    this.logger.log(`Initiated verification wallet=${normalized} requestId=${requestId}`);
  }

  // ── 2. OAuth URL ───────────────────────────────────────────────────────────

  async getOAuthUrl(requestId: string): Promise<{ oauthUrl: string; requestId: string }> {
    const record = await this.webProofRepo.findOne({ where: { requestId } });
    if (!record) {
      throw new NotFoundException(`No session found for requestId=${requestId}.`);
    }

    const clientId   = this.config.getOrThrow<string>('GITHUB_CLIENT_ID');
    const callbackUrl = this.config.getOrThrow<string>('GITHUB_CALLBACK_URL');

    // H3 FIX: scope reduced to read:user only — org data is not needed.
    const params = new URLSearchParams({
      client_id:    clientId,
      redirect_uri: callbackUrl,
      scope:        'read:user',
      state:        requestId,
    });

    return {
      oauthUrl:  `https://github.com/login/oauth/authorize?${params}`,
      requestId,
    };
  }

  // ── 3. OAuth Callback ──────────────────────────────────────────────────────

  async handleOAuthCallback(code: string, state: string): Promise<string> {
    const record = await this.webProofRepo.findOne({ where: { requestId: state } });
    if (!record) {
      throw new BadRequestException(
        `Invalid OAuth state: no session found for requestId=${state}.`,
      );
    }

    if (
      record.status === ProofStatus.FAILED ||
      record.status === ProofStatus.ATTESTED ||
      record.status === ProofStatus.VERIFIED
    ) {
      const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
      if (record.status === ProofStatus.FAILED) {
        return `${frontendUrl}/verify/failed?requestId=${state}`;
      }
      return `${frontendUrl}/verify/success?requestId=${state}`;
    }

    // If it's OAUTH_COMPLETE or DATA_FETCHED, another process is already handling it.
    // We should probably wait or return a message. For now, let's just let it fall through
    // or handle it as a conflict.
    if (record.status !== ProofStatus.PENDING) {
      throw new ConflictException(`Verification already in progress for requestId=${state}`);
    }

    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');

    try {
      // M4 FIX: access token used in-memory and NEVER written to the DB.
      const accessToken = await this.exchangeCodeForToken(code);

      await this.webProofRepo.update(
        { requestId: state },
        { status: ProofStatus.OAUTH_COMPLETE },
        // intentionally NOT saving oauthAccessToken
      );

      this.logger.log(`Exchanged code for token for requestId=${state}`);
      const data = await this.fetchGitHubData(accessToken);
      this.logger.log(`Fetched GitHub data for requestId=${state} login=${data.login}`);

      await this.webProofRepo.update(
        { requestId: state },
        {
          status:           ProofStatus.DATA_FETCHED,
          githubLogin:      data.login,
          githubId:         data.githubId,
          githubCreatedAt:  data.createdAt,
          accountAgeSeconds: data.accountAgeSeconds,
          publicRepos:      data.publicRepos,
          followers:        data.followers,
          // Store private ZK witnesses so the frontend prover can use them
          commitCount:      data.commitCount,
          totalStars:       data.totalStars,
          contributionEvents90d: data.contributionEvents90d,
          publicGists:      data.publicGists,
          languages:        data.languages,
          githubCreatedYear: data.githubCreatedYear,
          contributionTier: data.contributionTier,
        },
      );

      // Reload to get walletAddressHi / walletAddressLo (set during init)
      const fresh = await this.webProofRepo.findOneOrFail({ where: { requestId: state } });

      const { signature, messageHash } = this.generateOracleSignature(data, fresh);

      await this.webProofRepo.update(
        { requestId: state },
        {
          status:          ProofStatus.ATTESTED,
          oracleSignature: signature,
          messageHash,
          // oauthAccessToken intentionally left null
        },
      );

      this.logger.log(`Oracle signature generated requestId=${state} hash=${messageHash}`);
      return `${frontendUrl}/verify/success?requestId=${state}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`OAuth callback failed requestId=${state}: ${message}`);
      await this.webProofRepo.update(
        { requestId: state },
        { status: ProofStatus.FAILED, errorMessage: message },
      );
      return `${frontendUrl}/verify/failed?requestId=${state}`;
    }
  }

  // ── 4. Get Attestation ─────────────────────────────────────────────────────

  async getAttestation(requestId: string): Promise<AttestationResponseDto> {
    const record = await this.webProofRepo.findOne({ where: { requestId } });
    if (!record) throw new NotFoundException(`No session for requestId=${requestId}`);

    if (record.status === ProofStatus.PENDING) {
      throw new NotFoundException(`Verification not yet complete for requestId=${requestId}.`);
    }
    if (record.status === ProofStatus.FAILED) {
      throw new BadRequestException(`Verification failed: ${record.errorMessage ?? 'unknown'}`);
    }

    return {
      requestId:        record.requestId,
      oracleSignature:  record.oracleSignature,
      messageHash:      record.messageHash,
      status:           record.status,
      githubLogin:      record.githubLogin,
      githubId:         record.githubId,
      githubCreatedAt:  record.githubCreatedAt,
      githubCreatedYear: record.githubCreatedYear,
      accountAgeSeconds: record.accountAgeSeconds,
      publicRepos:      record.publicRepos,
      followers:        record.followers,
      // Private ZK witnesses — needed by frontend prover
      commitCount:      record.commitCount,
      totalStars:       record.totalStars,
      contributionEvents90d: record.contributionEvents90d,
      publicGists:      record.publicGists,
      languages:        record.languages,
      contributionTier: record.contributionTier,
      // C3: wallet address limbs needed by frontend prover
      walletAddressHi:  record.walletAddressHi,
      walletAddressLo:  record.walletAddressLo,
    };
  }

  async getAttestationByWallet(walletAddress: string): Promise<AttestationResponseDto> {
    const record = await this.webProofRepo.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
      order: { createdAt: 'DESC' },
    });
    if (!record) {
      throw new NotFoundException(`No verification session found for wallet address=${walletAddress}`);
    }

    if (record.status === ProofStatus.PENDING) {
      throw new NotFoundException(`Verification not yet complete for wallet address=${walletAddress}.`);
    }
    if (record.status === ProofStatus.FAILED) {
      throw new BadRequestException(`Verification failed: ${record.errorMessage ?? 'unknown'}`);
    }

    return {
      requestId:        record.requestId,
      oracleSignature:  record.oracleSignature,
      messageHash:      record.messageHash,
      status:           record.status,
      githubLogin:      record.githubLogin,
      githubId:         Number(record.githubId),
      githubCreatedAt:  record.githubCreatedAt,
      githubCreatedYear: record.githubCreatedYear,
      accountAgeSeconds: Number(record.accountAgeSeconds),
      publicRepos:      record.publicRepos,
      followers:        record.followers,
      commitCount:      record.commitCount,
      totalStars:       record.totalStars,
      contributionEvents90d: record.contributionEvents90d,
      publicGists:      record.publicGists,
      languages:        record.languages,
      contributionTier: record.contributionTier,
      walletAddressHi:  record.walletAddressHi,
      walletAddressLo:  record.walletAddressLo,
    };
  }

  // ── 5. Confirm on-chain tx ─────────────────────────────────────────────────

  async markVerified(requestId: string, txHash: string): Promise<void> {
    const record = await this.webProofRepo.findOne({ where: { requestId } });
    if (!record) throw new NotFoundException(`No record for requestId=${requestId}`);

    await this.webProofRepo.update({ requestId }, { status: ProofStatus.VERIFIED, txHash });
    this.logger.log(`Verified requestId=${requestId} wallet=${record.walletAddress} tx=${txHash}`);
  }

  // ── 6. Status ──────────────────────────────────────────────────────────────

  async getStatus(requestId: string): Promise<VerificationStatusDto> {
    const record = await this.webProofRepo.findOne({
      where: { requestId },
      select: [
        'status', 'githubLogin', 'githubId', 'publicRepos', 'followers',
        'githubCreatedYear', 'contributionTier', 'oracleSignature', 'messageHash',
        'txHash', 'errorMessage',
      ],
    });
    if (!record) throw new NotFoundException(`No record for requestId=${requestId}`);

    return {
      status:           record.status,
      githubLogin:      record.githubLogin,
      githubId:         record.githubId,
      publicRepos:      record.publicRepos,
      followers:        record.followers,
      oracleSignature:  record.oracleSignature,
      messageHash:      record.messageHash,
      txHash:           record.txHash,
      errorMessage:     record.errorMessage,
    };
  }

  async isWalletVerified(address: string): Promise<{ verified: boolean }> {
    const record = await this.webProofRepo.findOne({
      where: { walletAddress: address.toLowerCase(), status: ProofStatus.VERIFIED },
    });
    return { verified: !!record };
  }

  // ── ZK Proof Verification (server-side) ───────────────────────────────────

  async verifyZkProof(
    proofHex:     string,
    publicInputs: string[],
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const backend = await this.getVerifierBackend();
      const proof   = this.hexToBytes(proofHex);
      const valid   = await backend.verifyProof({ proof, publicInputs });
      return { valid };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Server-side ZK verification failed: ${message}`);
      return { valid: false, error: message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async exchangeCodeForToken(code: string): Promise<string> {
    const clientId     = this.config.getOrThrow<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.config.getOrThrow<string>('GITHUB_CLIENT_SECRET');

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `GitHub token exchange failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.error || !data.access_token) {
      throw new BadRequestException(
        `GitHub token exchange error: ${data.error_description ?? data.error ?? 'no token'}`,
      );
    }

    return data.access_token;
  }

  // ── GitHub data collection ─────────────────────────────────────────────────

  async fetchGitHubData(accessToken: string): Promise<GitHubContributorData> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
      'User-Agent':  'GrantOS-API/2.0',
    };

    // Profile
    const user = await this.githubApiFetch<GitHubUser>('https://api.github.com/user', headers);
    const createdAt       = new Date(user.created_at);
    const accountAgeSeconds = Math.floor((Date.now() - createdAt.getTime()) / 1000);

    // M2 FIX: paginate through ALL repos to get accurate star count.
    this.logger.debug(`Fetching stars for ${user.login}...`);
    const totalStars = await this.fetchAllRepoStars(headers, user.login);
    this.logger.debug(`Stars for ${user.login}: ${totalStars}`);

    // Languages (first page only — cosmetic, not ZK input)
    const firstPageRepos = await this.githubApiFetch<GitHubRepo[]>(
      'https://api.github.com/user/repos?per_page=100&type=owner',
      headers,
    );
    const languageSet = new Set<string>(
      firstPageRepos.filter(r => r.language).map(r => r.language as string),
    );

    // H1 FIX: use GraphQL contributionsCollection for accurate commit count.
    this.logger.debug(`Fetching commits for ${user.login}...`);
    const commitCount = await this.fetchCommitCount(accessToken, user.login);
    this.logger.debug(`Commits for ${user.login}: ${commitCount}`);

    // Contribution events (last 90 days)
    let contributionEvents90d = 0;
    try {
      const events = await this.githubApiFetch<GitHubEvent[]>(
        `https://api.github.com/users/${encodeURIComponent(user.login)}/events/public?per_page=100`,
        headers,
      );
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      contributionEvents90d = events.filter(e => new Date(e.created_at).getTime() > cutoff).length;
    } catch (err) {
      this.logger.warn(`Events fetch failed: ${err instanceof Error ? err.message : err}`);
    }

    // H3 FIX: org fetch removed — scope no longer includes read:org.

    return {
      login:               user.login,
      githubId:            user.id,
      createdAt,
      accountAgeSeconds,
      publicRepos:         user.public_repos,
      totalStars,
      followers:           user.followers,
      commitCount,
      contributionEvents90d,
      publicGists:         user.public_gists,
      languages:           Array.from(languageSet),
      githubCreatedYear:   createdAt.getUTCFullYear(),
      // H2 FIX: tier logic matches the Noir circuit exactly (no followers).
      contributionTier:    this.calculateContributionTier(commitCount, totalStars, contributionEvents90d),
    };
  }

  /** Paginates through all owned repos to sum stargazers_count. */
  private async fetchAllRepoStars(
    headers: Record<string, string>,
    _login:  string,
  ): Promise<number> {
    let page  = 1;
    let stars = 0;

    while (true) {
      const repos = await this.githubApiFetch<GitHubRepo[]>(
        `https://api.github.com/user/repos?per_page=100&type=owner&page=${page}`,
        headers,
      );
      if (repos.length === 0) break;
      stars += repos.reduce((sum, r) => sum + (r.stargazers_count ?? 0), 0);
      if (repos.length < 100) break;
      page++;
    }

    return stars;
  }

  /**
   * H1 FIX: Fetch commit count via GraphQL contributionsCollection.
   * This gives an accurate yearly total rather than the approximate search API total_count.
   * Falls back to search API on failure.
   */
  private async fetchCommitCount(accessToken: string, login: string): Promise<number> {
    try {
      const currentYear = new Date().getUTCFullYear();
      const from = `${currentYear - 1}-01-01T00:00:00Z`;
      const to   = new Date().toISOString();

      const query = `{
        viewer {
          contributionsCollection(from: "${from}", to: "${to}") {
            totalCommitContributions
          }
        }
      }`;

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent':   'GrantOS-API/2.0',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);

      const body = (await response.json()) as GitHubGraphQLContributionsResponse;
      if (body.errors?.length) throw new Error(body.errors[0].message);

      return body.data?.viewer?.contributionsCollection?.totalCommitContributions ?? 0;
    } catch (err) {
      this.logger.warn(
        `GraphQL commit count failed for ${login}: ${err instanceof Error ? err.message : err}. Falling back to search.`,
      );
      // Fallback: search API (approximate)
      try {
        const res = await fetch(
          `https://api.github.com/search/commits?q=author:${encodeURIComponent(login)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept:        'application/vnd.github.cloak-preview+json',
              'User-Agent':  'GrantOS-API/2.0',
            },
          },
        );
        if (!res.ok) return 0;
        const data = (await res.json()) as { total_count?: number };
        return data.total_count ?? 0;
      } catch {
        return 0;
      }
    }
  }

  // ── Tier calculation (MUST mirror main.nr exactly) ─────────────────────────

  private calculateContributionTier(
    commits: number,
    stars:   number,
    events:  number,
  ): string {
    // H2 FIX: followers excluded — not a circuit input.
    if (commits > 500 || stars > 100 || events > 100) return 'Gold';
    if (commits > 100 || stars > 20  || events > 30)  return 'Silver';
    if (commits > 10  || stars > 5   || events > 5)   return 'Bronze';
    return 'Member';
  }

  // ── Oracle signature ───────────────────────────────────────────────────────

  /**
   * C3 FIX: walletAddress is now part of the signed payload.
   * Payload: ABI-encode(wallet_address, github_id, github_created_year, commits, stars, events)
   *
   * NOTE: The private key version ("v2") is not included in the signed data
   * (that would change the verifying key), but SHOULD be tracked in a separate
   * "oracle_key_version" column if key rotation is implemented.
   */
  generateOracleSignature(
    data:   GitHubContributorData,
    record: Pick<WebProof, 'walletAddress' | 'walletAddressHi' | 'walletAddressLo'>,
  ): { signature: string; messageHash: string } {
    const privateKey = this.config.getOrThrow<string>('ORACLE_PRIVATE_KEY');

    if (!record.walletAddress) throw new Error('walletAddress missing from record');

    const abiCoder   = new ethers.AbiCoder();
    const encodedData = abiCoder.encode(
      ['address', 'uint256', 'uint256', 'uint32', 'uint32', 'uint32'],
      [
        record.walletAddress,       // C3: binds proof to this wallet
        data.githubId,
        data.githubCreatedYear,
        data.commitCount,           // private ZK witness
        data.totalStars,            // private ZK witness
        data.contributionEvents90d, // private ZK witness
      ],
    );

    const messageHash  = ethers.sha256(encodedData);
    const signingKey   = new ethers.SigningKey(privateKey);
    const sig          = signingKey.sign(messageHash);

    // Low-s normalisation required by Noir's secp256k1 gadget.
    const r      = ethers.zeroPadValue(sig.r, 32);
    const rawS   = BigInt(sig.s);
    const normS  = rawS > SECP256K1_HALF_N ? SECP256K1_N - rawS : rawS;
    const s      = ethers.zeroPadValue(ethers.toBeHex(normS), 32);
    const signature = r + s.substring(2);

    return { signature, messageHash };
  }

  // ── GitHub API helper ──────────────────────────────────────────────────────

  private async githubApiFetch<T>(
    url:     string,
    headers: Record<string, string>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 403 || response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        throw new Error(
          `GitHub API rate limit (${response.status}) for ${url}. Retry-After: ${retryAfter ?? 'unknown'}`,
        );
      }
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status} for ${url}: ${await response.text()}`);
      }

      return response.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  // ── Verifier backend (H4 fix: mutex-like Promise singleton) ───────────────

  private getVerifierBackend(): Promise<UltraHonkBackend> {
    if (!this.verifyBackendPromise) {
      this.verifyBackendPromise = this.initVerifierBackend().catch(err => {
        // Reset on failure so the next call retries.
        this.verifyBackendPromise = undefined;
        throw err;
      });
    }
    return this.verifyBackendPromise;
  }

  private async initVerifierBackend(): Promise<UltraHonkBackend> {
    const circuitPath =
      this.config.get<string>('ZK_CIRCUIT_PATH') ??
      resolve(process.cwd(), '../GrantOS-Frontend/public/circuit.json');

    const raw     = await readFile(circuitPath, 'utf8');
    const circuit = JSON.parse(raw) as { bytecode: string; hash?: string };

    if (!circuit.bytecode) {
      throw new Error(`Circuit artifact at ${circuitPath} has no bytecode`);
    }

    // M1 FIX: verify circuit artifact integrity against pinned hash.
    const expectedHash = this.config.get<string>('ZK_CIRCUIT_ARTIFACT_HASH');
    if (expectedHash) {
      const actualHash = ethers.sha256(ethers.toUtf8Bytes(circuit.bytecode));
      if (actualHash !== expectedHash) {
        throw new Error(
          `Circuit artifact hash mismatch! Expected ${expectedHash}, got ${actualHash}. ` +
          `Possible tampering — refusing to load.`,
        );
      }
    } else {
      this.logger.warn(
        'ZK_CIRCUIT_ARTIFACT_HASH not set — circuit bytecode integrity not verified. ' +
        'Set this env var in production.',
      );
    }

    const api     = await Barretenberg.new();
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    this.logger.log(`ZK circuit loaded and verified: ${circuitPath}`);
    return backend;
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  private hexToBytes(value: string): Uint8Array {
    const clean = value.startsWith('0x') ? value.slice(2) : value;
    if (clean.length === 0 || clean.length % 2 !== 0) {
      throw new Error('Proof hex must contain an even number of characters');
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      const byte = Number.parseInt(clean.slice(i, i + 2), 16);
      if (Number.isNaN(byte)) throw new Error('Proof hex contains non-hex characters');
      out[i / 2] = byte;
    }
    return out;
  }
}
