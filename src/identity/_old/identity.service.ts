// src/identity/identity.service.ts
// GitHub OAuth Oracle + EAS Identity Binding — all business logic.
//
// Flow:
//   1. initVerification    — creates a pending DB record
//   2. getOAuthUrl         — generates GitHub OAuth authorization URL
//   3. handleOAuthCallback — exchanges code, fetches GitHub data, issues EAS attestation
//   4. getAttestation      — returns EAS attestation UID + GitHub data
//   5. markVerified        — frontend confirms additional on-chain action
//   6. getStatus           — lightweight polling endpoint
//
// Constraints:
//   - No @reclaimprotocol/js-sdk or ZK proof SDK
//   - No @ethereum-attestation-service/eas-sdk — raw ethers.js ABI calls
//   - No @octokit/rest — native fetch only
//   - GitHub access token nulled after attestation

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { WebProof, ProofStatus } from './web-proof.entity';
import {
  AttestationResponseDto,
  VerificationStatusDto,
} from './identity.dto';

// secp256k1 curve order and low-s threshold used by Noir's verifier.
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N / 2n;

// ── GitHub API response interfaces ────────────────────────────────────────────

interface GitHubUser {
  login: string;
  name: string | null;
  id: number;
  created_at: string;
  public_repos: number;
  followers: number;
  following: number;
  public_gists: number;
  bio: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
}

interface GitHubRepo {
  stargazers_count: number;
  language: string | null;
}

interface GitHubCommitSearchResponse {
  total_count: number;
}

interface GitHubEvent {
  type: string;
  created_at: string;
}

interface GitHubOrg {
  login: string;
}

// ── Collected data shape ──────────────────────────────────────────────────────

interface GitHubContributorData {
  login: string;
  githubId: number;
  createdAt: Date;
  accountAgeSeconds: number;
  publicRepos: number;
  totalStars: number;
  followers: number;
  commitCount: number;
  contributionEvents90d: number;
  publicGists: number;
  languages: string[];
  orgs: string[];
  githubCreatedYear: number;
  contributionTier: string;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private verifyBackend?: UltraHonkBackend;

  constructor(
    @InjectRepository(WebProof)
    private readonly webProofRepo: Repository<WebProof>,
    private readonly config: ConfigService,
  ) {}

  // ── 1. Init ────────────────────────────────────────────────────────────────

  /**
   * Creates a pending DB record for this verification session.
   * Guards: one active verification per wallet, already-verified wallets rejected.
   */
  async initVerification(
    requestId: string,
    walletAddress: string,
  ): Promise<void> {
    const normalized = walletAddress.toLowerCase();

    // Reject wallets that already completed verification
    const verified = await this.webProofRepo.findOne({
      where: { walletAddress: normalized, status: ProofStatus.VERIFIED },
    });

    if (verified) {
      throw new ConflictException(
        `Wallet ${walletAddress} has already completed identity verification. ` +
          `Only one binding per wallet is allowed.`,
      );
    }

    await this.webProofRepo.upsert(
      {
        requestId,
        walletAddress: normalized,
        status: ProofStatus.PENDING,
        errorMessage: null,
      },
      { conflictPaths: ['requestId'] },
    );

    this.logger.log(
      `Initiated verification for wallet=${normalized} requestId=${requestId}`,
    );
  }

  // ── 2. OAuth URL ───────────────────────────────────────────────────────────

