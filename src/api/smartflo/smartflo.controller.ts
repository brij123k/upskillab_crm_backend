import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SmartfloService } from './smartflo.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('IVR')
@Controller('IVR')
export class IVRController {
  constructor(private readonly smartfloService: SmartfloService) { }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Get('myNumbers')
  @ApiOperation({ summary: 'Get all roles' })
  findAll() {
    return this.smartfloService.getCallerIds();
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Post('click-to-call')
  @ApiOperation({ summary: 'Click To Call' })
  ClickToCall(@Body() dto: any, @Req() req: any) {
    return this.smartfloService.clickToCall(dto, req.user);
  }


  @Post('webhook/smartflo')
  async handleWebhook(@Body() body: any) {
    await this.smartfloService.hanldeWebhook(body)
    return { success: true };
  }

  @Post('submit-call-log')
  async submitCallLog(@Body() body: any) {
    await this.smartfloService.updateCallLog(body)
    return {
      success: true,
      message: 'Call log saved',
    };
  }
}
