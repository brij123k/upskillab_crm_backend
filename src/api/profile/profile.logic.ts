import { Injectable, NotFoundException } from '@nestjs/common';
import { ProfileData } from './profile.data';
import { Types } from 'mongoose';
import { UserData } from '../user/user.data';

@Injectable()
export class ProfileLogic {
  constructor(private readonly profileData: ProfileData) {}

  private normalizePoolIds(data: any): Types.ObjectId[] | undefined {
    if (!data) return undefined;

    if (Array.isArray(data.poolIds) && data.poolIds.length) {
      return data.poolIds.map((id: string) => new Types.ObjectId(id));
    }

    if (data.poolId) {
      return [new Types.ObjectId(data.poolId)];
    }

    return undefined;
  }

  private normalizeProfilePayload(data: any) {
    const payload: any = { ...data };

    if (data.userId) payload.userId = new Types.ObjectId(data.userId);
    if (data.departmentId) payload.departmentId = new Types.ObjectId(data.departmentId);
    if (data.reportingSeniorId) payload.reportingSeniorId = new Types.ObjectId(data.reportingSeniorId);

    const poolIds = this.normalizePoolIds(data);
    if (poolIds) payload.poolIds = poolIds;

    // Keep the API backwards compatible by allowing `poolId` while storing it as `poolIds`
    delete payload.poolId;

    return payload;
  }

  createProfile(data: any) {
    return this.profileData.create(this.normalizeProfilePayload(data));
  }

  getAll() {
    return this.profileData.findAll();
  }

  async getProfilesByUserIds(userIds: any) {
  return this.profileData
    .findByUserIds(userIds);
}

  async getBydepartmentId(departmentId: string, status?: string | string[]) {
      const profile = await this.profileData.getBydepId(departmentId, status);
    if (!profile) return [];
    return profile.filter((item: any) => item.userId);
  }
  async getById(id: string) {
    const profile = await this.profileData.findById(id);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async getByUserId(userId: string) {

  }

  updateById(id: string, dto: any) {
    return this.profileData.updateById(id, this.normalizeProfilePayload(dto));
  }

  updateByUserId(userId: string, dto: any) {
    return this.profileData.updateByUserId(userId, this.normalizeProfilePayload(dto));
  }

  deleteById(id: string) {
    return this.profileData.deleteById(id);
  }

  deleteByUserId(userId: string) {
    return this.profileData.deleteByUserId(userId);
  }


}
