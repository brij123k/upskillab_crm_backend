import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserLogic } from './user.logic';
import {RegisterUserDto} from 'src/dto/user/register-user.dto';
import { LoginDto } from 'src/dto/user/login.dto';
import { ForgetPasswordDto } from 'src/dto/user/forget-password.dto';
import { VerifyOtpDto } from 'src/dto/user/verify-otp.dto';
import { ResetPasswordDto } from 'src/dto/user/reset-password.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ChangeStatusDto } from 'src/dto/user/change-status.dto';
import { ToggleDashboardDto } from 'src/dto/user/toggle-dashboard.dto';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { ChangeUserDto } from 'src/dto/user/userupdate.dto';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly logic: UserLogic) {}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.logic.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.logic.login(dto);
  }

  @Post('forget-password')
  forget(@Body() dto: ForgetPasswordDto) {
    return this.logic.sendOtp(dto.email);
  }

  @Post('verify-otp')
  verify(@Body() dto: VerifyOtpDto) {
    return this.logic.verifyOtp(dto.email, dto.otp);
  }

  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.logic.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin')
@Patch(':id/status')
@ApiOperation({ summary: 'Change user status' })
changeStatus(
  @Param('id') userId: string,
  @Body() dto: ChangeStatusDto,
) {
  return this.logic.changeStatus(userId, dto.status);
}

@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin')
@Patch(':id/toggle-block')
@ApiOperation({ summary: 'Block / Unblock user' })
toggleBlock(@Param('id') userId: string) {
  return this.logic.toggleBlock(userId);
}


@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin')
@Patch(':id/toggle-dashboard')
@ApiOperation({
  summary: 'Admin enables dashboard & creates profile',
})
toggleDashboard(
  @Param('id') userId: string,
  @Body() dto: ToggleDashboardDto,
) {
  return this.logic.toggleDashboard(userId, dto);
}

@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin','bd')
@RequirePermission(
  PERMISSIONS.USER.MODULE,
  PERMISSIONS.USER.ACTIONS.READ,
)
@Get()
@ApiOperation({
  summary:"get all user detail"
})
getAllUsers(){
  return this.logic.getAllUsersWithProfile()
}



@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('admin')
@RequirePermission(
  PERMISSIONS.USER.MODULE,
  PERMISSIONS.USER.ACTIONS.UPDATE,
)
@Patch('user/:id')
@ApiOperation({
  summary:"update any User"
})
UpdateUser(
  @Param('id') userId: string,
  @Body() dto: ChangeUserDto,
){
  return this.logic.updateUserAndProfile(userId,dto)
}


}
