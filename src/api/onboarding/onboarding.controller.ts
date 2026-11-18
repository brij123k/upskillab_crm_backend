import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import {
  ApproveOnboardingDto,
  GenerateOnboardingLinkDto,
  SubmitOnboardingDto,
} from 'src/dto/onboarding/onboarding.dto';
import { OnboardingLogic } from './onboarding.logic';

/**
 * Staff endpoints for an employee's onboarding. Only Admin (wildcard
 * permissions) and roles granted `user:onboarding` (e.g. HR) can use them.
 */
@ApiTags('Employee Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd', 'hr')
@Controller('users')
export class OnboardingStaffController {
  constructor(private readonly logic: OnboardingLogic) {}

  @Get(':id/onboarding')
  @ApiOperation({ summary: 'Get onboarding status, link and submitted details' })
  get(@Param('id') userId: string, @Req() req: any) {
    return this.logic.getForStaff(req.user, userId, req);
  }

  @Post(':id/onboarding/link')
  @ApiOperation({
    summary:
      'Generate the onboarding link, or re-activate the existing one so the employee can edit again',
  })
  generate(
    @Param('id') userId: string,
    @Body() dto: GenerateOnboardingLinkDto,
    @Req() req: any,
  ) {
    return this.logic.generateLink(req.user, userId, dto, req);
  }

  @Patch(':id/onboarding/revoke')
  @ApiOperation({ summary: 'Deactivate the onboarding link' })
  revoke(@Param('id') userId: string, @Req() req: any) {
    return this.logic.revokeLink(req.user, userId, req);
  }

  @Patch(':id/onboarding/approve')
  @ApiOperation({
    summary: 'Approve submitted onboarding details (optionally with edits) and activate',
  })
  approve(
    @Param('id') userId: string,
    @Body() dto: ApproveOnboardingDto,
    @Req() req: any,
  ) {
    return this.logic.approve(req.user, userId, dto, req);
  }
}

/** Public endpoints used by the employee through the shared link. No auth. */
@ApiTags('Employee Onboarding (Public)')
@Controller('onboarding')
export class OnboardingPublicController {
  constructor(private readonly logic: OnboardingLogic) {}

  @Get(':token')
  @ApiOperation({ summary: 'Load registered details for the onboarding form' })
  get(@Param('token') token: string) {
    return this.logic.getByToken(token);
  }

  @Post(':token')
  @ApiOperation({ summary: 'Submit onboarding details (closes the link)' })
  submit(@Param('token') token: string, @Body() dto: SubmitOnboardingDto) {
    return this.logic.submit(token, dto);
  }

  @Post(':token/upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a document / photo while the link is active' })
  upload(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.logic.upload(token, file);
  }
}
