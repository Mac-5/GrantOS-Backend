import { ApiProperty } from '@nestjs/swagger';
import { IsEthereumAddress, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class IssueWarningDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  grantId: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  milestoneIndex: number;

  @ApiProperty({ example: '0xBuilder...' })
  @IsEthereumAddress()
  builderAddress: string;

  @ApiProperty({ example: '0xCommittee...' })
  @IsEthereumAddress()
  committeeAddress: string;

  @ApiProperty({ example: 'Milestone is 7 days overdue. Please submit immediately.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ example: '0x1234...' })
  @IsString()
  @IsNotEmpty()
  attestationUid: string;

  @ApiProperty({ example: '0xabcd...' })
  @IsString()
  @IsNotEmpty()
  txHash: string;

  @ApiProperty({ example: '1715875200' })
  @IsString()
  @IsNotEmpty()
  warningTimestamp: string;
}

export class RecordSlashDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  grantId: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  milestoneIndex: number;

  @ApiProperty({ example: '0xabcd...' })
  @IsString()
  @IsNotEmpty()
  slashTxHash: string;

  @ApiProperty({ example: '1715961600' })
  @IsString()
  @IsNotEmpty()
  slashedAt: string;

  @ApiProperty({ example: '500000000' })
  @IsString()
  @IsNotEmpty()
  amountReturnedUsdc: string;
}
