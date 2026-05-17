// src/identity/identity.controller.ts
// Thin HTTP layer for the GitHub OAuth Oracle + EAS Identity Binding flow.
// Every route is documented with Swagger decorators.
//
// Routes:
//   POST /identity/init                    → create pending session
//   GET  /identity/oauth-url/:requestId    → get GitHub OAuth URL
//   GET  /identity/callback                → GitHub OAuth callback (redirects)
//   GET  /identity/attestation/:requestId  → get EAS attestation + GitHub data
//   POST /identity/confirmed/:requestId    → mark as verified (frontend sends txHash)
//   GET  /identity/status/:requestId       → polling endpoint

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { IdentityService } from './identity.service';
import {
  InitVerificationDto,
  ConfirmTxDto,
  InitVerificationResponseDto,
  OAuthUrlResponseDto,
  AttestationResponseDto,
  ConfirmResponseDto,
  VerificationStatusDto,
  VerifyZkProofDto,
  VerifyZkProofResponseDto,
} from './dto/identity.dto';

@ApiTags('Identity — GitHub OAuth Oracle + EAS Attestation')
@Controller()
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  // ── POST /identity/init ───────────────────────────────────────────────────

  @Post('identity/init')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initialise a verification session',
    description:
      'Called by the frontend before starting the GitHub OAuth flow. ' +
      'Creates a pending record identified by requestId. ' +
      'Follow up with GET /identity/oauth-url/:requestId to get the OAuth URL.',
  })
  @ApiResponse({ status: 200, type: InitVerificationResponseDto })
  @ApiResponse({ status: 409, description: 'Wallet already verified' })
  async initVerification(
    @Body() dto: InitVerificationDto,
  ): Promise<InitVerificationResponseDto> {
    const requestId = dto.requestId ?? randomUUID();
    await this.identityService.initVerification(requestId, dto.walletAddress);
    return { success: true, requestId };
  }

  // ── GET /identity/oauth-url/:requestId ─────────────────────────────────────

  @Get('identity/oauth-url/:requestId')
  @ApiOperation({
    summary: 'Get the GitHub OAuth authorization URL',
    description:
      'Generates a GitHub OAuth authorization URL with state=requestId ' +
      'and scope=read:user,read:org. The frontend redirects the user to this URL.',
  })
  @ApiParam({ name: 'requestId', description: 'UUID from initVerification' })
  @ApiResponse({ status: 200, type: OAuthUrlResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Session not found — call /identity/init first',
  })
  async getOAuthUrl(
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<OAuthUrlResponseDto> {
    return this.identityService.getOAuthUrl(requestId);
  }

  // ── GET /identity/callback ─────────────────────────────────────────────────

  @Get('identity/callback')
  @ApiOperation({
    summary: 'GitHub OAuth callback',
    description:
      'GitHub redirects here with ?code=...&state=requestId after the user ' +
      'authorizes. The backend exchanges the code for an access token, fetches ' +
      'all GitHub contributor data, issues an EAS attestation on-chain, and ' +
      'redirects to the frontend success/failure page.',
  })
  @ApiQuery({ name: 'code', description: 'GitHub OAuth authorization code' })
  @ApiQuery({
    name: 'state',
    description: 'The requestId passed as OAuth state',
  })
  @ApiResponse({ status: 302, description: 'Redirect to frontend' })
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const redirectUrl = await this.identityService.handleOAuthCallback(
      code,
      state,
    );
    res.redirect(redirectUrl);
  }

  // ── GET /identity/attestation/:requestId ───────────────────────────────────

  @Get('identity/attestation/:requestId')
  @ApiOperation({
    summary: 'Retrieve EAS attestation UID and GitHub data',
    description:
      'Called by the frontend after redirect. Returns the EAS attestation UID, ' +
      'transaction hash, and all extracted GitHub contributor data.',
  })
  @ApiParam({ name: 'requestId', description: 'UUID from initVerification' })
  @ApiResponse({ status: 200, type: AttestationResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Session not found or not yet complete',
  })
  async getAttestation(
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<AttestationResponseDto> {
    return this.identityService.getAttestation(requestId);
  }

  // ── GET /identity/attestation/wallet/:address ──────────────────────────────

  @Get('identity/attestation/wallet/:address')
  @ApiOperation({
    summary: 'Retrieve EAS attestation and GitHub data by wallet address',
    description:
      'Called by the frontend to fetch the oracle attestation details (signature, message hash, and inputs) ' +
      'associated with a specific verified or attested wallet address.',
  })
  @ApiParam({ name: 'address', description: 'Ethereum wallet address' })
  @ApiResponse({ status: 200, type: AttestationResponseDto })
  @ApiResponse({
    status: 404,
    description: 'No verified/attested session found for this wallet address',
  })
  async getAttestationByWallet(
    @Param('address') address: string,
  ): Promise<AttestationResponseDto> {
    return this.identityService.getAttestationByWallet(address);
  }

  // ── POST /identity/confirmed/:requestId ───────────────────────────────────

  @Post('identity/confirmed/:requestId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark verification as on-chain confirmed',
    description:
      'Called by the frontend after any additional on-chain action is confirmed. ' +
      'Marks the record as VERIFIED and stores the transaction hash.',
  })
  @ApiParam({ name: 'requestId', description: 'UUID from initVerification' })
  @ApiResponse({ status: 200, type: ConfirmResponseDto })
  async confirmVerification(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ConfirmTxDto,
  ): Promise<ConfirmResponseDto> {
    await this.identityService.markVerified(requestId, dto.txHash);
    return { success: true, txHash: dto.txHash };
  }

  // ── GET /identity/status/:requestId ──────────────────────────────────────

  @Get('identity/status/:requestId')
  @ApiOperation({
    summary: 'Lightweight status poll',
    description:
      'Returns the current status of a verification session. ' +
      'The frontend polls this every 2 seconds while waiting for the OAuth callback. ' +
      'Once status = "attested", the attestation is available at GET /identity/attestation/:requestId.',
  })
  @ApiParam({ name: 'requestId', description: 'UUID from initVerification' })
  @ApiResponse({ status: 200, type: VerificationStatusDto })
  async getStatus(
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<VerificationStatusDto> {
    return this.identityService.getStatus(requestId);
  }

  // ── GET /identity/verified/:address ──────────────────────────────────────

  @Get('identity/verified/:address')
  @ApiOperation({
    summary: 'Check if a wallet address is already ZK verified',
    description: 'Returns { verified: true } if the wallet has a completed verification, { verified: false } otherwise.',
  })
  @ApiParam({ name: 'address', description: 'Ethereum wallet address' })
  @ApiResponse({ status: 200, schema: { example: { verified: true } } })
  async isWalletVerified(
    @Param('address') address: string,
  ): Promise<{ verified: boolean }> {
    return this.identityService.isWalletVerified(address);
  }

  // ── POST /identity/zk/verify ───────────────────────────────────────────────

  @Post('identity/zk/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify generated ZK proof server-side',
    description:
      'Runs proof verification in Node.js using Barretenberg and returns a definite pass/fail result.',
  })
  @ApiResponse({ status: 200, type: VerifyZkProofResponseDto })
  async verifyZkProof(
    @Body() dto: VerifyZkProofDto,
  ): Promise<VerifyZkProofResponseDto> {
    return this.identityService.verifyZkProof(dto.proof, dto.publicInputs);
  }
}
