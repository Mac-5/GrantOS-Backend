import { ApiProperty } from '@nestjs/swagger';

export class EnrichedGrantDto {
  @ApiProperty()
  onChainId: number;

  @ApiProperty()
  escrowAddress: string;

  @ApiProperty()
  grantorAddress: string;

  @ApiProperty()
  granteeAddress: string;

  @ApiProperty()
  totalUsdc: string;

  @ApiProperty()
  isStreaming: boolean;

  @ApiProperty()
  quorum: number;

  @ApiProperty({ type: [String] })
  committee: string[];

  @ApiProperty()
  milestones: any[];

  @ApiProperty()
  completedMilestones: number;

  @ApiProperty()
  submittedMilestones: number;

  @ApiProperty()
  pendingMilestones: number;

  @ApiProperty()
  zkProofsVerified: number;

  @ApiProperty()
  hasWarning: boolean;

  @ApiProperty()
  hasSlashed: boolean;

  @ApiProperty()
  createdAt: Date;
}
