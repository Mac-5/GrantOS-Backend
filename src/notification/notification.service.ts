import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    // Check for duplicate if dedupeKey is provided
    if (dto.dedupeKey) {
      const existing = await this.notificationRepo.findOne({
        where: {
          recipientAddress: dto.recipientAddress.toLowerCase(),
          dedupeKey: dto.dedupeKey,
        },
      });
      if (existing) {
        return existing;
      }
    }

    const notification = this.notificationRepo.create({
      ...dto,
      recipientAddress: dto.recipientAddress.toLowerCase(),
    });

    return this.notificationRepo.save(notification);
  }

  async findByAddress(address: string, role?: string): Promise<Notification[]> {
    const where: any = { recipientAddress: address.toLowerCase() };
    if (role) {
      where.role = role;
    }

    return this.notificationRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async getUnreadCount(address: string, role?: string): Promise<number> {
    const where: any = {
      recipientAddress: address.toLowerCase(),
      read: false,
    };
    if (role) {
      where.role = role;
    }

    return this.notificationRepo.count({ where });
  }

  async markAsRead(id: string, address: string): Promise<Notification> {
    const notification = await this.notificationRepo.findOne({
      where: { id, recipientAddress: address.toLowerCase() },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    notification.read = true;
    return this.notificationRepo.save(notification);
  }

  async markManyAsRead(ids: string[], address: string): Promise<void> {
    await this.notificationRepo.update(
      {
        id: ids.length > 0 ? ids[0] : undefined,
        recipientAddress: address.toLowerCase(),
      },
      { read: true },
    );

    // Bulk update for multiple IDs
    if (ids.length > 0) {
      await this.notificationRepo
        .createQueryBuilder()
        .update(Notification)
        .set({ read: true })
        .where('id IN (:...ids)', { ids })
        .andWhere('recipient_address = :address', {
          address: address.toLowerCase(),
        })
        .execute();
    }
  }

  async markAllAsRead(address: string, role?: string): Promise<void> {
    const where: any = { recipientAddress: address.toLowerCase() };
    if (role) {
      where.role = role;
    }

    await this.notificationRepo.update(where, { read: true });
  }

  async deleteRead(address: string, role?: string): Promise<void> {
    const where: any = {
      recipientAddress: address.toLowerCase(),
      read: true,
    };
    if (role) {
      where.role = role;
    }

    await this.notificationRepo.delete(where);
  }

  async deleteAll(address: string, role?: string): Promise<void> {
    const where: any = { recipientAddress: address.toLowerCase() };
    if (role) {
      where.role = role;
    }

    await this.notificationRepo.delete(where);
  }
}
