// src/grant/milestone-submission.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MilestoneSubmissionService } from './milestone-submission.service';
import {
  SubmitMilestoneDto,
  RecordVoteDto,
  MilestoneSubmissionResponseDto,
} from './dto/milestone-submission.dto';
import { MilestoneSubmission } from './entities/milestone-submission.entity';

@ApiTags('Milestone Submissions')
@Controller('milestones')
export class MilestoneSubmissionController {
  constructor(
    private readonly submissionService: MilestoneSubmissionService,
  ) {}

  // ── POST /milestones/submit ────────────────────────────────────────────

  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a milestone submission',
    description:
      'Called by the frontend after the builder signs the submitMilestone ' +
      'transaction on-chain. Stores the ZK proof hash, EAS attestation UID, ' +
      'AI verdict, and builder summary for the committee review queue.',
  })
  @ApiResponse({ status: 201, type: MilestoneSubmissionResponseDto })
  @ApiResponse({ status: 409, description: 'Duplicate active submission' })
  async submit(
    @Body() dto: SubmitMilestoneDto,
  ): Promise<MilestoneSubmission> {
    return this.submissionService.submit(dto);
  }

  // ── POST /milestones/vote ──────────────────────────────────────────────

  @Post('vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a committee vote',
    description:
      'Called by the frontend after a committee member casts an approve/reject ' +
      'vote on-chain. Updates the submission approval/rejection counts and ' +
      'finalises the status if quorum is reached.',
  })
  @ApiResponse({ status: 200, type: MilestoneSubmissionResponseDto })
  @ApiResponse({ status: 404, description: 'No active submission found' })
  async recordVote(
    @Body() dto: RecordVoteDto,
  ): Promise<MilestoneSubmission> {
    return this.submissionService.recordVote(dto);
  }

  // ── GET /milestones/grant/:grantId ─────────────────────────────────────

  @Get('grant/:grantId')
  @ApiOperation({
    summary: 'Get all submissions for a grant',
    description: 'Returns all milestone submissions for a specific grant, ordered by milestone index.',
  })
  @ApiParam({ name: 'grantId', description: 'On-chain grant ID' })
  @ApiResponse({ status: 200, type: [MilestoneSubmissionResponseDto] })
  async findByGrant(
    @Param('grantId', ParseIntPipe) grantId: number,
  ): Promise<MilestoneSubmission[]> {
    return this.submissionService.findByGrant(grantId);
  }

  // ── GET /milestones/grant/:grantId/:milestoneIndex ─────────────────────

  @Get('grant/:grantId/:milestoneIndex')
  @ApiOperation({
    summary: 'Get submissions for a specific milestone',
    description:
      'Returns all submissions (including rejected/resubmitted) for a specific milestone.',
  })
  @ApiParam({ name: 'grantId', description: 'On-chain grant ID' })
  @ApiParam({ name: 'milestoneIndex', description: 'Milestone index' })
  @ApiResponse({ status: 200, type: [MilestoneSubmissionResponseDto] })
  async findByGrantAndMilestone(
    @Param('grantId', ParseIntPipe) grantId: number,
    @Param('milestoneIndex', ParseIntPipe) milestoneIndex: number,
  ): Promise<MilestoneSubmission[]> {
    return this.submissionService.findByGrantAndMilestone(
      grantId,
      milestoneIndex,
    );
  }

  // ── GET /milestones/builder?address=0x... ──────────────────────────────

  @Get('builder')
  @ApiOperation({
    summary: 'Get active submissions by builder',
    description: 'Returns all active (pending review) submissions for a builder address.',
  })
  @ApiQuery({ name: 'address', description: 'Builder wallet address' })
  @ApiResponse({ status: 200, type: [MilestoneSubmissionResponseDto] })
  async findActiveByBuilder(
    @Query('address') address: string,
  ): Promise<MilestoneSubmission[]> {
    return this.submissionService.findActiveByBuilder(address);
  }

  // ── GET /milestones/committee?grantIds=0,1,2 ──────────────────────────

  @Get('committee')
  @ApiOperation({
    summary: 'Get pending reviews for committee grants',
    description:
      'Returns all active submissions for a list of grant IDs where the caller ' +
      'is a committee member. Used to populate the committee review queue.',
  })
  @ApiQuery({
    name: 'grantIds',
    description: 'Comma-separated list of grant IDs',
  })
  @ApiResponse({ status: 200, type: [MilestoneSubmissionResponseDto] })
  async findByCommitteeGrants(
    @Query('grantIds') grantIds: string,
  ): Promise<MilestoneSubmission[]> {
    const ids = grantIds
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    return this.submissionService.findByCommitteeGrants(ids);
  }
}
