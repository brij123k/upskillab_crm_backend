import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { LeadLogic } from './lead.logic';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateLeadDto, UpdateLeadDto, ChangeLeadStatusDto } from 'src/dto/lead-management/lead.dto';
import { AssignLeadDto } from 'src/dto/lead-management/assign-lead.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ReassignLeadDto } from 'src/dto/lead-management/reassign-lead.dto';
import { LeadFilterDto } from 'src/dto/lead-management/lead-filter.dto';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';

@ApiTags('Leads')
@Controller('leads')
export class LeadController {
    constructor(private readonly logic: LeadLogic) { }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @Post()
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.CREATE,
    )
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin')
    @ApiOperation({ summary: 'Create lead' })
    create(@Body() dto: CreateLeadDto, @Req() req: any) {
        return this.logic.create(dto, req?.user.userId);
    }



    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
    @Get()
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin')
    @ApiOperation({ summary: 'Get all leads with filters & pagination' })
    findAll(@Query() query: LeadFilterDto) {
        return this.logic.findAll(query);
    }


    
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
    @Get(':id')
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin')
    @ApiOperation({ summary: 'Get lead by ID' })
    findOne(@Param('id') id: string) {
        return this.logic.findOne(id);
    }

   
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.UPDATE,
    )
    @Patch(':id')
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin')
    @ApiOperation({ summary: 'Update lead' })
    update(
        @Param('id') id: string,
        @Body() dto: UpdateLeadDto,
        @Req() req: any
    ) {
        return this.logic.update(id, dto, req?.user.userId);
    }

    // @Delete(':id')
    // @UseGuards(JwtAuthGuard, RoleGuard)
    // @Roles('admin')
    // @ApiOperation({ summary: 'Delete lead' })
    // remove(@Param('id') id: string) {
    //     return this.logic.delete(id);
    // }


    
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.STATUS_CHANGE,
    )
    @Patch(':id/status')
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin')
    @ApiOperation({ summary: 'Change lead status' })
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeLeadStatusDto,
        @Req() req: any
    ) {
        return this.logic.changeStatus(id, dto.status, req?.user.userId);
    }

    
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.ASSIGN,
    )
    @Patch('lead/assign')
    @ApiOperation({
        summary:
            'Assign leads by leadIds, departmentId, or both',
    })
    assignLeads(
        @Body() dto: AssignLeadDto,
        @CurrentUser() user: any,
    ) {
        return this.logic.assignLeads(dto, user.userId);
    }


    
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.ASSIGN,
    )
    @Patch('reassign')
    @ApiOperation({
        summary: 'Pull back and reassign leads',
    })
    reassignLeads(
        @Body() dto: ReassignLeadDto,
        @CurrentUser() user: any,
    ) {
        return this.logic.pullBackAndReassign(
            dto.leadIds,
            dto.newAssignedTo,
            user.userId,
        );
    }


    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('admin', 'bd')
    @Get('user/:userId')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
    @ApiOperation({ summary: 'Get all leads assigned to a user' })
    getByUser(@Param('userId') userId: string) {
        return this.logic.getLeadsByUser(userId);
    }

    // @UseGuards(JwtAuthGuard)
    // @Get('department/:departmentId')
    // @ApiOperation({ summary: 'Get all leads by department' })
    // getByDepartment(@Param('departmentId') departmentId: string) {
    //     return this.logic.getLeadsByDepartment(departmentId);
    // }


}
