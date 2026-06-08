// src/grant/milestone-submission.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MilestoneSubmission,
  SubmissionStatus,
} from './entities/milestone-submission.entity';
import {
  SubmitMilestoneDto,
  RecordVoteDto,
} from './dto/milestone-submission.dto';
import { IdentityService } from '../identity/identity.service';
import { GrantService } from './grant.service';
import { GrantEventService } from './grant-event.service';

/** USDC is stored on-chain (and mirrored here) in 6-decimal base units. */
const USDC_DECIMALS = 6;

@Injectable()
export class MilestoneSubmissionService {
  private readonly logger = new Logger(MilestoneSubmissionService.name);

  constructor(
    @InjectRepository(MilestoneSubmission)
    private readonly repo: Repository<MilestoneSubmission>,
    private readonly identityService: IdentityService,
    private readonly grantService: GrantService,
    private readonly grantEventService: GrantEventService,
  ) {}

  /**
   * Resolve a grant's committee addresses and the title/amount of a given
   * milestone from the indexed grant record. Returns `null` if the grant
   * isn't indexed yet so callers can degrade gracefully (notifications are
   * best-effort and must never break the core submit/vote flow).
   */
  private async resolveGrantContext(
    grantId: number,
    milestoneIndex: number,
  ): Promise<{
    committee: string[];
    title: string;
    amountUsdc: string;
  } | null> {
    try {
      const grant = await this.grantService.findById(grantId);
      const committee: string[] = JSON.parse(grant.committee ?? '[]');
      const milestones: Array<{ title?: string; amount?: string }> = JSON.parse(
        grant.milestones ?? '[]',
      );
      const milestone = milestones[milestoneIndex] ?? {};
      return {
        committee,
        title: milestone.title || `Milestone ${milestoneIndex + 1}`,
        amountUsdc: this.formatUsdc(milestone.amount),
      };
    } catch (err) {
      this.logger.warn(
        `Could not resolve grant context for notifications: grant=${grantId} ` +
          `milestone=${milestoneIndex} reason=${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Format a 6-decimal USDC base-unit string into a human amount (e.g. "500"). */
  private formatUsdc(raw?: string): string {
    if (!raw) return '0';
    try {
      const value = Number(BigInt(raw)) / 10 ** USDC_DECIMALS;
      return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    } catch {
      return raw;
    }
  }

  // ── Submit a milestone ──────────────────────────────────────────────────

  async submit(dto: SubmitMilestoneDto): Promise<MilestoneSubmission> {
    // Check for duplicate active submission
    const existing = await this.repo.findOne({
      where: {
        grantId: dto.grantId,
        milestoneIndex: dto.milestoneIndex,
        status: SubmissionStatus.SUBMITTED,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Milestone ${dto.milestoneIndex} of grant ${dto.grantId} already has an active submission.`,
      );
    }

    // ── Server-authoritative ZK verification ────────────────────────────────
    // The client's `zkVerified` flag is NEVER trusted. For ZK-required
    // milestones we re-run Barretenberg verification here and derive the
    // authoritative result. An invalid (or missing) proof is rejected.
    let zkVerified = false;
    if (dto.isZkRequired) {
      if (!dto.proof || !dto.publicInputs || dto.publicInputs.length === 0) {
        throw new BadRequestException(
          'ZK milestones require `proof` and `publicInputs` for server-side verification.',
        );
      }

      const result = await this.identityService.verifyZkProof(
        dto.proof,
        dto.publicInputs,
      );
      zkVerified = result.valid;

      // Default: a milestone with an invalid proof is rejected outright.
      // Ops can set ZK_VERIFY_ENFORCE=false to degrade to "record-but-flag"
      // mode (e.g. if the circuit artifact is not deployed to this host),
      // in which case the unverified status is still surfaced to the committee.
      const enforce = (process.env.ZK_VERIFY_ENFORCE ?? 'true') !== 'false';

      if (!result.valid) {
        this.logger.warn(
          `ZK verification failed: grant=${dto.grantId} ` +
            `milestone=${dto.milestoneIndex} builder=${dto.builderAddress} ` +
            `reason=${result.error ?? 'invalid proof'} enforce=${enforce}`,
        );
        if (enforce) {
          throw new BadRequestException(
            `ZK proof verification failed: ${result.error ?? 'invalid proof'}`,
          );
        }
      }
    }

    const submission = this.repo.create({
      grantId: dto.grantId,
      escrowAddress: dto.escrowAddress.toLowerCase(),
      milestoneIndex: dto.milestoneIndex,
      builderAddress: dto.builderAddress.toLowerCase(),
      builderSummary: dto.builderSummary,
      prUrl: dto.prUrl ?? null,
      githubRepo: dto.githubRepo ?? null,
      prNumber: dto.prNumber ?? null,
      isZkRequired: dto.isZkRequired,
      proofHash: dto.proofHash ?? null,
      zkVerified, // server-derived, not client-supplied
      easAttestationUid: dto.easAttestationUid ?? null,
      aiVerdict: dto.aiVerdict ?? null,
      aiExplanation: dto.aiExplanation ?? null,
      submissionTxHash: dto.submissionTxHash ?? null,
      status: SubmissionStatus.SUBMITTED,
      approvalCount: 0,
      rejectionCount: 0,
    });

    const saved = await this.repo.save(submission);

    this.logger.log(
      `Milestone submitted: grant=${dto.grantId} milestone=${dto.milestoneIndex} ` +
        `builder=${dto.builderAddress} zk=${dto.isZkRequired} proof=${dto.proofHash ?? 'none'}`,
    );

    // Best-effort: notify every committee member that a milestone is waiting
    // for review. Failures here must never roll back the submission itself.
    try {
      const ctx = await this.resolveGrantContext(
        dto.grantId,
        dto.milestoneIndex,
      );
      if (ctx && ctx.committee.length > 0) {
        await this.grantEventService.notifyCommitteeMilestoneSubmitted(
          ctx.committee,
          dto.grantId,
          dto.milestoneIndex,
          ctx.title,
          dto.builderAddress,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to dispatch committee submission notification: grant=${dto.grantId} ` +
          `milestone=${dto.milestoneIndex} reason=${(err as Error).message}`,
      );
    }

    return saved;
  }

  // ── Record a committee vote ─────────────────────────────────────────────

  async recordVote(dto: RecordVoteDto): Promise<MilestoneSubmission> {
    const submission = await this.repo.findOne({
      where: {
        grantId: dto.grantId,
        milestoneIndex: dto.milestoneIndex,
        status: SubmissionStatus.SUBMITTED,
      },
    });

    if (!submission) {
      throw new NotFoundException(
        `No active submission for milestone ${dto.milestoneIndex} of grant ${dto.grantId}.`,
      );
    }

    submission.approvalCount = dto.approvalCount;
    submission.rejectionCount = dto.rejectionCount;

    if (dto.finalStatus === 'approved') {
      submission.status = SubmissionStatus.APPROVED;
      submission.resolutionTxHash = dto.txHash ?? null;
      this.logger.log(
        `Milestone approved: grant=${dto.grantId} milestone=${dto.milestoneIndex} ` +
          `approvals=${dto.approvalCount}`,
      );
    } else if (dto.finalStatus === 'rejected') {
      submission.status = SubmissionStatus.REJECTED;
      submission.resolutionTxHash = dto.txHash ?? null;
      this.logger.log(
        `Milestone rejected: grant=${dto.grantId} milestone=${dto.milestoneIndex} ` +
          `rejections=${dto.rejectionCount}`,
      );
    } else {
      this.logger.log(
        `Vote recorded: grant=${dto.grantId} milestone=${dto.milestoneIndex} ` +
          `voter=${dto.voterAddress} approved=${dto.approved} ` +
          `approvals=${dto.approvalCount} rejections=${dto.rejectionCount}`,
      );
    }

    const saved = await this.repo.save(submission);

    // Best-effort: on a final approve/reject, notify the builder. Failures
    // here must never roll back the recorded vote.
    if (dto.finalStatus === 'approved' || dto.finalStatus === 'rejected') {
      try {
        const ctx = await this.resolveGrantContext(
          dto.grantId,
          dto.milestoneIndex,
        );
        const title = ctx?.title ?? `Milestone ${dto.milestoneIndex + 1}`;
        if (dto.finalStatus === 'approved') {
          await this.grantEventService.notifyMilestoneApproved(
            submission.builderAddress,
            dto.grantId,
            dto.milestoneIndex,
            title,
            ctx?.amountUsdc ?? '0',
          );
        } else {
          await this.grantEventService.notifyMilestoneRejected(
            submission.builderAddress,
            dto.grantId,
            dto.milestoneIndex,
            title,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to dispatch builder vote notification: grant=${dto.grantId} ` +
            `milestone=${dto.milestoneIndex} reason=${(err as Error).message}`,
        );
      }
    }

    return saved;
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  async findByGrant(grantId: number): Promise<MilestoneSubmission[]> {
    return this.repo.find({
      where: { grantId },
      order: { milestoneIndex: 'ASC', createdAt: 'DESC' },
    });
  }

  async findByGrantAndMilestone(
    grantId: number,
    milestoneIndex: number,
  ): Promise<MilestoneSubmission[]> {
    return this.repo.find({
      where: { grantId, milestoneIndex },
      order: { createdAt: 'DESC' },
    });
  }

  async findLatestSubmission(
    grantId: number,
    milestoneIndex: number,
  ): Promise<MilestoneSubmission | null> {
    return this.repo.findOne({
      where: { grantId, milestoneIndex },
      order: { createdAt: 'DESC' },
    });
  }

  async findActiveByBuilder(
    builderAddress: string,
  ): Promise<MilestoneSubmission[]> {
    return this.repo.find({
      where: {
        builderAddress: builderAddress.toLowerCase(),
        status: SubmissionStatus.SUBMITTED,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findByCommitteeGrants(
    grantIds: number[],
  ): Promise<MilestoneSubmission[]> {
    if (grantIds.length === 0) return [];
    return this.repo
      .createQueryBuilder('s')
      .where('s.grant_id IN (:...grantIds)', { grantIds })
      .andWhere('s.status = :status', { status: SubmissionStatus.SUBMITTED })
      .orderBy('s.created_at', 'DESC')
      .getMany();
  }
}
