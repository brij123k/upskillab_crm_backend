import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateCallLogDto } from 'src/dto/call-log/create-call-log.dto';
import { CallLogLogic } from './call-log.logic';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RoleGuard } from 'src/common/guards/role.guard';

@ApiTags('Call Logs')
@Controller('call-logs')
export class CallLogController {
  constructor(private readonly logic: CallLogLogic) {}

  @Post()
  @ApiOperation({ summary: 'Create call log (web & mobile)' })
    @UseGuards(JwtAuthGuard, RoleGuard)
   @Roles('admin','bd')
  create(
    @Body() dto: CreateCallLogDto,
    @CurrentUser() user: any,
  ) {
    return this.logic.create(dto, user.userId);
  }

  @Get('lead/:leadId')
  @UseGuards(JwtAuthGuard, RoleGuard)
   @Roles('admin','bd')
  @ApiOperation({ summary: 'Get call logs by leadId' })
  getByLead(@Param('leadId') leadId: number) {
    return this.logic.getByLead(Number(leadId));
  }

  @Get()
   @UseGuards(JwtAuthGuard, RoleGuard)
   @Roles('bd')
  @ApiOperation({ summary: 'Get call logs by userId' })
  getByUser(@Param('userId') userId: string, @Req() req: any) {
    return this.logic.getByUser(req?.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update call log' })
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCallLogDto>,
    @CurrentUser() user: any,
  ) {
    return this.logic.update(id, dto, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete call log' })
  delete(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.logic.delete(id, user.userId);
  }
}
