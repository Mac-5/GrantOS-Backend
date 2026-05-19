// src/grant/grant.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Grant } from './entities/grant.entity';
import { IndexGrantDto } from './dto/grant.dto';
import { DashboardStatsDto, GrantDetailStatsDto } from './dto/stats.dto';
import { MilestoneSubmission, SubmissionStatus } from './entities/milestone-submission.entity';
import { MilestoneWarning } from './entities/milestone-warning.entity';

@Injectable()
export class GrantService {
  constructor(
    @InjectRepository(Grant)
    private readonly repo: Repository<Grant>,
    @InjectRepository(MilestoneSubmission)
    private readonly submissionRepo: Repository<MilestoneSubmission>,
    @InjectRepository(MilestoneWarning)
    private readonly warningRepo: Repository<MilestoneWarning>,
  ) {}

  async index(dto: IndexGrantDto): Promise<Grant> {
    const existing = await this.repo.findOne({ where: { onChainId: dto.onChainId } });
    if (existing) throw new ConflictException(`Grant ${dto.onChainId} already indexed`);

    const grant = this.repo.create({
      onChainId: dto.onChainId,
      escrowAddress: dto.escrowAddress.toLowerCase(),
      grantorAddress: dto.grantorAddress.toLowerCase(),
      granteeAddress: dto.granteeAddress.toLowerCase(),
      txHash: dto.txHash,
      totalUsdc: dto.totalUsdc,
      isStreaming: dto.isStreaming,
      quorum: dto.quorum,
      committee: JSON.stringify(dto.committee.map((a) => a.toLowerCase())),
      milestones: JSON.stringify(dto.milestones),
    });

    return this.repo.save(grant);
  }

  async findById(id: number): Promise<Grant> {
    const grant = await this.repo.findOne({ where: { onChainId: id } });
    if (!grant) throw new NotFoundException(`Grant ${id} not found`);
    return grant;
  }

  async findByGrantee(address: string): Promise<Grant[]> {
    return this.repo.find({
      where: { granteeAddress: address.toLowerCase() },
      order: { createdAt: 'DESC' },
    });
  }

  async findByCommitteeAddress(address: string): Promise<Grant[]> {
    return this.repo
      .createQueryBuilder('grant')
      .where('grant.committee ILIKE :address', { address: `%${address.toLowerCase()}%` })
      .orderBy('grant.createdAt', 'DESC')
      .getMany();
  }

