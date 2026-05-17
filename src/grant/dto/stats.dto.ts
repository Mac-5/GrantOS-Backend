import { ApiProperty } from '@nestjs/swagger';

export class DashboardStatsDto {
  @ApiProperty({ example: 1250000, description: 'Total USDC locked in all active grants (in USDC, 6 decimals)' })
  totalUsdcLocked: number;

  @ApiProperty({ example: 42, description: 'Number of active grants' })
  activeGrants: number;

  @ApiProperty({ example: 7, description: 'Number of milestones due this week' })
  milestonesDueThisWeek: number;

  @ApiProperty({ example: 85000, description: 'Total USDC released this month' })
  totalReleasedThisMonth: number;

  @ApiProperty({ example: 12500.50, description: 'All-time USDC recovered from slashes' })
  liveSlashCounterUsdc: number;

  @ApiProperty({ example: 156, description: 'Total ZK proofs verified on-chain' })
  totalZkProofsVerified: number;
}

export class GrantDetailStatsDto {
  @ApiProperty({ example: 5, description: 'Total milestones' })
  totalMilestones: number;

  @ApiProperty({ example: 2, description: 'Completed milestones' })
  completedMilestones: number;

  @ApiProperty({ example: 1, description: 'Submitted milestones awaiting review' })
  submittedMilestones: number;

  @ApiProperty({ example: 2, description: 'Pending milestones' })
  pendingMilestones: number;

  @ApiProperty({ example: 0, description: 'Rejected milestones' })
  rejectedMilestones: number;

  @ApiProperty({ example: 0, description: 'Slashed milestones' })
  slashedMilestones: number;

  @ApiProperty({ example: true, description: 'Whether this grant has streaming enabled' })
  isStreaming: boolean;

  @ApiProperty({ example: 3, description: 'Number of ZK proofs verified for this grant' })
  zkProofsVerified: number;

  @ApiProperty({ example: 1, description: 'Number of warnings issued' })
  warningsIssued: number;

  @ApiProperty({ example: 0, description: 'Number of slashes executed' })
  slashesExecuted: number;
}
