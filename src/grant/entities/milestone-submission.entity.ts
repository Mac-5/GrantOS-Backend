// src/grant/entities/milestone-submission.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SubmissionStatus {
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('milestone_submissions')
export class MilestoneSubmission {
  @PrimaryGeneratedColumn()
  id: number;

  /// On-chain grant ID from GrantFactory
  @Column({ name: 'grant_id' })
  grantId: number;

  /// Escrow contract address for this grant
  @Column({ name: 'escrow_address', length: 42 })
  escrowAddress: string;

  /// Milestone index within the grant
  @Column({ name: 'milestone_index' })
  milestoneIndex: number;

  /// Builder wallet address who submitted
  @Column({ name: 'builder_address', length: 42 })
  builderAddress: string;

  /// Builder's written summary of what the PR delivers
  @Column({ name: 'builder_summary', type: 'text' })
  builderSummary: string;

  /// GitHub PR URL provided as evidence
  @Column({ name: 'pr_url', type: 'text', nullable: true })
  prUrl: string | null;

  /// GitHub repository (owner/repo) format
  @Column({ name: 'github_repo', type: 'text', nullable: true })
  githubRepo: string | null;

  /// PR number within the repository
  @Column({ name: 'pr_number', type: 'int', nullable: true })
  prNumber: number | null;

  /// Whether the milestone required ZK proof
  @Column({ name: 'is_zk_required', default: false })
  isZkRequired: boolean;

  /// keccak256 hash of the ZK proof (if ZK required)
  @Column({ name: 'proof_hash', type: 'varchar', length: 66, nullable: true })
  proofHash: string | null;

  /// Whether ZK proof was verified on-chain
  @Column({ name: 'zk_verified', default: false })
  zkVerified: boolean;

  /// EAS attestation UID
  @Column({ name: 'eas_attestation_uid', type: 'varchar', length: 66, nullable: true })
  easAttestationUid: string | null;

  /// AI Verifier verdict: LIKELY_FULFILLED | UNCERTAIN | LIKELY_INSUFFICIENT
  @Column({ name: 'ai_verdict', type: 'varchar', length: 32, nullable: true })
  aiVerdict: string | null;

  /// AI Verifier explanation
  @Column({ name: 'ai_explanation', type: 'text', nullable: true })
  aiExplanation: string | null;

  /// On-chain transaction hash for the submission
  @Column({ name: 'submission_tx_hash', type: 'varchar', length: 66, nullable: true })
  submissionTxHash: string | null;

  /// Current status of this submission
  @Column({
    name: 'status',
    type: 'varchar',
    length: 16,
    default: SubmissionStatus.SUBMITTED,
  })
  status: SubmissionStatus;

  /// Number of committee approvals
  @Column({ name: 'approval_count', default: 0 })
  approvalCount: number;

  /// Number of committee rejections
  @Column({ name: 'rejection_count', default: 0 })
  rejectionCount: number;

  /// Approval/rejection tx hash (when quorum reached)
  @Column({ name: 'resolution_tx_hash', type: 'varchar', length: 66, nullable: true })
  resolutionTxHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
