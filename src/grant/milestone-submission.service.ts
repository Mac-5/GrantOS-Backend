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

@Injectable()
export class MilestoneSubmissionService {
  private readonly logger = new Logger(MilestoneSubmissionService.name);

  constructor(
    @InjectRepository(MilestoneSubmission)
    private readonly repo: Repository<MilestoneSubmission>,
    private readonly identityService: IdentityService,
  ) {}

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

    return this.repo.save(submission);
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
