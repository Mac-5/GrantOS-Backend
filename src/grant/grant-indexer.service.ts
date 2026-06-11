// src/grant/grant-indexer.service.ts
//
// Self-healing on-chain grant indexer.
//
// Background: grant indexing is normally FRONTEND-DRIVEN — the new-grant wizard
// POSTs to /grants after GrantFactory.GrantCreated confirms. If that POST never
// lands (tab closed, network blip, backend down, DB wiped on a redeploy), the
// grant exists on-chain but is invisible to every committee query — which is
// exactly the "No milestones pending review" / empty committee dashboard bug.
//
// This service closes that gap from the backend so the system self-heals:
//   1. On startup it RECONCILES — walks every grant on-chain and indexes any
//      the DB is missing (idempotent; already-indexed grants are skipped).
//   2. It then SUBSCRIBES to live GrantCreated events and indexes each new grant
//      the moment it's mined, independent of whether the frontend POST succeeds.
//
// Every field needed for a row lives on-chain (milestone title + description are
// stored in GrantEscrow.getGrant), so reconstruction is lossless and goes
// through the same GrantService.index() path the frontend uses.
//
// If ARBITRUM_RPC_URL or GRANT_FACTORY_ADDRESS is unset, the indexer disables
// itself and the app falls back to POST-only indexing — startup never fails.

import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { GrantService } from './grant.service';
import { IndexGrantDto } from './dto/grant.dto';
import {
  MilestoneSubmission,
  SubmissionStatus,
} from './entities/milestone-submission.entity';

const FACTORY_ABI = [
  'function grantCount() view returns (uint256)',
  'function grants(uint256) view returns (address)',
  'event GrantCreated(uint256 indexed grantId, address indexed escrow, address indexed grantor, address grantee, uint256 totalAmount)',
];

const ESCROW_ABI = [
  'function grantor() view returns (address)',
  'function getGrant() view returns (tuple(' +
    'address builder,' +
    'bool streaming,' +
    'address[] committee,' +
    'uint256 quorum,' +
    'uint256 createdAt,' +
    'tuple(string title,string description,uint256 amount,uint256 deadline,uint8 proofType,uint8 state)[] milestones' +
    '))',
  'function getSubmission(uint256) view returns (tuple(bytes32 proofHash,bytes32 easAttestationUid,string builderSummary,uint256 submittedAt,uint256 approvalCount,uint256 rejectionCount))',
  'event MilestoneSubmitted(uint256 indexed milestoneId, address indexed builder, bytes32 proofHash, bytes32 easAttestationUid, string builderSummary)',
];

// GrantEscrow.MilestoneState enum, in declaration order.
enum MilestoneState {
  Pending = 0,
  Submitted = 1,
  Approved = 2,
  Rejected = 3,
  Slashed = 4,
  Streaming = 5,
}

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

/** Map an on-chain milestone state to the DB submission status (or null if no review row applies). */
function stateToStatus(state: number): SubmissionStatus | null {
  switch (state) {
    case MilestoneState.Submitted:
      return SubmissionStatus.SUBMITTED;
    case MilestoneState.Approved:
    case MilestoneState.Streaming: // streaming = approved + actively paying out
      return SubmissionStatus.APPROVED;
    case MilestoneState.Rejected:
      return SubmissionStatus.REJECTED;
    default:
      return null; // Pending (never submitted) or Slashed (terminal, no review)
  }
}

const SENTINEL_TX_HASH = `0x${'0'.repeat(64)}`;

