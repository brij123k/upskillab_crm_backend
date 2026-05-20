import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RoleData } from './role.data';

@Injectable()
export class RoleSeed implements OnModuleInit {
  private readonly logger = new Logger('RoleSeed');

  constructor(private readonly roleData: RoleData) {}

  async onModuleInit() {
    const adminRole = await this.roleData.findByName('Admin');
    const existingRoles = await this.roleData.findAll();

    for (const role of existingRoles) {
      if (role.name === 'Admin') {
        if (role.level !== 100) {
          await this.roleData.update(role._id.toString(), {
            level: 100,
          });
        }
        continue;
      }

      if (role.level === undefined || role.level === null) {
        await this.roleData.update(role._id.toString(), {
          level: 1,
        });
      }
    }

    if (adminRole) {
      this.logger.log('Admin role already exists');
      return;
    }

    await this.roleData.create({
      name: 'Admin',
      level: 100,
      isSuperAdmin: true,
      permissions: [],
    });

    this.logger.log('Admin role created successfully');
  }
}
