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
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MilestoneWarningService } from './milestone-warning.service';
import { IssueWarningDto, RecordSlashDto } from './dto/milestone-warning.dto';
import { MilestoneWarning } from './entities/milestone-warning.entity';

@ApiTags('Milestone Warnings')
@Controller('warnings')
export class MilestoneWarningController {
  constructor(private readonly warningService: MilestoneWarningService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Issue a warning attestation for an overdue milestone' })
  @ApiResponse({ status: 201, type: MilestoneWarning })
  @ApiResponse({ status: 409, description: 'Active warning already exists' })
  async issueWarning(@Body() dto: IssueWarningDto): Promise<MilestoneWarning> {
    return this.warningService.issueWarning(dto);
  }

  @Post('slash')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a slash execution for a warned milestone' })
  @ApiResponse({ status: 200, type: MilestoneWarning })
  @ApiResponse({ status: 404, description: 'No active warning found' })
  async recordSlash(@Body() dto: RecordSlashDto): Promise<MilestoneWarning> {
    return this.warningService.recordSlash(dto);
  }

  @Get('milestone/:grantId/:milestoneIndex')
  @ApiOperation({ summary: 'Get warning for a specific milestone' })
  @ApiParam({ name: 'grantId', description: 'Grant ID' })
  @ApiParam({ name: 'milestoneIndex', description: 'Milestone index' })
  @ApiResponse({ status: 200, type: MilestoneWarning })
  @ApiResponse({ status: 404, description: 'Warning not found' })
  async getWarningByMilestone(
    @Param('grantId', ParseIntPipe) grantId: number,
    @Param('milestoneIndex', ParseIntPipe) milestoneIndex: number,
  ): Promise<MilestoneWarning | null> {
    return this.warningService.getWarningByMilestone(grantId, milestoneIndex);
  }

  @Get('builder')
  @ApiOperation({ summary: 'Get all warnings for a builder' })
  @ApiQuery({ name: 'address', description: 'Builder wallet address' })
  @ApiQuery({ name: 'active', description: 'Filter for active warnings only', required: false })
  @ApiResponse({ status: 200, type: [MilestoneWarning] })
  async getWarningsByBuilder(
    @Query('address') address: string,
    @Query('active') active?: string,
  ): Promise<MilestoneWarning[]> {
    if (active === 'true') {
      return this.warningService.getActiveWarningsByBuilder(address);
    }
    return this.warningService.getWarningsByBuilder(address);
  }

  @Get('slash-count')
  @ApiOperation({ summary: 'Get total number of slashed milestones' })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: { count: { type: 'number' } } } })
  async getSlashCount(): Promise<{ count: number }> {
    const count = await this.warningService.getSlashCount();
    return { count };
  }
}
