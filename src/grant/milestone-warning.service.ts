import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MilestoneWarning } from './entities/milestone-warning.entity';
import { IssueWarningDto, RecordSlashDto } from './dto/milestone-warning.dto';

@Injectable()
export class MilestoneWarningService {
  constructor(
    @InjectRepository(MilestoneWarning)
    private readonly repo: Repository<MilestoneWarning>,
  ) {}

  async issueWarning(dto: IssueWarningDto): Promise<MilestoneWarning> {
    const existing = await this.repo.findOne({
      where: { grantId: dto.grantId, milestoneIndex: dto.milestoneIndex, slashed: false },
    });
    if (existing) {
      throw new ConflictException(
        `Active warning already exists for grant ${dto.grantId} milestone ${dto.milestoneIndex}`,
      );
    }

    const warningTs = BigInt(dto.warningTimestamp);
    const slashUnlocksAt = (warningTs + BigInt(24 * 60 * 60)).toString();

    const warning = this.repo.create({
      grantId: dto.grantId,
      milestoneIndex: dto.milestoneIndex,
      builderAddress: dto.builderAddress.toLowerCase(),
      committeeAddress: dto.committeeAddress.toLowerCase(),
      message: dto.message,
      attestationUid: dto.attestationUid,
      txHash: dto.txHash,
      warningTimestamp: dto.warningTimestamp,
      slashUnlocksAt,
      slashed: false,
    });

    return this.repo.save(warning);
  }

  async recordSlash(dto: RecordSlashDto): Promise<MilestoneWarning> {
    const warning = await this.repo.findOne({
      where: { grantId: dto.grantId, milestoneIndex: dto.milestoneIndex, slashed: false },
    });

    if (!warning) {
      throw new NotFoundException(
        `No active warning found for grant ${dto.grantId} milestone ${dto.milestoneIndex}`,
      );
    }

    warning.slashed = true;
    warning.slashedAt = dto.slashedAt;
    warning.slashTxHash = dto.slashTxHash;
    warning.amountReturnedUsdc = dto.amountReturnedUsdc;

    return this.repo.save(warning);
  }

  async getWarningByMilestone(grantId: number, milestoneIndex: number): Promise<MilestoneWarning | null> {
    return this.repo.findOne({
      where: { grantId, milestoneIndex },
      order: { createdAt: 'DESC' },
    });
  }

  async getWarningsByBuilder(builderAddress: string): Promise<MilestoneWarning[]> {
    return this.repo.find({
      where: { builderAddress: builderAddress.toLowerCase() },
      order: { createdAt: 'DESC' },
    });
  }

  async getActiveWarningsByBuilder(builderAddress: string): Promise<MilestoneWarning[]> {
    return this.repo.find({
      where: { builderAddress: builderAddress.toLowerCase(), slashed: false },
      order: { createdAt: 'DESC' },
    });
  }

  async getSlashCount(): Promise<number> {
    return this.repo.count({ where: { slashed: true } });
  }
}
