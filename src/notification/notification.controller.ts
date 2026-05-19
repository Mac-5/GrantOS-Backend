import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import {
  CreateNotificationDto,
  MarkAsReadDto,
  NotificationResponseDto,
} from './dto/notification.dto';
import { Notification } from './entities/notification.entity';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new notification' })
  @ApiResponse({ status: 201, type: NotificationResponseDto })
  async create(@Body() dto: CreateNotificationDto): Promise<Notification> {
    return this.notificationService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get notifications for an address' })
  @ApiQuery({ name: 'address', description: 'Wallet address', required: true })
  @ApiQuery({ name: 'role', description: 'Filter by role', required: false })
  @ApiResponse({ status: 200, type: [NotificationResponseDto] })
  async findByAddress(
    @Query('address') address: string,
    @Query('role') role?: string,
  ): Promise<Notification[]> {
    return this.notificationService.findByAddress(address, role);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiQuery({ name: 'address', description: 'Wallet address', required: true })
  @ApiQuery({ name: 'role', description: 'Filter by role', required: false })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: { count: { type: 'number' } } } })
  async getUnreadCount(
    @Query('address') address: string,
    @Query('role') role?: string,
  ): Promise<{ count: number }> {
    const count = await this.notificationService.getUnreadCount(address, role);
    return { count };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiQuery({ name: 'address', description: 'Wallet address', required: true })
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  async markAsRead(
    @Param('id') id: string,
    @Query('address') address: string,
  ): Promise<Notification> {
    return this.notificationService.markAsRead(id, address);
  }

  @Patch('read')
  @ApiOperation({ summary: 'Mark multiple notifications as read' })
  @ApiQuery({ name: 'address', description: 'Wallet address', required: true })
  @ApiResponse({ status: 200 })
  async markManyAsRead(
    @Body() dto: MarkAsReadDto,
    @Query('address') address: string,
  ): Promise<void> {
    return this.notificationService.markManyAsRead(dto.notificationIds, address);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiQuery({ name: 'address', description: 'Wallet address', required: true })
  @ApiQuery({ name: 'role', description: 'Filter by role', required: false })
  @ApiResponse({ status: 200 })
  async markAllAsRead(
    @Query('address') address: string,
    @Query('role') role?: string,
  ): Promise<void> {
    return this.notificationService.markAllAsRead(address, role);
  }

  @Delete('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete all read notifications' })
  @ApiQuery({ name: 'address', description: 'Wallet address', required: true })
  @ApiQuery({ name: 'role', description: 'Filter by role', required: false })
  @ApiResponse({ status: 204 })
  async deleteRead(
    @Query('address') address: string,
    @Query('role') role?: string,
  ): Promise<void> {
    return this.notificationService.deleteRead(address, role);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete all notifications' })
  @ApiQuery({ name: 'address', description: 'Wallet address', required: true })
  @ApiQuery({ name: 'role', description: 'Filter by role', required: false })
  @ApiResponse({ status: 204 })
  async deleteAll(
    @Query('address') address: string,
    @Query('role') role?: string,
  ): Promise<void> {
    return this.notificationService.deleteAll(address, role);
  }
}