@Injectable()
export class GrantIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrantIndexerService.name);
  private provider?: ethers.JsonRpcProvider;
  private factory?: ethers.Contract;
  /** Escrows we've already attached a live MilestoneSubmitted listener to. */
  private readonly watchedEscrows = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly grantService: GrantService,
    @InjectRepository(MilestoneSubmission)
    private readonly submissionRepo: Repository<MilestoneSubmission>,
  ) {}

  async onModuleInit(): Promise<void> {
    const rpcUrl = this.config.get<string>('ARBITRUM_RPC_URL');
    const factoryAddress = this.config.get<string>('GRANT_FACTORY_ADDRESS');

    if (!rpcUrl || !factoryAddress) {
      this.logger.warn(
        'GrantIndexer disabled: ARBITRUM_RPC_URL and/or GRANT_FACTORY_ADDRESS not set. ' +
          'Grants will only be indexed via POST /grants.',
      );
      return;
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.factory = new ethers.Contract(factoryAddress, FACTORY_ABI, this.provider);
    this.logger.log(`GrantIndexer enabled (factory ${factoryAddress}).`);

    // Catch up on anything the frontend POST missed, then watch live. Failures
    // here must never crash app startup — degrade to POST-only indexing.
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.error(
        `Initial reconcile failed (continuing without backfill): ${(err as Error).message}`,
      );
    }
    this.subscribe();
  }

  onModuleDestroy(): void {
    this.factory?.removeAllListeners();
    // ethers v6 JsonRpcProvider exposes destroy() to release the polling timer.
    this.provider?.destroy();
  }

  /**
   * Reconcile the DB against chain: index every on-chain grant the DB is
   * missing. Idempotent — safe to run on every boot and to call from the
   * backfill script. Returns counts for logging/CLI output.
   */
  async reconcile(): Promise<{ indexed: number; skipped: number; total: number }> {
    if (!this.factory) throw new Error('GrantIndexer not configured');

    const total = Number(await this.factory.grantCount());

    // Best-effort grantId → txHash from GrantCreated logs (purely cosmetic; the
    // DTO only needs a non-empty string). Wide eth_getLogs ranges are rejected
    // by some public RPCs — fall back to a sentinel hash if so.
    const txHashByGrantId = await this.loadTxHashes();

    let indexed = 0;
    let skipped = 0;
    for (let grantId = 0; grantId < total; grantId++) {
      const created = await this.indexGrantFromChain(
        grantId,
        txHashByGrantId.get(grantId),
      );
      if (created) indexed++;
      else skipped++;
    }

    this.logger.log(
      `Reconcile complete: indexed ${indexed}, skipped ${skipped} (already present) of ${total} on-chain grant(s).`,
    );
    return { indexed, skipped, total };
  }

  /**
   * Reconstruct a single grant from chain state and index it.
   * Returns true if a new row was created, false if it was already indexed.
   */
  async indexGrantFromChain(grantId: number, txHash?: string): Promise<boolean> {
    if (!this.factory || !this.provider) throw new Error('GrantIndexer not configured');

    const escrowAddress: string = await this.factory.grants(grantId);
    const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, this.provider);

    const [view, grantor] = await Promise.all([escrow.getGrant(), escrow.grantor()]);

    const milestones = view.milestones.map((m: any) => ({
      title: m.title,
      description: m.description,
      amount: m.amount.toString(),
      deadline: Number(m.deadline),
      proofType: Number(m.proofType),
    }));

    const totalUsdc = view.milestones
      .reduce((acc: bigint, m: any) => acc + m.amount, 0n)
      .toString();

    const dto: IndexGrantDto = {
      onChainId: grantId,
      escrowAddress,
      grantorAddress: grantor,
      granteeAddress: view.builder,
      txHash: txHash ?? SENTINEL_TX_HASH,
      totalUsdc,
      isStreaming: view.streaming,
      quorum: Number(view.quorum),
      committee: view.committee,
      milestones,
    };

    let created = false;
    try {
      await this.grantService.index(dto);
      this.logger.log(
        `Indexed grant #${grantId} (escrow ${escrowAddress}) — ` +
          `${dto.committee.length} committee member(s), ${milestones.length} milestone(s).`,
      );
      created = true;
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
    }

    // Whether or not the grant row was new, reconcile its milestone submissions
    // from chain (a submission can land long after the grant is indexed) and
    // attach a live listener so future submissions on this escrow self-heal.
    await this.reconcileSubmissions(grantId, escrowAddress, view);
    this.watchEscrow(escrowAddress);

    return created;
  }

  /**
   * Mirror on-chain milestone submissions into the DB for one grant.
   *
   * This deliberately bypasses MilestoneSubmissionService.submit() — that path
   * re-runs server-side ZK verification and rejects anything without the
   * original proof bytes (which are ephemeral and gone by now). The on-chain
   * submitMilestone already enforced verification, so a Submitted/Approved/
   * Rejected state on chain IS the authoritative truth we record here.
   *
   * AI verdict / PR metadata are off-chain only and stay null (the committee UI
   * degrades to "No AI verdict available").
   */
  async reconcileSubmissions(
    grantId: number,
    escrowAddress: string,
    view: any,
  ): Promise<void> {
    if (!this.provider) return;
    const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, this.provider);

    for (let i = 0; i < view.milestones.length; i++) {
      const m = view.milestones[i];
      const status = stateToStatus(Number(m.state));
      if (!status) continue; // Pending / Slashed → nothing to review

      let sub: any;
      try {
        sub = await escrow.getSubmission(i);
      } catch (err) {
        this.logger.warn(
          `getSubmission(${i}) failed on grant #${grantId} (${escrowAddress}): ${(err as Error).message}`,
        );
        continue;
      }

      await this.upsertSubmission({
        grantId,
        escrowAddress,
        milestoneIndex: i,
        builderAddress: view.builder,
        isZkRequired: Number(m.proofType) === 0, // 0 = ZKGitHub, 1 = EASOnly
        proofHash: sub.proofHash !== ZERO_BYTES32 ? sub.proofHash : null,
        easAttestationUid:
          sub.easAttestationUid !== ZERO_BYTES32 ? sub.easAttestationUid : null,
        builderSummary: sub.builderSummary || '(submitted on-chain)',
        approvalCount: Number(sub.approvalCount),
        rejectionCount: Number(sub.rejectionCount),
        status,
        submissionTxHash: null,
      });
    }
  }

  /**
   * Insert or update a milestone_submissions row to match on-chain truth.
   * Keyed by (grantId, milestoneIndex) — keeps the DB in sync as the milestone
   * progresses Submitted → Approved/Rejected without creating duplicates.
   */
  private async upsertSubmission(row: {
    grantId: number;
    escrowAddress: string;
    milestoneIndex: number;
    builderAddress: string;
    isZkRequired: boolean;
    proofHash: string | null;
    easAttestationUid: string | null;
    builderSummary: string;
    approvalCount: number;
    rejectionCount: number;
    status: SubmissionStatus;
    submissionTxHash: string | null;
  }): Promise<void> {
    const existing = await this.submissionRepo.findOne({
      where: { grantId: row.grantId, milestoneIndex: row.milestoneIndex },
      order: { createdAt: 'DESC' },
    });

    if (existing) {
      // Only touch fields the chain is authoritative for; never clobber an
      // AI verdict or PR metadata the normal submit flow may have stored.
      const changed =
        existing.status !== row.status ||
        existing.approvalCount !== row.approvalCount ||
        existing.rejectionCount !== row.rejectionCount;
      if (!changed) return;
      existing.status = row.status;
      existing.approvalCount = row.approvalCount;
      existing.rejectionCount = row.rejectionCount;
      await this.submissionRepo.save(existing);
      this.logger.log(
        `Synced submission grant #${row.grantId} milestone ${row.milestoneIndex} → ` +
          `${row.status} (${row.approvalCount}✓/${row.rejectionCount}✗).`,
      );
      return;
    }

    await this.submissionRepo.save(
      this.submissionRepo.create({
        grantId: row.grantId,
        escrowAddress: row.escrowAddress.toLowerCase(),
        milestoneIndex: row.milestoneIndex,
        builderAddress: row.builderAddress.toLowerCase(),
        builderSummary: row.builderSummary,
        prUrl: null,
        githubRepo: null,
        prNumber: null,
        isZkRequired: row.isZkRequired,
        proofHash: row.proofHash,
        zkVerified: row.isZkRequired, // chain accepted the submit → proof was verified
        easAttestationUid: row.easAttestationUid,
        aiVerdict: null,
        aiExplanation: null,
        submissionTxHash: row.submissionTxHash,
        status: row.status,
        approvalCount: row.approvalCount,
        rejectionCount: row.rejectionCount,
      }),
    );
    this.logger.log(
      `Indexed submission grant #${row.grantId} milestone ${row.milestoneIndex} ` +
        `(${row.status}) — builder ${row.builderAddress}.`,
    );
  }

  /** Subscribe to live GrantCreated events so new grants self-index on mine. */
  private subscribe(): void {
    if (!this.factory) return;

    this.factory.on(
      'GrantCreated',
      (grantId: bigint, _escrow, _grantor, _grantee, _total, payload: ethers.ContractEventPayload) => {
        const id = Number(grantId);
        const txHash = payload?.log?.transactionHash;
        this.logger.log(`GrantCreated(#${id}) observed — indexing.`);
        this.indexGrantFromChain(id, txHash).catch((err) =>
          this.logger.error(`Live index of grant #${id} failed: ${(err as Error).message}`),
        );
      },
    );

    this.logger.log('GrantIndexer watching for GrantCreated events.');
  }

  /**
   * Attach a live MilestoneSubmitted listener to one escrow so submissions made
   * after startup self-heal into the DB. Idempotent per escrow.
   */
  private watchEscrow(escrowAddress: string): void {
    if (!this.provider) return;
    const key = escrowAddress.toLowerCase();
    if (this.watchedEscrows.has(key)) return;
    this.watchedEscrows.add(key);

    const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, this.provider);
    escrow.on(
      'MilestoneSubmitted',
      (
        milestoneId: bigint,
        builder: string,
        proofHash: string,
        easAttestationUid: string,
        builderSummary: string,
      ) => {
        const idx = Number(milestoneId);
        this.logger.log(
          `MilestoneSubmitted(milestone ${idx}) on ${escrowAddress} — recording.`,
        );
        // Re-read the grant view to map escrow → grantId and milestone proofType.
        this.indexSubmissionFromEvent(escrowAddress, idx, {
          builder,
          proofHash,
          easAttestationUid,
          builderSummary,
        }).catch((err) =>
          this.logger.error(
            `Live submission index failed (${escrowAddress} milestone ${idx}): ${(err as Error).message}`,
          ),
        );
      },
    );
  }

  /** Record a single submission observed via a live MilestoneSubmitted event. */
  private async indexSubmissionFromEvent(
    escrowAddress: string,
    milestoneIndex: number,
    ev: { builder: string; proofHash: string; easAttestationUid: string; builderSummary: string },
  ): Promise<void> {
    const grant = await this.grantService.findByEscrowAddress(escrowAddress);
    if (!grant) {
      this.logger.warn(
        `MilestoneSubmitted on un-indexed escrow ${escrowAddress}; skipping.`,
      );
      return;
    }
    const milestones: Array<{ proofType?: number }> = JSON.parse(
      grant.milestones ?? '[]',
    );
    const proofType = Number(milestones[milestoneIndex]?.proofType ?? 0);

    await this.upsertSubmission({
      grantId: grant.onChainId,
      escrowAddress,
      milestoneIndex,
      builderAddress: ev.builder,
      isZkRequired: proofType === 0,
      proofHash: ev.proofHash !== ZERO_BYTES32 ? ev.proofHash : null,
      easAttestationUid:
        ev.easAttestationUid !== ZERO_BYTES32 ? ev.easAttestationUid : null,
      builderSummary: ev.builderSummary || '(submitted on-chain)',
      approvalCount: 0,
      rejectionCount: 0,
      status: SubmissionStatus.SUBMITTED,
      submissionTxHash: null,
    });
  }

  /** Best-effort map of grantId → originating txHash from GrantCreated logs. */
  private async loadTxHashes(): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (!this.factory) return map;
    try {
      const logs = await this.factory.queryFilter(this.factory.filters.GrantCreated());
      for (const log of logs) {
        const ev = log as ethers.EventLog;
        map.set(Number(ev.args.grantId), ev.transactionHash);
      }
    } catch (err) {
      this.logger.warn(
        `Could not read GrantCreated logs for tx hashes (${(err as Error).message}). Using sentinel hashes.`,
      );
    }
    return map;
  }
}
