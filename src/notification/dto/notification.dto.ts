import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateNotificationDto {
  @ApiProperty({ example: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' })
  @IsString()
  @IsNotEmpty()
  recipientAddress: string;

  @ApiProperty({ example: 'milestone_approved' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ example: 'builder' })
  @IsString()
  @IsNotEmpty()
  role: string;

  @ApiProperty({ example: 'milestone' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ example: 'Milestone approved' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Your milestone has been approved by the committee' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ example: 'ESCROW EVENT' })
  @IsString()
  @IsNotEmpty()
  source: string;

  @ApiProperty({ example: '/builder' })
  @IsString()
  @IsNotEmpty()
  href: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  dedupeKey?: string;
}

export class MarkAsReadDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'] })
  @IsString({ each: true })
  @IsNotEmpty()
  notificationIds: string[];
}

export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  recipientAddress: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  role: string;

  @ApiProperty()
  category: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  source: string;

  @ApiProperty()
  href: string;

  @ApiProperty()
  read: boolean;

  @ApiProperty()
  createdAt: Date;
}
