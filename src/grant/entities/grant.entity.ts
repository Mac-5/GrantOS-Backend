// src/grant/entities/grant.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('grants')
export class Grant {
  @PrimaryGeneratedColumn()
  id: number;

  // On-chain grantId emitted by GrantFactory.GrantCreated
  @Column({ name: 'on_chain_id', unique: true })
  onChainId: number;

  @Column({ name: 'escrow_address', length: 42 })
  escrowAddress: string;

  @Column({ name: 'grantor_address', length: 42 })
  grantorAddress: string;

  @Column({ name: 'grantee_address', length: 42 })
  granteeAddress: string;

  @Column({ name: 'tx_hash', length: 66 })
  txHash: string;

  @Column({ name: 'total_usdc', type: 'bigint' })
  totalUsdc: string; // stored as string to avoid JS bigint precision loss

  @Column({ name: 'is_streaming', default: false })
  isStreaming: boolean;

  @Column({ name: 'quorum' })
  quorum: number;

  // JSON arrays stored as text
  @Column({ name: 'committee', type: 'text' })
  committee: string; // JSON string of address[]

  @Column({ name: 'milestones', type: 'text' })
  milestones: string; // JSON string of MilestoneInput[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
