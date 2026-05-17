import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('milestone_warnings')
export class MilestoneWarning {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'grant_id' })
  grantId: number;

  @Column({ name: 'milestone_index' })
  milestoneIndex: number;

  @Column({ name: 'builder_address', length: 42 })
  builderAddress: string;

  @Column({ name: 'committee_address', length: 42 })
  committeeAddress: string;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'attestation_uid', length: 66, unique: true })
  attestationUid: string;

  @Column({ name: 'tx_hash', length: 66 })
  txHash: string;

  @Column({ name: 'warning_timestamp', type: 'bigint' })
  warningTimestamp: string;

  @Column({ name: 'slash_unlocks_at', type: 'bigint' })
  slashUnlocksAt: string;

  @Column({ name: 'slashed', default: false })
  slashed: boolean;

  @Column({ name: 'slashed_at', type: 'bigint', nullable: true })
  slashedAt: string | null;

  @Column({ name: 'slash_tx_hash', type: 'varchar', length: 66, nullable: true })
  slashTxHash: string | null;

  @Column({ name: 'amount_returned_usdc', type: 'bigint', nullable: true })
  amountReturnedUsdc: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
