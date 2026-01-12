import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RoleData } from './role.data';

@Injectable()
export class RoleSeed implements OnModuleInit {
  private readonly logger = new Logger('RoleSeed');

  constructor(private readonly roleData: RoleData) {}

  async onModuleInit() {
    const adminRole = await this.roleData.findByName('Admin');

    if (adminRole) {
      this.logger.log('Admin role already exists');
      return;
    }

    await this.roleData.create({
      name: 'Admin',
      isSuperAdmin: true,
      permissions: [],
    });

    this.logger.log('Admin role created successfully');
  }
}
