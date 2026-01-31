import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { VerifyAppTokenDto } from 'src/dto/app-auth/verify-app-token.dto';
import { AppAuthLogic } from './app-auth.logic';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('App Authentication')
@Controller('app-auth')
export class AppAuthController {
  constructor(private readonly logic: AppAuthLogic) {}

  @Post('generate')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('bd')
  @ApiOperation({ summary: 'Generate app pairing token (CMS)' })
  generate(@CurrentUser() user: any) {
    return this.logic.generate(user.userId);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify token from mobile app' })
  verify(@Body() dto: VerifyAppTokenDto, @Req() req: any) {
    return this.logic.verify(dto, req.ip);
  }

  @Post('revoke')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke app access (CMS logout)' })
  revoke(@CurrentUser() user: any) {
    return this.logic.revoke(user.userId);
  }
}
