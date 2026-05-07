import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import { InteractionLogLogic } from "./interaction-log.logic"
import { JwtAuthGuard } from "src/common/guards/jwt-auth.guard"
import { RoleGuard } from "src/common/guards/role.guard"
import { Roles } from "src/common/decorators/roles.decorator"
import { CreateInteractionLogDto } from "src/dto/create-interaction-log.dto"
import { CurrentUser } from "src/common/decorators/current-user.decorator"
import { PermissionGuard } from "src/common/guards/permission.guard"
import { RequirePermission } from "src/common/decorators/permission.decorator"
import { PERMISSIONS } from "src/common/constants/permissions.constant"

@ApiTags('Interaction Logs')
@Controller('interaction-logs')
export class InteractionLogController {

  constructor(
    private readonly logic: InteractionLogLogic
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin','bd')
  create(
    @Body() dto: CreateInteractionLogDto,
    @CurrentUser() user:any
  ){
    return this.logic.create(dto,user.userId)
  }

  @Get('lead/:leadId')
  getByLead(@Param('leadId') leadId:number){
    return this.logic.getByLead(Number(leadId))
  }

  @Patch(':id')
  update(
    @Param('id') id:string,
    @Body() dto:any,
    @CurrentUser() user:any
  ){
    return this.logic.update(id,dto,user.userId)
  }

  @Get('users')
@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('bd','Admin')
@ApiOperation({ summary: 'Get interaction logs with filters' })
@RequirePermission(
  PERMISSIONS.Calls.MODULE,
  PERMISSIONS.Calls.ACTIONS.READ,
)
getByUsers(
  @Query() query: any,
  @Req() req: any,
) {
  return this.logic.getByUsers(query, req.user);
}
}