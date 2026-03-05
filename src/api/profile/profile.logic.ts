import { Injectable, NotFoundException } from '@nestjs/common';
import { ProfileData } from './profile.data';
import { Types } from 'mongoose';
import { UserData } from '../user/user.data';

@Injectable()
export class ProfileLogic {
  constructor(private readonly profileData: ProfileData,
  ) {}

  createProfile(data: any) {
    return this.profileData.create({
      ...data,
      userId:new Types.ObjectId(data.userId),
      departmentId:new Types.ObjectId(data.departmentId),
      poolId:new Types.ObjectId(data.poolId),
      reportingSeniorId:new Types.ObjectId(data.reportingSeniorId)
    });
  }

  getAll() {
    return this.profileData.findAll();
  }

  async getProfilesByUserIds(userIds: any) {
  return this.profileData
    .findByUserIds(userIds);
}

  async getBydepartmentId(departmentId: string) {
      const profile = await this.profileData.getBydepartmentId(departmentId);
    if (!profile) return [];
    return profile;
}
  async getById(id: string) {
    const profile = await this.profileData.findById(id);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async getByUserId(userId: string) {

  }

  updateById(id: string, dto: any) {
    return this.profileData.updateById(id, dto);
  }

  updateByUserId(userId: string, dto: any) {
    return this.profileData.updateByUserId(userId, dto);
  }

  deleteById(id: string) {
    return this.profileData.deleteById(id);
  }

  deleteByUserId(userId: string) {
    return this.profileData.deleteByUserId(userId);
  }


}
