import { Injectable } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';
import { NotificationGateway } from '../notification/notification.gateway';

@Injectable()
export class GrantEventService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async notifyGrantCreated(
    builderAddress: string,
    grantId: number,
    totalUsdc: string,
  ): Promise<void> {
    const notification = await this.notificationService.create({
      recipientAddress: builderAddress,
      type: 'grant_created',
      role: 'builder',
      category: 'approval',
      title: 'New grant awarded',
      message: `You have been awarded a new grant — Grant #${grantId} for ${totalUsdc} USDC`,
      source: 'ESCROW EVENT',
      href: '/builder',
      dedupeKey: `builder:grant_created:${grantId}`,
    });

    this.notificationGateway.notifyUser(builderAddress, notification);
  }

  async notifyMilestoneApproved(
    builderAddress: string,
    grantId: number,
    milestoneIndex: number,
    title: string,
    amount: string,
  ): Promise<void> {
    const notification = await this.notificationService.create({
      recipientAddress: builderAddress,
      type: 'milestone_approved',
      role: 'builder',
      category: 'milestone',
      title: `${title} approved`,
      message: `Milestone ${title} approved — ${amount} USDC released`,
      source: 'ESCROW EVENT',
      href: '/builder',
      dedupeKey: `builder:approved:${grantId}:${milestoneIndex}`,
    });

    this.notificationGateway.notifyUser(builderAddress, notification);
  }

  async notifyMilestoneRejected(
    builderAddress: string,
    grantId: number,
    milestoneIndex: number,
    title: string,
  ): Promise<void> {
    const notification = await this.notificationService.create({
      recipientAddress: builderAddress,
      type: 'milestone_rejected',
      role: 'builder',
      category: 'milestone',
      title: `${title} rejected`,
      message: `Milestone ${title} rejected — view committee feedback and resubmit`,
      source: 'ESCROW EVENT',
      href: `/grants/${grantId}/milestones/${milestoneIndex}/submit`,
      dedupeKey: `builder:rejected:${grantId}:${milestoneIndex}`,
    });

    this.notificationGateway.notifyUser(builderAddress, notification);
  }

  async notifyCommitteeMilestoneSubmitted(
    committeeAddresses: string[],
    grantId: number,
    milestoneIndex: number,
    title: string,
    builderAddress: string,
  ): Promise<void> {
    for (const address of committeeAddresses) {
      const notification = await this.notificationService.create({
        recipientAddress: address,
        type: 'milestone_submitted',
        role: 'committee',
        category: 'milestone',
        title: 'ZK proof submitted',
        message: `Builder ${builderAddress.slice(0, 6)}…${builderAddress.slice(-4)} submitted ZK proof for ${title} — review now`,
        source: 'ESCROW EVENT',
        href: '/committee',
        dedupeKey: `committee:submitted:${grantId}:${milestoneIndex}:${builderAddress}`,
      });

      this.notificationGateway.notifyUser(address, notification);
    }
  }
}
