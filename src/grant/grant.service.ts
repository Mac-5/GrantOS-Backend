// src/grant/grant.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Grant } from './entities/grant.entity';
import { IndexGrantDto } from './dto/grant.dto';

@Injectable()
export class GrantService {
  constructor(
    @InjectRepository(Grant)
    private readonly repo: Repository<Grant>,
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
}
