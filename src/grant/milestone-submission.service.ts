// src/grant/milestone-submission.service.ts
import {
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

@Injectable()
export class MilestoneSubmissionService {
  private readonly logger = new Logger(MilestoneSubmissionService.name);

  constructor(
    @InjectRepository(MilestoneSubmission)
    private readonly repo: Repository<MilestoneSubmission>,
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
      zkVerified: dto.zkVerified ?? false,
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