  async findAll(): Promise<Grant[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findAllEnriched(): Promise<any[]> {
    const grants = await this.repo.find({ order: { createdAt: 'DESC' } });
    
    if (grants.length === 0) return [];

    const grantIds = grants.map(g => g.onChainId);
    
    // Batch fetch all submissions and warnings in 2 queries instead of N queries
    const [allSubmissions, allWarnings] = await Promise.all([
      this.submissionRepo.find({ 
        where: grantIds.map(id => ({ grantId: id })),
      }),
      this.warningRepo.find({ 
        where: grantIds.map(id => ({ grantId: id })),
      }),
    ]);

    // Group by grantId for O(1) lookup
    const submissionsByGrant = new Map<number, typeof allSubmissions>();
    const warningsByGrant = new Map<number, typeof allWarnings>();
    
    allSubmissions.forEach(s => {
      if (!submissionsByGrant.has(s.grantId)) {
        submissionsByGrant.set(s.grantId, []);
      }
      submissionsByGrant.get(s.grantId)!.push(s);
    });
    
    allWarnings.forEach(w => {
      if (!warningsByGrant.has(w.grantId)) {
        warningsByGrant.set(w.grantId, []);
      }
      warningsByGrant.get(w.grantId)!.push(w);
    });

    // Map grants with pre-fetched data
    return grants.map(grant => {
      const submissions = submissionsByGrant.get(grant.onChainId) || [];
      const warnings = warningsByGrant.get(grant.onChainId) || [];
      
      const completedMilestones = submissions.filter(s => s.status === SubmissionStatus.APPROVED).length;
      const submittedMilestones = submissions.filter(s => s.status === SubmissionStatus.SUBMITTED).length;
      const zkProofsVerified = submissions.filter(s => s.zkVerified).length;
      const hasWarning = warnings.some(w => !w.slashed);
      const hasSlashed = warnings.some(w => w.slashed);
      
      const milestones = JSON.parse(grant.milestones);
      const pendingMilestones = milestones.length - submissions.length;

      return {
        onChainId: grant.onChainId,
        escrowAddress: grant.escrowAddress,
        grantorAddress: grant.grantorAddress,
        granteeAddress: grant.granteeAddress,
        totalUsdc: grant.totalUsdc,
        isStreaming: grant.isStreaming,
        quorum: grant.quorum,
        committee: JSON.parse(grant.committee),
        milestones,
        completedMilestones,
        submittedMilestones,
        pendingMilestones,
        zkProofsVerified,
        hasWarning,
        hasSlashed,
        createdAt: grant.createdAt,
      };
    });
  }

  async deleteById(id: number): Promise<void> {
    const grant = await this.repo.findOne({ where: { onChainId: id } });
    if (!grant) throw new NotFoundException(`Grant ${id} not found`);
    await this.repo.remove(grant);
  }

  async deleteAll(): Promise<{ deleted: number }> {
    const count = await this.repo.count();
    await this.repo.clear();
    return { deleted: count };
  }

  async getDashboardStats(): Promise<DashboardStatsDto> {
    const grants = await this.repo.find();
    
    const totalUsdcLocked = grants.reduce((sum, g) => {
      return sum + Number(BigInt(g.totalUsdc) / 1000000n);
    }, 0);

    const activeGrants = grants.length;

    // Milestones due this week
    const oneWeekFromNow = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    let milestonesDueThisWeek = 0;
    
    for (const grant of grants) {
      const milestones = JSON.parse(grant.milestones);
      for (const m of milestones) {
        if (m.deadline > now && m.deadline <= oneWeekFromNow) {
          milestonesDueThisWeek++;
        }
      }
    }

    // Total released this month (approved submissions)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const approvedThisMonth = await this.submissionRepo
      .createQueryBuilder('sub')
      .where('sub.status = :status', { status: SubmissionStatus.APPROVED })
      .andWhere('sub.updatedAt >= :start', { start: startOfMonth })
      .getMany();

    let totalReleasedThisMonth = 0;
    for (const sub of approvedThisMonth) {
      const grant = grants.find(g => g.onChainId === sub.grantId);
      if (grant) {
        const milestones = JSON.parse(grant.milestones);
        const milestone = milestones[sub.milestoneIndex];
        if (milestone) {
          totalReleasedThisMonth += Number(BigInt(milestone.amount) / 1000000n);
        }
      }
    }

    // Slash counter
    const slashedWarnings = await this.warningRepo.find({ where: { slashed: true } });
    const liveSlashCounterUsdc = slashedWarnings.reduce((sum, w) => {
      return sum + (w.amountReturnedUsdc ? Number(BigInt(w.amountReturnedUsdc) / 1000000n) : 0);
    }, 0);

    // ZK proofs verified
    const totalZkProofsVerified = await this.submissionRepo.count({ where: { zkVerified: true } });

    return {
      totalUsdcLocked,
      activeGrants,
      milestonesDueThisWeek,
      totalReleasedThisMonth,
      liveSlashCounterUsdc,
      totalZkProofsVerified,
    };
  }

  async getGrantDetailStats(grantId: number): Promise<GrantDetailStatsDto> {
    const grant = await this.findById(grantId);
    const milestones = JSON.parse(grant.milestones);
    const totalMilestones = milestones.length;

    const submissions = await this.submissionRepo.find({ where: { grantId } });

    const completedMilestones = submissions.filter(s => s.status === SubmissionStatus.APPROVED).length;
    const submittedMilestones = submissions.filter(s => s.status === SubmissionStatus.SUBMITTED).length;
    const rejectedMilestones = submissions.filter(s => s.status === SubmissionStatus.REJECTED).length;
    const pendingMilestones = totalMilestones - submissions.length;

    const zkProofsVerified = submissions.filter(s => s.zkVerified).length;

    const warnings = await this.warningRepo.find({ where: { grantId } });
    const warningsIssued = warnings.length;
    const slashesExecuted = warnings.filter(w => w.slashed).length;

    return {
      totalMilestones,
      completedMilestones,
      submittedMilestones,
      pendingMilestones,
      rejectedMilestones,
      slashedMilestones: slashesExecuted,
      isStreaming: grant.isStreaming,
      zkProofsVerified,
      warningsIssued,
      slashesExecuted,
    };
  }

  async getGrantDetailFull(grantId: number): Promise<any> {
    const grant = await this.findById(grantId);
    const submissions = await this.submissionRepo.find({ 
      where: { grantId },
      order: { milestoneIndex: 'ASC' }
    });
    const warnings = await this.warningRepo.find({ 
      where: { grantId },
      order: { createdAt: 'DESC' }
    });

    const milestones = JSON.parse(grant.milestones);
    
    // Enrich milestones with submission data
    const enrichedMilestones = milestones.map((m: any, idx: number) => {
      const submission = submissions.find(s => s.milestoneIndex === idx);
      const milestoneWarnings = warnings.filter(w => w.milestoneIndex === idx);
      
      return {
        ...m,
        index: idx,
        submission: submission ? {
          id: submission.id,
          builderSummary: submission.builderSummary,
          prUrl: submission.prUrl,
          zkVerified: submission.zkVerified,
          proofHash: submission.proofHash,
          easAttestationUid: submission.easAttestationUid,
          aiVerdict: submission.aiVerdict,
          aiExplanation: submission.aiExplanation,
          status: submission.status,
          approvalCount: submission.approvalCount,
          rejectionCount: submission.rejectionCount,
          submissionTxHash: submission.submissionTxHash,
          createdAt: submission.createdAt,
        } : null,
        warnings: milestoneWarnings.map(w => ({
          id: w.id,
          committeeAddress: w.committeeAddress,
          message: w.message,
          attestationUid: w.attestationUid,
          txHash: w.txHash,
          warningTimestamp: w.warningTimestamp,
          slashUnlocksAt: w.slashUnlocksAt,
          slashed: w.slashed,
          slashedAt: w.slashedAt,
          slashTxHash: w.slashTxHash,
          amountReturnedUsdc: w.amountReturnedUsdc,
          createdAt: w.createdAt,
        })),
      };
    });

    return {
      grant: {
        onChainId: grant.onChainId,
        escrowAddress: grant.escrowAddress,
        grantorAddress: grant.grantorAddress,
        granteeAddress: grant.granteeAddress,
        totalUsdc: grant.totalUsdc,
        isStreaming: grant.isStreaming,
        quorum: grant.quorum,
        committee: JSON.parse(grant.committee),
        createdAt: grant.createdAt,
        txHash: grant.txHash,
      },
      milestones: enrichedMilestones,
      warnings,
    };
  }

  async getBuilderStats(address: string): Promise<any> {
    const grants = await this.repo.find({
      where: { granteeAddress: address.toLowerCase() },
    });

    if (grants.length === 0) {
      return {
        totalGrants: 0,
        totalUsdcEarned: 0,
        deliveryRate: 0,
        zkProofsSubmitted: 0,
        warningsReceived: 0,
        slashesReceived: 0,
        grants: [],
      };
    }

    const grantIds = grants.map(g => g.onChainId);
    
    // Batch fetch submissions and warnings
    const [submissions, warnings] = await Promise.all([
      this.submissionRepo.find({
        where: grantIds.map(id => ({ grantId: id, builderAddress: address.toLowerCase() })),
      }),
      this.warningRepo.find({
        where: grantIds.map(id => ({ grantId: id, builderAddress: address.toLowerCase() })),
      }),
    ]);

    const approvedSubmissions = submissions.filter(s => s.status === SubmissionStatus.APPROVED);
    const totalMilestones = grants.reduce((sum, g) => sum + JSON.parse(g.milestones).length, 0);
    
    const totalUsdcEarned = approvedSubmissions.reduce((sum, sub) => {
      const grant = grants.find(g => g.onChainId === sub.grantId);
      if (grant) {
        const milestones = JSON.parse(grant.milestones);
        const milestone = milestones[sub.milestoneIndex];
        if (milestone) {
          return sum + Number(BigInt(milestone.amount) / 1000000n);
        }
      }
      return sum;
    }, 0);

    const deliveryRate = totalMilestones > 0 
      ? Math.round((approvedSubmissions.length / totalMilestones) * 100)
      : 0;

    const zkProofsSubmitted = submissions.filter(s => s.zkVerified).length;
    const warningsReceived = warnings.length;
    const slashesReceived = warnings.filter(w => w.slashed).length;

    const enrichedGrants = grants.map(grant => {
      const milestones = JSON.parse(grant.milestones);
      const grantSubmissions = submissions.filter(s => s.grantId === grant.onChainId);
      const grantWarnings = warnings.filter(w => w.grantId === grant.onChainId);

      return {
        onChainId: grant.onChainId,
        escrowAddress: grant.escrowAddress,
        totalUsdc: grant.totalUsdc,
        isStreaming: grant.isStreaming,
        milestoneTotal: milestones.length,
        milestoneCompleted: grantSubmissions.filter(s => s.status === SubmissionStatus.APPROVED).length,
        hasWarning: grantWarnings.some(w => !w.slashed),
        hasSlashed: grantWarnings.some(w => w.slashed),
        createdAt: grant.createdAt,
      };
    });

    return {
      totalGrants: grants.length,
      totalUsdcEarned,
      deliveryRate,
      zkProofsSubmitted,
      warningsReceived,
      slashesReceived,
      grants: enrichedGrants,
      warnings: warnings.map(w => ({
        id: w.id,
        grantId: w.grantId,
        milestoneIndex: w.milestoneIndex,
        message: w.message,
        attestationUid: w.attestationUid,
        txHash: w.txHash,
        warningTimestamp: w.warningTimestamp,
        slashed: w.slashed,
        slashedAt: w.slashedAt,
        slashTxHash: w.slashTxHash,
        amountReturnedUsdc: w.amountReturnedUsdc,
        createdAt: w.createdAt,
      })),
    };
  }

  async getBuilderReputation(address: string): Promise<any> {
    const grants = await this.repo.find({
      where: { granteeAddress: address.toLowerCase() },
    });

    const history: Array<{
      grantId: number;
      milestoneIndex: number;
      milestoneTitle: string;
      outcome: string;
      points: number;
      zkProofSubmitted: boolean;
      submittedAt: string | null;
      deadline: string;
      easAttestationUid: string | null;
      txHash: string | null;
    }> = [];

    let approvedOnTime = 0;
    let approvedLate = 0;
    let zkProofsSubmitted = 0;
    let rejected = 0;
    let warningsReceived = 0;
    let slashed = 0;

    if (grants.length === 0) {
      return {
        score: 50,
        letterGrade: 'C',
        deliveryRate: 0,
        zkVerified: false,
        breakdown: {
          approvedOnTime: 0,
          approvedLate: 0,
          zkProofsSubmitted: 0,
          rejected: 0,
          warningsReceived: 0,
          slashed: 0,
          totalPoints: 0,
        },
        history: [],
      };
    }

    const grantIds = grants.map(g => g.onChainId);
    
    // Batch fetch all submissions and warnings
    const [allSubmissions, allWarnings] = await Promise.all([
      this.submissionRepo.find({
        where: grantIds.map(id => ({ grantId: id, builderAddress: address.toLowerCase() })),
      }),
      this.warningRepo.find({
        where: grantIds.map(id => ({ grantId: id, builderAddress: address.toLowerCase() })),
      }),
    ]);

    // Group by grantId for efficient lookup
    const submissionsByGrant = new Map<number, typeof allSubmissions>();
    const warningsByGrant = new Map<number, typeof allWarnings>();
    
    allSubmissions.forEach(s => {
      if (!submissionsByGrant.has(s.grantId)) {
        submissionsByGrant.set(s.grantId, []);
      }
      submissionsByGrant.get(s.grantId)!.push(s);
    });
    
    allWarnings.forEach(w => {
      if (!warningsByGrant.has(w.grantId)) {
        warningsByGrant.set(w.grantId, []);
      }
      warningsByGrant.get(w.grantId)!.push(w);
    });

    for (const grant of grants) {
      const milestones = JSON.parse(grant.milestones);
      const submissions = submissionsByGrant.get(grant.onChainId) || [];
      const warnings = warningsByGrant.get(grant.onChainId) || [];

      for (let i = 0; i < milestones.length; i++) {
        const milestone = milestones[i];
        const submission = submissions.find(s => s.milestoneIndex === i);
        const milestoneWarnings = warnings.filter(w => w.milestoneIndex === i);

        let outcome = 'pending';
        let points = 0;

        // Check for slash first (highest priority)
        const slashWarning = milestoneWarnings.find(w => w.slashed);
        if (slashWarning) {
          outcome = 'slashed';
          points = -15;
          slashed++;
        } else if (milestoneWarnings.length > 0) {
          // Has warning but not slashed
          outcome = 'warned';
          points = -5;
          warningsReceived++;
        } else if (submission) {
          if (submission.status === SubmissionStatus.APPROVED) {
            const submittedAt = new Date(submission.createdAt).getTime() / 1000;
            const deadline = parseInt(milestone.deadline, 10);
            
            if (submittedAt <= deadline) {
              outcome = 'approved_on_time';
              points = 10;
              approvedOnTime++;
            } else {
              outcome = 'approved_late';
              points = 4;
              approvedLate++;
            }

            // Bonus for ZK proof
            if (submission.zkVerified) {
              points += 2;
              zkProofsSubmitted++;
            }
          } else if (submission.status === SubmissionStatus.REJECTED) {
            outcome = 'rejected';
            points = -3;
            rejected++;
          }
        }

        history.push({
          grantId: grant.onChainId,
          milestoneIndex: i,
          milestoneTitle: milestone.title,
          outcome,
          points,
          zkProofSubmitted: submission?.zkVerified || false,
          submittedAt: submission ? submission.createdAt.toISOString() : null,
          deadline: milestone.deadline,
          easAttestationUid: submission?.easAttestationUid || null,
          txHash: submission?.submissionTxHash || null,
        });
      }
    }

    // Calculate total points
    const totalPoints = 
      approvedOnTime * 10 +
      approvedLate * 4 +
      zkProofsSubmitted * 2 +
      rejected * -3 +
      warningsReceived * -5 +
      slashed * -15;

    // Calculate score (0-100 scale)
    // Base score of 50, then add/subtract based on performance
    const maxPossiblePositive = history.length * 12; // 10 + 2 for ZK
    const score = Math.max(0, Math.min(100, 50 + (totalPoints / Math.max(1, maxPossiblePositive)) * 50));

    // Letter grade
    const letterGrade = 
      score >= 90 ? 'A' :
      score >= 80 ? 'B' :
      score >= 70 ? 'C' :
      score >= 60 ? 'D' : 'F';

    // Delivery rate
    const completedMilestones = approvedOnTime + approvedLate;
    const totalMilestones = history.length;
    const deliveryRate = totalMilestones > 0 
      ? Math.round((completedMilestones / totalMilestones) * 100)
      : 0;

    // Check ZK verified status from identity registry (would need to query contract)
    // For now, we'll check if they have any ZK proofs submitted
    const zkVerified = zkProofsSubmitted > 0;

    return {
      score: Math.round(score),
      letterGrade,
      deliveryRate,
      zkVerified,
      breakdown: {
        approvedOnTime,
        approvedLate,
        zkProofsSubmitted,
        rejected,
        warningsReceived,
        slashed,
        totalPoints,
      },
      history: history.sort((a, b) => {
        // Sort by grant ID desc, then milestone index
        if (a.grantId !== b.grantId) return b.grantId - a.grantId;
        return a.milestoneIndex - b.milestoneIndex;
      }),
    };
  }
}
