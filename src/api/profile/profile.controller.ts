import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileLogic } from './profile.logic';
import { UpdateProfileDto } from 'src/dto/profile.dto';


@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfileController {
  constructor(private readonly logic: ProfileLogic) {}

  @Get()
  getAll() {
    return this.logic.getAll();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.logic.getById(id);
  }

  @Get('user/:userId')
  getByUserId(@Param('userId') userId: string) {
    return this.logic.getByUserId(userId);
  }

  @Get('department/:departmentId')
  getBydepartmentId(
    @Param('departmentId') departmentId: string,
    @Query('status') status?: string,
  ) {
    return this.logic.getBydepartmentId(departmentId, status);
  }

  @Patch(':id')
  updateById(
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.logic.updateById(id, dto);
  }

  @Patch('user/:userId')
  updateByUserId(
    @Param('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.logic.updateByUserId(userId, dto);
  }

  @Delete(':id')
  deleteById(@Param('id') id: string) {
    return this.logic.deleteById(id);
  }

  @Delete('user/:userId')
  deleteByUserId(@Param('userId') userId: string) {
    return this.logic.deleteByUserId(userId);
  }



}
