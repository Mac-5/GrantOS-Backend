// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validate } from './config/env.validation';
import { IdentityModule } from './identity/identity.module';
import { WebProof } from './identity/entities/web-proof.entity';
import { GrantModule } from './grant/grant.module';
import { Grant } from './grant/entities/grant.entity';
import { MilestoneSubmission } from './grant/entities/milestone-submission.entity';
import { MilestoneWarning } from './grant/entities/milestone-warning.entity';

@Module({
  imports: [
    // ── Config ──────────────────────────────────────────────────────────────
    // Loads .env, validates all required variables at startup via class-validator.
    // If any required variable is missing, the app refuses to start with a clear error.
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      cache: true,
    }),

    // ── Database ─────────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        entities: [WebProof, Grant, MilestoneSubmission, MilestoneWarning],
        synchronize: config.get<boolean>('DB_SYNCHRONIZE') ?? false,
        logging: config.get<string>('NODE_ENV') === 'development',
        ssl:
          config.get<string>('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
      inject: [ConfigService],
    }),

    // ── Feature modules ───────────────────────────────────────────────────────
    IdentityModule,
    GrantModule,
  ],
})
export class AppModule {}
