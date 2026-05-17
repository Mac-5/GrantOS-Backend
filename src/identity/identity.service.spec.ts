// src/identity/identity.service.spec.ts
// Unit tests for IdentityService (GitHub OAuth Oracle + ZK Binding version).
// All external dependencies (TypeORM repo, ConfigService, fetch, ethers) are mocked.

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { IdentityService } from './identity.service';
import { WebProof, ProofStatus } from './entities/web-proof.entity';

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetchResponse = (
  data: unknown,
  opts: { ok?: boolean; status?: number } = {},
) =>
  ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  }) as Response;

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

// ── Mock ethers ───────────────────────────────────────────────────────────────

jest.mock('ethers', () => {
  const actual = jest.requireActual<typeof import('ethers')>('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      AbiCoder: actual.ethers.AbiCoder,
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const REQ_ID = '123e4567-e89b-12d3-a456-426614174000';

const MOCK_GITHUB_USER = {
  login: 'alice',
  name: 'Alice Developer',
  id: 12345678,
  created_at: '2019-06-01T00:00:00Z',
  public_repos: 42,
  followers: 200,
  public_gists: 5,
  bio: 'Building cool stuff',
  company: 'Acme',
  location: 'Earth',
  email: 'alice@example.com',
};

const MOCK_REPOS = [
  { stargazers_count: 50, language: 'TypeScript', fork: false },
  { stargazers_count: 30, language: 'Rust', fork: false },
  { stargazers_count: 20, language: 'TypeScript', fork: false },
  { stargazers_count: 28, language: 'Solidity', fork: false },
];

const MOCK_EVENTS = [
  { type: 'PushEvent', created_at: new Date().toISOString() },
  { type: 'PullRequestEvent', created_at: new Date().toISOString() },
  {
    type: 'PushEvent',
    created_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
  }, // > 90 days ago
];

// Helper to set up fetch mock for the OAuth callback flow
function setupFetchForOAuthCallback() {
  mockFetch = jest.fn().mockImplementation((url) => {
    const urlString = String(url);
    if (urlString.includes('/oauth/access_token')) {
      return Promise.resolve(mockFetchResponse({ access_token: 'gho_test_token_123' }));
    }
    if (urlString.includes('/user/repos')) {
      if (urlString.includes('page=2')) {
        return Promise.resolve(mockFetchResponse([]));
      }
      return Promise.resolve(mockFetchResponse(MOCK_REPOS));
    }
    if (urlString.includes('/graphql')) {
      return Promise.resolve(mockFetchResponse({
        data: {
          viewer: {
            contributionsCollection: {
              totalCommitContributions: 1500,
            },
          },
        },
      }));
    }
    if (urlString.includes('/events')) {
      return Promise.resolve(mockFetchResponse(MOCK_EVENTS));
    }
    if (urlString.includes('/user')) {
      return Promise.resolve(mockFetchResponse(MOCK_GITHUB_USER));
    }
    return Promise.resolve(mockFetchResponse({}, { status: 404, ok: false }));
  });

  global.fetch = mockFetch;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('IdentityService', () => {
  let service: IdentityService;

  const mockRepo = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    upsert: jest
      .fn()
      .mockResolvedValue({ identifiers: [{ requestId: REQ_ID }] }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      const map: Record<string, string> = {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET: 'test-client-secret',
        GITHUB_CALLBACK_URL: 'https://api.example.com/api/v1/identity/callback',
        ORACLE_PRIVATE_KEY: '0x' + 'a'.repeat(64),
        FRONTEND_URL: 'http://localhost:3000',
      };
      return map[key] ?? '';
    }),
    get: jest.fn((key: string) => {
      return '';
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = originalFetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: getRepositoryToken(WebProof), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // ── initVerification ───────────────────────────────────────────────────────

  describe('initVerification', () => {
    it('creates a pending record for a new wallet', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await service.initVerification(REQ_ID, WALLET);
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: REQ_ID,
          status: ProofStatus.PENDING,
        }),
        expect.any(Object),
      );
    });

    it('throws ConflictException if wallet is already VERIFIED', async () => {
      mockRepo.findOne.mockResolvedValue({ status: ProofStatus.VERIFIED });
      await expect(service.initVerification(REQ_ID, WALLET)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── getOAuthUrl ────────────────────────────────────────────────────────────

  describe('getOAuthUrl', () => {
    it('returns GitHub OAuth URL with correct params', async () => {
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        walletAddress: WALLET,
        status: ProofStatus.PENDING,
      });

      const result = await service.getOAuthUrl(REQ_ID);

      expect(result.oauthUrl).toContain(
        'https://github.com/login/oauth/authorize',
      );
      expect(result.oauthUrl).toContain('client_id=test-client-id');
      expect(result.oauthUrl).toContain(`state=${REQ_ID}`);
      expect(result.oauthUrl).toContain('scope=read%3Auser');
      expect(result.requestId).toBe(REQ_ID);
    });

    it('throws NotFoundException if session does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.getOAuthUrl(REQ_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── handleOAuthCallback ────────────────────────────────────────────────────

  describe('handleOAuthCallback', () => {
    it('completes the full OAuth → GitHub data → EAS attestation flow', async () => {
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        walletAddress: WALLET,
        status: ProofStatus.PENDING,
      });
      mockRepo.findOneOrFail.mockResolvedValue({
        requestId: REQ_ID,
        walletAddress: WALLET,
        walletAddressHi: '3638845938',
        walletAddressLo: '140075495586578064988875286336449888325',
      });

      setupFetchForOAuthCallback();

      const redirectUrl = await service.handleOAuthCallback(
        'test-code',
        REQ_ID,
      );

      // Should redirect to success
      expect(redirectUrl).toContain('http://localhost:3000/verify/success');
      expect(redirectUrl).toContain(`requestId=${REQ_ID}`);

      // Should have called update multiple times
      expect(mockRepo.update).toHaveBeenCalledTimes(3);
      const updateCalls = mockRepo.update.mock.calls as unknown[][];

      // Check the DATA_FETCHED update includes GitHub data
      const dataFetchedPayload = updateCalls[1]?.[1] as Record<string, unknown>;
      expect(dataFetchedPayload).toMatchObject({
        status: ProofStatus.DATA_FETCHED,
        githubLogin: 'alice',
        githubId: 12345678,
        publicRepos: 42,
        totalStars: 128, // 50 + 30 + 20 + 28
        followers: 200,
        commitCount: 1500,
        publicGists: 5,
      });

      // Check languages extracted (unique)
      expect(dataFetchedPayload.languages).toEqual(
        expect.arrayContaining(['TypeScript', 'Rust', 'Solidity']),
      );

      // Check contribution events (only 2 are within 90d)
      expect(dataFetchedPayload.contributionEvents90d).toBe(2);

      // Check the ATTESTED update
      const attestedPayload = updateCalls[2]?.[1] as Record<string, unknown>;
      expect(attestedPayload).toMatchObject({
        status: ProofStatus.ATTESTED,
      });
      expect(attestedPayload.oracleSignature).toBeDefined();
      expect(attestedPayload.messageHash).toBeDefined();
    });

    it('throws BadRequestException for invalid state (CSRF)', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(
        service.handleOAuthCallback('code', 'invalid-state'),
      ).rejects.toThrow(BadRequestException);
    });

    it('redirects gracefully if session is not PENDING (handles duplicates)', async () => {
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        walletAddress: WALLET,
        status: ProofStatus.ATTESTED,
      });
      const url = await service.handleOAuthCallback('code', REQ_ID);
      expect(url).toBe(
        `http://localhost:3000/verify/success?requestId=${REQ_ID}`,
      );
    });

    it('marks FAILED and redirects to failure page on GitHub API error', async () => {
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        walletAddress: WALLET,
        status: ProofStatus.PENDING,
      });

      // Token exchange succeeds but profile fetch fails
      mockFetch = jest
        .fn()
        .mockResolvedValueOnce(mockFetchResponse({ access_token: 'gho_test' }))
        .mockResolvedValueOnce(
          mockFetchResponse(
            { message: 'rate limit exceeded' },
            { ok: false, status: 403 },
          ),
        );
      global.fetch = mockFetch;

      const redirectUrl = await service.handleOAuthCallback('code', REQ_ID);

      expect(redirectUrl).toContain('/verify/failed');

      // Should have marked FAILED
      const updateCalls = mockRepo.update.mock.calls as unknown[][];
      const failedCall = updateCalls.find(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown>)?.status === ProofStatus.FAILED,
      );
      expect(failedCall).toBeDefined();
      const failedPayload = failedCall?.[1] as
        | Record<string, unknown>
        | undefined;
      expect(failedPayload?.errorMessage).toEqual(
        expect.stringContaining('rate limit'),
      );
    });
  });

  // ── getAttestation ─────────────────────────────────────────────────────────

  describe('getAttestation', () => {
    it('returns attestation data when status is ATTESTED', async () => {
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        status: ProofStatus.ATTESTED,
        oracleSignature: '0x' + 's'.repeat(128),
        messageHash: '0x' + 'h'.repeat(64),
        githubLogin: 'alice',
        githubId: 12345678,
        githubCreatedAt: new Date('2019-06-01'),
        accountAgeSeconds: 157680000,
        publicRepos: 42,
        totalStars: 128,
        followers: 200,
        commitCount: 1500,
        contributionEvents90d: 85,
        publicGists: 5,
        languages: ['TypeScript', 'Rust'],
        walletAddressHi: '3638845938',
        walletAddressLo: '140075495586578064988875286336449888325',
      });

      const result = await service.getAttestation(REQ_ID);

      expect(result).toMatchObject({
        requestId: REQ_ID,
        oracleSignature: '0x' + 's'.repeat(128),
        githubLogin: 'alice',
        totalStars: 128,
      });
    });

    it('throws NotFoundException when still PENDING', async () => {
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        status: ProofStatus.PENDING,
      });
      await expect(service.getAttestation(REQ_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when FAILED', async () => {
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        status: ProofStatus.FAILED,
        errorMessage: 'rate limit exceeded',
      });
      await expect(service.getAttestation(REQ_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── markVerified ──────────────────────────────────────────────────────────

  describe('markVerified', () => {
    it('updates status to VERIFIED with txHash', async () => {
      const TX = '0x' + 'a'.repeat(64);
      mockRepo.findOne.mockResolvedValue({
        requestId: REQ_ID,
        walletAddress: WALLET,
      });
      await service.markVerified(REQ_ID, TX);
      expect(mockRepo.update).toHaveBeenCalledWith(
        { requestId: REQ_ID },
        { status: ProofStatus.VERIFIED, txHash: TX },
      );
    });

    it('throws NotFoundException if record does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(
        service.markVerified(REQ_ID, '0x' + 'a'.repeat(64)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getStatus ──────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns current status and key fields', async () => {
      mockRepo.findOne.mockResolvedValue({
        status: ProofStatus.ATTESTED,
        githubLogin: 'alice',
        githubId: 12345678,
        publicRepos: 42,
        totalStars: 128,
        followers: 200,
        commitCount: 1500,
        oracleSignature: '0x' + 's'.repeat(128),
        messageHash: '0x' + 'h'.repeat(64),
        txHash: null,
        errorMessage: null,
      });

      const result = await service.getStatus(REQ_ID);

      expect(result).toMatchObject({
        status: ProofStatus.ATTESTED,
        githubLogin: 'alice',
        oracleSignature: '0x' + 's'.repeat(128),
      });
    });

    it('throws NotFoundException if record does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.getStatus(REQ_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── fetchGitHubData ────────────────────────────────────────────────────────

  describe('fetchGitHubData', () => {
    it('aggregates data from all GitHub API endpoints', async () => {
      setupFetchForOAuthCallback();

      const data = await service.fetchGitHubData('test-token');

      expect(data.login).toBe('alice');
      expect(data.githubId).toBe(12345678);
      expect(data.publicRepos).toBe(42);
      expect(data.totalStars).toBe(128);
      expect(data.followers).toBe(200);
      expect(data.commitCount).toBe(1500);
      expect(data.contributionEvents90d).toBe(2); // only 2 within 90 days
      expect(data.publicGists).toBe(5);
      expect(data.languages).toHaveLength(3);
      expect(data.languages).toContain('TypeScript');
      expect(data.languages).toContain('Rust');
      expect(data.languages).toContain('Solidity');

      // Check account age is reasonable
      expect(data.accountAgeSeconds).toBeGreaterThan(0);
    });

    it('handles rate limit (403) by throwing descriptive error', async () => {
      mockFetch = jest
        .fn()
        .mockResolvedValueOnce(
          mockFetchResponse(
            { message: 'rate limit exceeded' },
            { ok: false, status: 403 },
          ),
        );
      global.fetch = mockFetch;

      await expect(service.fetchGitHubData('test-token')).rejects.toThrow(
        /rate limit exceeded|GitHub API rate limit/,
      );
    });

    it('handles rate limit (429) by throwing descriptive error', async () => {
      mockFetch = jest
        .fn()
        .mockResolvedValueOnce(
          mockFetchResponse(
            { message: 'too many requests' },
            { ok: false, status: 429 },
          ),
        );
      global.fetch = mockFetch;

      await expect(service.fetchGitHubData('test-token')).rejects.toThrow(
        /rate limit exceeded|GitHub API rate limit/,
      );
    });

    it('gracefully handles commit search failure by falling back to search API', async () => {
      mockFetch = jest.fn().mockImplementation((url) => {
        const urlString = String(url);
        if (urlString.includes('/oauth/access_token')) {
          return Promise.resolve(mockFetchResponse({ access_token: 'gho_test_token_123' }));
        }
        if (urlString.includes('/user/repos')) {
          if (urlString.includes('page=2')) {
            return Promise.resolve(mockFetchResponse([]));
          }
          return Promise.resolve(mockFetchResponse(MOCK_REPOS));
        }
        if (urlString.includes('/graphql')) {
          // GraphQL query fails
          return Promise.resolve(mockFetchResponse({ errors: [{ message: 'GraphQL fail' }] }, { status: 400, ok: false }));
        }
        if (urlString.includes('/search/commits')) {
          // Fallback search API succeeds
          return Promise.resolve(mockFetchResponse({ total_count: 750 }));
        }
        if (urlString.includes('/events')) {
          return Promise.resolve(mockFetchResponse(MOCK_EVENTS));
        }
        if (urlString.includes('/user')) {
          return Promise.resolve(mockFetchResponse(MOCK_GITHUB_USER));
        }
        return Promise.resolve(mockFetchResponse({}, { status: 404, ok: false }));
      });
      global.fetch = mockFetch;

      const data = await service.fetchGitHubData('test-token');

      // commitCount fell back to 750 successfully!
      expect(data.commitCount).toBe(750);
      expect(data.login).toBe('alice');
      expect(data.totalStars).toBe(128);
    });
  });
});
