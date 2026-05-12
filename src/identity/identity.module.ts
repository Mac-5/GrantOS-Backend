// src/identity/identity.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { WebProof } from './entities/web-proof.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WebProof])],
  controllers: [IdentityController],
  providers: [IdentityService],
})
export class IdentityModule {}
