// src/grant/grant.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrantController } from './grant.controller';
import { GrantService } from './grant.service';
import { Grant } from './entities/grant.entity';
import { MilestoneSubmissionController } from './milestone-submission.controller';
import { MilestoneSubmissionService } from './milestone-submission.service';
import { MilestoneSubmission } from './entities/milestone-submission.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Grant, MilestoneSubmission])],
  controllers: [GrantController, MilestoneSubmissionController],
  providers: [GrantService, MilestoneSubmissionService],
})
export class GrantModule {}
