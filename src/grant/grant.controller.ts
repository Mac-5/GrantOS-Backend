// src/grant/grant.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GrantService } from './grant.service';
import { IndexGrantDto } from './dto/grant.dto';
import { Grant } from './entities/grant.entity';

@ApiTags('Grants')
@Controller('grants')
export class GrantController {
  constructor(private readonly grantService: GrantService) {}

  /**
   * Called by the frontend after the GrantFactory.GrantCreated event is confirmed.
   * Indexes the grant so it can be retrieved by ID on the success screen.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Index a newly created on-chain grant' })
  @ApiResponse({ status: 201, type: Grant })
  @ApiResponse({ status: 409, description: 'Grant already indexed' })
  async index(@Body() dto: IndexGrantDto): Promise<Grant> {
    return this.grantService.index(dto);
  }

  /**
   * List all grants for a builder address.
   */
  @Get()
  @ApiOperation({ summary: 'List grants by grantee address' })
  @ApiQuery({ name: 'grantee', description: 'Builder wallet address', required: false })
  @ApiResponse({ status: 200, type: [Grant] })
  async findByGrantee(@Query('grantee') grantee?: string): Promise<Grant[]> {
    if (grantee) {
      return this.grantService.findByGrantee(grantee);
    }
    return [];
  }

  /**
   * List all grants where a specific address is a committee member.
   */
  @Get('committee')
  @ApiOperation({ summary: 'List grants by committee member address' })
  @ApiQuery({ name: 'address', description: 'Committee member wallet address' })
  @ApiResponse({ status: 200, type: [Grant] })
  async findByCommitteeAddress(@Query('address') address: string): Promise<Grant[]> {
    return this.grantService.findByCommitteeAddress(address);
  }

  /**
   * Fetch a grant by its on-chain ID (emitted in GrantCreated event).
   * Used by the success screen and the grant detail page.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get grant by on-chain ID' })
  @ApiParam({ name: 'id', description: 'On-chain grantId from GrantFactory' })
  @ApiResponse({ status: 200, type: Grant })
  @ApiResponse({ status: 404, description: 'Grant not found' })
  async findById(@Param('id', ParseIntPipe) id: number): Promise<Grant> {
    return this.grantService.findById(id);
  }

  /**
   * Hard-delete a single grant by on-chain ID. Used for test data cleanup.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a grant by on-chain ID' })
  @ApiParam({ name: 'id', description: 'On-chain grantId to delete' })
  @ApiResponse({ status: 204, description: 'Grant deleted' })
  @ApiResponse({ status: 404, description: 'Grant not found' })
  async deleteById(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.grantService.deleteById(id);
  }

  /**
   * Hard-delete ALL grants. Used for wiping test data.
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all grants (test cleanup)' })
  @ApiResponse({ status: 200, description: 'All grants deleted' })
  async deleteAll(): Promise<{ deleted: number }> {
    return this.grantService.deleteAll();
  }
}