  /**
   * Generates a GitHub OAuth authorization URL with state = requestId.
   * The frontend redirects the user to this URL.
   */
  async getOAuthUrl(
    requestId: string,
  ): Promise<{ oauthUrl: string; requestId: string }> {
    const record = await this.webProofRepo.findOne({ where: { requestId } });

    if (!record) {
      throw new NotFoundException(
        `No verification session found for requestId=${requestId}. ` +
          `Call POST /identity/init first.`,
      );
    }

    const clientId = this.config.getOrThrow<string>('GITHUB_CLIENT_ID');
    const callbackUrl = this.config.getOrThrow<string>('GITHUB_CALLBACK_URL');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: 'read:user,read:org',
      state: requestId,
    });

    const oauthUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

    this.logger.log(`Generated OAuth URL for requestId=${requestId}`);

    return { oauthUrl, requestId };
  }

  // ── 3. OAuth Callback ─────────────────────────────────────────────────────

  /**
   * Handles the GitHub OAuth callback:
   *   1. Exchanges code for access token
   *   2. Fetches all GitHub contributor data
   *   3. Issues EAS attestation on-chain
   *   4. Returns redirect URL
   */
  async handleOAuthCallback(code: string, state: string): Promise<string> {
    // ── Validate state (CSRF protection) ────────────────────────────────────
    const record = await this.webProofRepo.findOne({
      where: { requestId: state },
    });

    if (!record) {
      throw new BadRequestException(
        `Invalid OAuth state: no session found for requestId=${state}. Possible CSRF attempt.`,
      );
    }

    if (record.status !== ProofStatus.PENDING) {
      // Session already processing or completed — redirect gracefully.
      // This handles browser double-requests and ngrok retries.
      const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
      if (record.status === ProofStatus.FAILED) {
        return `${frontendUrl}/verify/failed?requestId=${state}`;
      }
      this.logger.log(
        `Callback duplicate for requestId=${state} (status=${record.status}) — redirecting to success`,
      );
      return `${frontendUrl}/verify/success?requestId=${state}`;
    }

    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');

    try {
      // ── Step 1: Exchange code for access token ──────────────────────────────
      const accessToken = await this.exchangeCodeForToken(code);

      await this.webProofRepo.update(
        { requestId: state },
        {
          status: ProofStatus.OAUTH_COMPLETE,
          oauthAccessToken: accessToken,
        },
      );

      this.logger.log(`OAuth token obtained for requestId=${state}`);

      // ── Step 2: Fetch all GitHub data ───────────────────────────────────────
      const data = await this.fetchGitHubData(accessToken);

      await this.webProofRepo.update(
        { requestId: state },
        {
          status: ProofStatus.DATA_FETCHED,
          githubLogin: data.login,
          githubId: data.githubId,
          githubCreatedAt: data.createdAt,
          accountAgeSeconds: data.accountAgeSeconds,
          publicRepos: data.publicRepos,
          totalStars: data.totalStars,
          followers: data.followers,
          commitCount: data.commitCount,
          contributionEvents90d: data.contributionEvents90d,
          publicGists: data.publicGists,
          languages: data.languages,
          orgs: data.orgs,
          githubCreatedYear: data.githubCreatedYear,
          contributionTier: data.contributionTier,
        },
      );

      this.logger.log(
        `GitHub data fetched for requestId=${state} login=${data.login} ` +
          `repos=${data.publicRepos} stars=${data.totalStars} commits=${data.commitCount}`,
      );

      // ── Step 3: Generate ZK Oracle Signature ──────────────────────────────
      const { signature, messageHash } = this.generateOracleSignature(data);

      // Null out the OAuth token after successful signing
      await this.webProofRepo.update(
        { requestId: state },
        {
          status: ProofStatus.ATTESTED,
          oracleSignature: signature,
          messageHash,
          oauthAccessToken: null, // Clear token — no longer needed
        },
      );

      this.logger.log(
        `Oracle signature generated for requestId=${state} ` +
          `hash=${messageHash}`,
      );

      return `${frontendUrl}/verify/success?requestId=${state}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `OAuth callback failed for requestId=${state}: ${message}`,
      );

      await this.webProofRepo.update(
        { requestId: state },
        {
          status: ProofStatus.FAILED,
          errorMessage: message,
          oauthAccessToken: null, // Always clear token on failure
        },
      );

      return `${frontendUrl}/verify/failed?requestId=${state}`;
    }
  }

  // ── 4. Get Attestation ─────────────────────────────────────────────────────

  /**
   * Returns the EAS attestation UID and all extracted GitHub data.
   * Called by the frontend after redirect.
   */
  async getAttestation(requestId: string): Promise<AttestationResponseDto> {
    const record = await this.webProofRepo.findOne({ where: { requestId } });

    if (!record) {
      throw new NotFoundException(
        `No verification session found for requestId=${requestId}`,
      );
    }

    if (record.status === ProofStatus.PENDING) {
      throw new NotFoundException(
        `Verification not yet complete for requestId=${requestId}. ` +
          `The OAuth callback may still be processing — retry in 2 seconds.`,
      );
    }

    if (record.status === ProofStatus.FAILED) {
      throw new BadRequestException(
        `Verification failed: ${record.errorMessage ?? 'unknown error'}`,
      );
    }

    return {
      requestId: record.requestId,
      oracleSignature: record.oracleSignature,
      messageHash: record.messageHash,
      status: record.status,
      githubLogin: record.githubLogin,
      githubId: record.githubId,
      githubCreatedAt: record.githubCreatedAt,
      accountAgeSeconds: record.accountAgeSeconds,
      publicRepos: record.publicRepos,
      totalStars: record.totalStars,
      followers: record.followers,
      commitCount: record.commitCount,
      contributionEvents90d: record.contributionEvents90d,
      publicGists: record.publicGists,
      languages: record.languages,
      orgs: record.orgs,
      githubCreatedYear: record.githubCreatedYear,
      contributionTier: record.contributionTier,
    };
  }

  // ── 5. Confirm on-chain tx ─────────────────────────────────────────────────

  /**
   * Called by the frontend after any additional on-chain action confirms.
   * Marks the verification as fully complete.
   */
  async markVerified(requestId: string, txHash: string): Promise<void> {
    const record = await this.webProofRepo.findOne({ where: { requestId } });

    if (!record) {
      throw new NotFoundException(`No record found for requestId=${requestId}`);
    }

    await this.webProofRepo.update(
      { requestId },
      { status: ProofStatus.VERIFIED, txHash },
    );

    this.logger.log(
      `Verification complete for requestId=${requestId} ` +
        `wallet=${record.walletAddress} txHash=${txHash}`,
    );
  }

  // ── 6. Status check ────────────────────────────────────────────────────────

  /**
   * Lightweight status check the frontend can poll every ~2 seconds.
   * Returns current status + key GitHub fields + attestation info.
   */
  async getStatus(requestId: string): Promise<VerificationStatusDto> {
    const record = await this.webProofRepo.findOne({
      where: { requestId },
      select: [
        'status',
        'githubLogin',
        'githubId',
        'publicRepos',
        'totalStars',
        'followers',
        'commitCount',
        'githubCreatedYear',
        'contributionTier',
        'oracleSignature',
        'messageHash',
        'txHash',
        'errorMessage',
      ],
    });

    if (!record) {
      throw new NotFoundException(`No record found for requestId=${requestId}`);
    }

    return {
      status: record.status,
      githubLogin: record.githubLogin,
      githubId: record.githubId,
      publicRepos: record.publicRepos,
      totalStars: record.totalStars,
      followers: record.followers,
      commitCount: record.commitCount,
      oracleSignature: record.oracleSignature,
      messageHash: record.messageHash,
      txHash: record.txHash,
      errorMessage: record.errorMessage,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════════

  async verifyZkProof(
    proofHex: string,
    publicInputs: string[],
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const backend = await this.getVerifierBackend();
      const proof = this.hexToBytes(proofHex);
      const valid = await backend.verifyProof({
        proof,
        publicInputs,
      });

      return { valid };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Server-side ZK verification failed: ${message}`);
      return { valid: false, error: message };
    }
  }

  // ── Exchange OAuth code for access token ────────────────────────────────────

  private async exchangeCodeForToken(code: string): Promise<string> {
    const clientId = this.config.getOrThrow<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.config.getOrThrow<string>('GITHUB_CLIENT_SECRET');

    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    );

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
        `GitHub token exchange error: ${data.error_description ?? data.error ?? 'no access_token returned'}`,
      );
    }

    return data.access_token;
  }

  // ── Fetch all GitHub contributor data ───────────────────────────────────────

  async fetchGitHubData(accessToken: string): Promise<GitHubContributorData> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'GrantOS-API/1.0',
    };

    // ── GET /user ─────────────────────────────────────────────────────────────
    const user = await this.githubApiFetch<GitHubUser>(
      'https://api.github.com/user',
      headers,
    );

    const createdAt = new Date(user.created_at);
    const accountAgeSeconds = Math.floor(
      (Date.now() - createdAt.getTime()) / 1000,
    );

    // ── GET /user/repos — paginate to count stars and languages ────────────────
    const repos = await this.githubApiFetch<GitHubRepo[]>(
      'https://api.github.com/user/repos?per_page=100&type=all',
      headers,
    );

    const totalStars = repos.reduce(
      (sum, r) => sum + (r.stargazers_count ?? 0),
      0,
    );
    const languageSet = new Set<string>();
    for (const repo of repos) {
      if (repo.language) {
        languageSet.add(repo.language);
      }
    }

    // ── GET /search/commits — total commit count ──────────────────────────────
    let commitCount = 0;
    try {
      const commitSearch =
        await this.githubApiFetch<GitHubCommitSearchResponse>(
          `https://api.github.com/search/commits?q=author:${encodeURIComponent(user.login)}`,
          { ...headers, Accept: 'application/vnd.github.cloak-preview+json' },
        );
      commitCount = commitSearch.total_count ?? 0;
    } catch (err: unknown) {
      this.logger.warn(
        `Commit search failed for ${user.login}: ${err instanceof Error ? err.message : String(err)}. Defaulting to 0.`,
      );
    }

    // ── GET /users/{login}/events/public — contribution events last 90d ───────
    let contributionEvents90d = 0;
    try {
      const events = await this.githubApiFetch<GitHubEvent[]>(
        `https://api.github.com/users/${encodeURIComponent(user.login)}/events/public?per_page=100`,
        headers,
      );

      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      contributionEvents90d = events.filter(
        (e) => new Date(e.created_at).getTime() > ninetyDaysAgo,
      ).length;
    } catch (err: unknown) {
      this.logger.warn(
        `Events fetch failed for ${user.login}: ${err instanceof Error ? err.message : String(err)}. Defaulting to 0.`,
      );
    }

    // ── GET /user/orgs ────────────────────────────────────────────────────────
    let orgs: string[] = [];
    try {
      const orgsData = await this.githubApiFetch<GitHubOrg[]>(
        'https://api.github.com/user/orgs',
        headers,
      );
      orgs = orgsData.map((o) => o.login);
    } catch (err: unknown) {
      this.logger.warn(
        `Orgs fetch failed for ${user.login}: ${err instanceof Error ? err.message : String(err)}. Defaulting to [].`,
      );
    }

    return {
      login: user.login,
      githubId: user.id,
      createdAt,
      accountAgeSeconds,
      publicRepos: user.public_repos,
      totalStars,
      followers: user.followers,
      commitCount,
      contributionEvents90d,
      publicGists: user.public_gists,
      languages: Array.from(languageSet),
      orgs,
      githubCreatedYear: createdAt.getUTCFullYear(),
      contributionTier: this.calculateContributionTier(
        commitCount,
        totalStars,
        user.followers,
        contributionEvents90d,
      ),
    };
  }

  // ── Calculate Contribution Tier ─────────────────────────────────────────────

  private calculateContributionTier(
    commits: number,
    stars: number,
    followers: number,
    events: number,
  ): string {
    if (commits > 500 || stars > 100 || followers > 50 || events > 100)
      return 'Gold';
    if (commits > 100 || stars > 20 || followers > 10 || events > 30)
      return 'Silver';
    if (commits > 10 || stars > 5 || followers > 1 || events > 5)
      return 'Bronze';
    return 'Member';
  }

  // ── GitHub API fetch with rate limit handling ───────────────────────────────

  private async githubApiFetch<T>(
    url: string,
    headers: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(url, { headers });

    if (response.status === 403 || response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new Error(
        `GitHub API rate limit exceeded (${response.status}) for ${url}. ` +
          `Retry-After: ${retryAfter ?? 'unknown'}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `GitHub API error ${response.status} for ${url}: ${await response.text()}`,
      );
    }

    return response.json() as Promise<T>;
  }

  // ── Generate ZK Oracle Signature ──────────────────────────────────────────

  generateOracleSignature(data: GitHubContributorData): {
    signature: string;
    messageHash: string;
  } {
    const privateKey = this.config.getOrThrow<string>('ORACLE_PRIVATE_KEY');

    // ABI Encode the exact payload our Noir circuit expects:
    // github_id, github_created_year, commits, stars, events
    const abiCoder = new ethers.AbiCoder();
    const encodedData = abiCoder.encode(
      ['uint256', 'uint256', 'uint32', 'uint32', 'uint32'],
      [
        data.githubId,
        data.githubCreatedYear,
        data.commitCount,
        data.totalStars,
        data.contributionEvents90d,
      ],
    );

    // SHA256 hash of the payload (more standard for non-Ethereum ZK circuits)
    const messageHash = ethers.sha256(encodedData);

    // Sign the raw hash (No Ethereum Prefix) to make it Noir-compatible
    const signingKey = new ethers.SigningKey(privateKey);
    const sig = signingKey.sign(messageHash);

    // Noir's ecdsa_secp256k1 expects a normalized low-s signature.
    const r = ethers.zeroPadValue(sig.r, 32);
    const rawS = BigInt(sig.s);
    const normalizedS = rawS > SECP256K1_HALF_N ? SECP256K1_N - rawS : rawS;
    const s = ethers.zeroPadValue(ethers.toBeHex(normalizedS), 32);
    const signature = r + s.substring(2);

    return {
      signature,
      messageHash,
    };
  }

  private async getVerifierBackend(): Promise<UltraHonkBackend> {
    if (this.verifyBackend) {
      return this.verifyBackend;
    }

    const circuitPath =
      this.config.get<string>('ZK_CIRCUIT_PATH') ??
      resolve(process.cwd(), '../GrantOS-Frontend/public/circuit.json');
    const raw = await readFile(circuitPath, 'utf8');
    const circuit = JSON.parse(raw) as { bytecode: string };

    if (!circuit.bytecode) {
      throw new Error(`Circuit artifact at ${circuitPath} has no bytecode`);
    }

    const api = await Barretenberg.new();
    this.verifyBackend = new UltraHonkBackend(circuit.bytecode, api);
    this.logger.log(`Loaded ZK circuit artifact for verification: ${circuitPath}`);
    return this.verifyBackend;
  }

  private hexToBytes(value: string): Uint8Array {
    const clean = value.startsWith('0x') ? value.slice(2) : value;
    if (clean.length === 0 || clean.length % 2 !== 0) {
      throw new Error('Proof hex must contain an even number of characters');
    }

    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      const byte = Number.parseInt(clean.slice(i, i + 2), 16);
      if (Number.isNaN(byte)) {
        throw new Error('Proof hex contains non-hex characters');
      }
      out[i / 2] = byte;
    }
    return out;
  }
}
