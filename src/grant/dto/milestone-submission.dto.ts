// src/grant/dto/milestone-submission.dto.ts
import {
  IsBoolean,
  IsEthereumAddress,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Submit a milestone ──────────────────────────────────────────────────────

export class SubmitMilestoneDto {
  @ApiProperty({ example: 0, description: 'On-chain grant ID' })
  @IsInt()
  @Min(0)
  grantId: number;

  @ApiProperty({ example: '0xEscrow...', description: 'Escrow contract address' })
  @IsEthereumAddress()
  escrowAddress: string;

  @ApiProperty({ example: 0, description: 'Milestone index within the grant' })
  @IsInt()
  @Min(0)
  milestoneIndex: number;

  @ApiProperty({ example: '0xBuilder...', description: 'Builder wallet address' })
  @IsEthereumAddress()
  builderAddress: string;

  @ApiProperty({ example: 'Implemented the core escrow logic with ZK verification support.' })
  @IsString()
  @IsNotEmpty()
  builderSummary: string;

  @ApiPropertyOptional({ example: 'https://github.com/owner/repo/pull/42' })
  @IsString()
  @IsOptional()
  prUrl?: string;

  @ApiPropertyOptional({ example: 'owner/repo' })
  @IsString()
  @IsOptional()
  githubRepo?: string;

  @ApiPropertyOptional({ example: 42 })
  @IsInt()
  @IsOptional()
  prNumber?: number;

  @ApiProperty({ example: true, description: 'Whether this milestone requires ZK proof' })
  @IsBoolean()
  isZkRequired: boolean;

  @ApiPropertyOptional({ example: '0xProofHash...', description: 'keccak256 hash of the ZK proof' })
  @IsString()
  @IsOptional()
  proofHash?: string;

  @ApiProperty({ example: true, description: 'Whether the ZK proof was verified on-chain' })
  @IsBoolean()
  @IsOptional()
  zkVerified?: boolean;

  @ApiPropertyOptional({ example: '0xEasUid...', description: 'EAS attestation UID' })
  @IsString()
  @IsOptional()
  easAttestationUid?: string;

  @ApiPropertyOptional({ example: 'LIKELY_FULFILLED' })
  @IsString()
  @IsOptional()
  aiVerdict?: string;

  @ApiPropertyOptional({ example: 'The PR scope appears consistent with the milestone.' })
  @IsString()
  @IsOptional()
  aiExplanation?: string;

  @ApiPropertyOptional({ example: '0xTxHash...', description: 'Submission transaction hash' })
  @IsString()
  @IsOptional()
  submissionTxHash?: string;
}

// ── Record a committee vote ─────────────────────────────────────────────────

export class RecordVoteDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  grantId: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  milestoneIndex: number;

  @ApiProperty({ example: '0xVoter...' })
  @IsEthereumAddress()
  voterAddress: string;

  @ApiProperty({ example: true, description: 'true = approve, false = reject' })
  @IsBoolean()
  approved: boolean;

  @ApiProperty({ example: 2, description: 'Current approval count after this vote' })
  @IsInt()
  @Min(0)
  approvalCount: number;

  @ApiProperty({ example: 0, description: 'Current rejection count after this vote' })
  @IsInt()
  @Min(0)
  rejectionCount: number;

  @ApiPropertyOptional({ example: '0xTxHash...' })
  @IsString()
  @IsOptional()
  txHash?: string;

  @ApiPropertyOptional({
    example: 'approved',
    description: 'Final status if quorum reached: approved | rejected',
  })
  @IsString()
  @IsOptional()
  finalStatus?: 'approved' | 'rejected';
}

// ── Response DTOs ───────────────────────────────────────────────────────────

export class MilestoneSubmissionResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() grantId: number;
  @ApiProperty() milestoneIndex: number;
  @ApiProperty() builderAddress: string;
  @ApiProperty() builderSummary: string;
  @ApiPropertyOptional() prUrl: string | null;
  @ApiPropertyOptional() githubRepo: string | null;
  @ApiPropertyOptional() prNumber: number | null;
  @ApiProperty() isZkRequired: boolean;
  @ApiPropertyOptional() proofHash: string | null;
  @ApiProperty() zkVerified: boolean;
  @ApiPropertyOptional() easAttestationUid: string | null;
  @ApiPropertyOptional() aiVerdict: string | null;
  @ApiPropertyOptional() aiExplanation: string | null;
  @ApiPropertyOptional() submissionTxHash: string | null;
  @ApiProperty() status: string;
  @ApiProperty() approvalCount: number;
  @ApiProperty() rejectionCount: number;
  @ApiPropertyOptional() resolutionTxHash: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
