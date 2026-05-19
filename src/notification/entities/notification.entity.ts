import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notifications')
@Index(['recipientAddress', 'read'])
@Index(['recipientAddress', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recipient_address', length: 42 })
  @Index()
  recipientAddress: string;

  @Column({ name: 'type', length: 50 })
  type: string;

  @Column({ name: 'role', length: 20 })
  role: string;

  @Column({ name: 'category', length: 20 })
  category: string;

  @Column({ name: 'title', length: 255 })
  title: string;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'source', length: 50 })
  source: string;

  @Column({ name: 'href', length: 255 })
  href: string;

  @Column({ name: 'read', default: false })
  read: boolean;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 255, nullable: true })
  @Index()
  dedupeKey: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
