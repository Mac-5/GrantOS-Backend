import { ApiProperty } from '@nestjs/swagger';

export class ReputationScoreDto {
  @ApiProperty({ example: 87, description: 'Reputation score 0-100' })
  score: number;

  @ApiProperty({ example: 'A', description: 'Letter grade A-F' })
  letterGrade: string;

  @ApiProperty({ example: 85, description: 'Delivery rate percentage' })
  deliveryRate: number;

  @ApiProperty({ example: true, description: 'Whether builder has ZK verified identity' })
  zkVerified: boolean;

  @ApiProperty({ description: 'Score breakdown' })
  breakdown: {
    approvedOnTime: number;
    approvedLate: number;
    zkProofsSubmitted: number;
    rejected: number;
    warningsReceived: number;
    slashed: number;
    totalPoints: number;
  };

  @ApiProperty({ description: 'Full delivery history' })
  history: Array<{
    grantId: number;
    milestoneIndex: number;
    milestoneTitle: string;
    outcome: 'approved_on_time' | 'approved_late' | 'rejected' | 'warned' | 'slashed' | 'pending';
    points: number;
    zkProofSubmitted: boolean;
    submittedAt: string | null;
    deadline: string;
    easAttestationUid: string | null;
    txHash: string | null;
  }>;
}
