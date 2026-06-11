// src/grant/grant.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrantController } from './grant.controller';
import { GrantService } from './grant.service';
import { Grant } from './entities/grant.entity';
import { MilestoneSubmissionController } from './milestone-submission.controller';
import { MilestoneSubmissionService } from './milestone-submission.service';
import { MilestoneSubmission } from './entities/milestone-submission.entity';
import { MilestoneWarningController } from './milestone-warning.controller';
import { MilestoneWarningService } from './milestone-warning.service';
import { MilestoneWarning } from './entities/milestone-warning.entity';
import { GrantEventService } from './grant-event.service';
import { GrantIndexerService } from './grant-indexer.service';
import { AiVerifierService } from './ai-verifier.service';
import { NotificationModule } from '../notification/notification.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Grant, MilestoneSubmission, MilestoneWarning]),
    NotificationModule,
    IdentityModule,
  ],
  controllers: [GrantController, MilestoneSubmissionController, MilestoneWarningController],
  providers: [GrantService, MilestoneSubmissionService, MilestoneWarningService, GrantEventService, GrantIndexerService, AiVerifierService],
  exports: [GrantService, GrantEventService, GrantIndexerService],
})
export class GrantModule {}
