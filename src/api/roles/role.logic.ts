import { Injectable, NotFoundException } from '@nestjs/common';
import { RoleData } from './role.data';
import { CreateRoleDto } from 'src/dto/role/create-role.dto';
import { UpdateRoleDto } from 'src/dto/role/update-role.dto';

@Injectable()
export class RoleLogic {
  constructor(private readonly roleData: RoleData) {}

  createRole(dto: CreateRoleDto) {
    return this.roleData.create(dto);
  }

  getRoles() {
    return this.roleData.findAll();
  }

  async getRole(id: string) {
    const role = await this.roleData.findById(id);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.roleData.update(id, dto);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async deleteRole(id: string) {
    const role = await this.roleData.delete(id);
    if (!role) throw new NotFoundException('Role not found');
    return { message: 'Role deleted successfully' };
  }
}
