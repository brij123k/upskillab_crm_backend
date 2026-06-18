import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RoleData } from './role.data';
import { LevelService } from '../level/level.service';

@Injectable()
export class RoleSeed implements OnModuleInit {
  private readonly logger = new Logger('RoleSeed');

  constructor(
    private readonly roleData: RoleData,
    private readonly levelService: LevelService,
  ) {}

  async onModuleInit() {
    // Ensure L1 exists
    let l1 = await this.levelService.findByName('L1');

    if (!l1) {
      l1 = await this.levelService.create({
        name: 'L1',
      });
    }

    // Ensure Admin Level exists
    let adminLevel = await this.levelService.findByName('L100');

    if (!adminLevel) {
      adminLevel = await this.levelService.create({
        name: 'L100',
      });
    }

    const adminRole = await this.roleData.findByName('Admin');
    const existingRoles = await this.roleData.findAll();

    for (const role of existingRoles) {
      if (role.name === 'Admin') {
        if (
          !role.levelId ||
          role.levelId.toString() !== adminLevel._id.toString()
        ) {
          await this.roleData.update(role._id.toString(), {
            levelId: adminLevel._id,
          });
        }

        continue;
      }

      if (!role.levelId) {
        await this.roleData.update(role._id.toString(), {
          levelId: l1._id,
        });
      }
    }

    if (adminRole) {
      this.logger.log('Admin role already exists');
      return;
    }

    await this.roleData.create({
      name: 'Admin',
      levelId: adminLevel._id,
      isSuperAdmin: true,
      permissions: [],
    });

    this.logger.log('Admin role created successfully');
  }
}