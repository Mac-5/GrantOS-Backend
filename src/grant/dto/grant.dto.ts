// src/grant/dto/grant.dto.ts
import {
  IsArray,
  IsBoolean,
  IsEthereumAddress,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class MilestoneDto {
  @ApiProperty({ example: 'Ship MVP' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Deploy the core smart contracts' })
  @IsString()
  description: string;

  @ApiProperty({ example: '500000000' }) // 500 USDC in 6-decimal units
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 1750000000 })
  @IsInt()
  deadline: number;

  @ApiProperty({ example: 0, description: '0 = ZKGitHub, 1 = EASOnly' })
  @IsInt()
  proofType: number;
}

export class IndexGrantDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  onChainId: number;

  @ApiProperty({ example: '0xEscrow...' })
  @IsEthereumAddress()
  escrowAddress: string;

  @ApiProperty({ example: '0xGrantor...' })
  @IsEthereumAddress()
  grantorAddress: string;

  @ApiProperty({ example: '0xBuilder...' })
  @IsEthereumAddress()
  granteeAddress: string;

  @ApiProperty({ example: '0xTxHash...' })
  @IsString()
  @IsNotEmpty()
  txHash: string;

  @ApiProperty({ example: '1000000000' })
  @IsString()
  @IsNotEmpty()
  totalUsdc: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  isStreaming: boolean;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quorum: number;

  @ApiProperty({ type: [String], example: ['0xAddr1', '0xAddr2'] })
  @IsArray()
  @IsEthereumAddress({ each: true })
  committee: string[];

  @ApiProperty({ type: [MilestoneDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MilestoneDto)
  milestones: MilestoneDto[];
}
