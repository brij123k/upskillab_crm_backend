import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { DepartmentLogic } from './department.logic';
import { CreateDepartmentDto, UpdateDepartmentDto } from 'src/dto/department.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentController {
    constructor(private readonly logic: DepartmentLogic) { }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin')
    @Post()
    @ApiOperation({ summary: 'Create department' })
    create(@Body() dto: CreateDepartmentDto) {
        return this.logic.create(dto);
    }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin')
    @Get()
    @ApiOperation({ summary: 'Get all departments' })
    findAll() {
        return this.logic.findAll();
    }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin')
    @Get(':id')
    @ApiOperation({ summary: 'Get department by ID' })
    findOne(@Param('id') id: string) {
        return this.logic.findOne(id);
    }


    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin')
    @Patch(':id')
    @ApiOperation({ summary: 'Update department' })
    update(
        @Param('id') id: string,
        @Body() dto: UpdateDepartmentDto,
    ) {
        return this.logic.update(id, dto);
    }


    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin')
    @Delete(':id')
    @ApiOperation({ summary: 'Delete department' })
    remove(@Param('id') id: string) {
        return this.logic.delete(id);
    }
}
