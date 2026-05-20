import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { SourceCampaignLogic } from './source-campaign.logic';
import { CreateSourceCampaignDto, PublicSourceLeadDto, UpdateSourceCampaignDto } from 'src/dto/source-campaign.dto';

@ApiTags('Source Campaigns')
@Controller('source-campaigns')
export class SourceCampaignController {
  constructor(private readonly logic: SourceCampaignLogic) {}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create source campaign' })
  create(@Body() dto: CreateSourceCampaignDto, @Req() req: any) {
    return this.logic.create(dto, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List source campaigns' })
  findAll() {
    return this.logic.findAll();
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get source campaign by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update source campaign' })
  update(@Param('id') id: string, @Body() dto: UpdateSourceCampaignDto, @Req() req: any) {
    return this.logic.update(id, dto, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Patch(':id/toggle')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle source campaign active status' })
  toggle(@Param('id') id: string, @Req() req: any) {
    return this.logic.toggleActive(id, req.user.userId);
  }

  @Get('public/:id')
  @ApiOperation({ summary: 'Get public source campaign info' })
  publicCampaign(@Param('id') id: string) {
    return this.logic.getPublicCampaign(id);
  }

  @Post('public/:id/lead')
  @ApiOperation({ summary: 'Submit a public lead for source campaign' })
  publicLead(@Param('id') id: string, @Body() dto: PublicSourceLeadDto) {
    return this.logic.submitPublicLead(id, dto);
  }

  @Get('report/comparison')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Source campaign comparison report' })
  report(@Query() query: any) {
    return this.logic.comparisonReport(query);
  }
}
