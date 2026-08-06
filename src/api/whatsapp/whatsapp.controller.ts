import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';


import { WhatsappService } from './whatsapp.service';
import { GetTemplateDto } from './dto/get-template.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { SendTemplateDto } from './dto/send-template.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';

@ApiTags('WhatsApp')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin', 'bd')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
  ) {}

  @Get('templates')
  @ApiOperation({
    summary: 'Get all WhatsApp templates',
  })
  async getTemplates() {
    return this.whatsappService.getTemplates();
  }

  @Get('template/:id')
  @ApiOperation({
    summary: 'Get WhatsApp template by ID',
  })
  async getTemplateById(
    @Param('id') id:string,
  ) {
    return this.whatsappService.getTemplateById(id);
  }

@Post('send')
async sendTemplate(
  @Body() dto: SendTemplateDto,
) {
  return this.whatsappService.sendTemplate(dto);
}
}