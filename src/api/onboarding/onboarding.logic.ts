import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { OnboardingStatus, User, UserStatus } from 'src/schema/user.schema';
import { Profile } from 'src/schema/profile.schema';
import { EmailService } from 'src/common/services/email.service';
import { FileUploaderService } from '../file-uploader/file-uploader.service';
import { UserLogic } from '../user/user.logic';
import {
  ApproveOnboardingDto,
  GenerateOnboardingLinkDto,
  SubmitOnboardingDto,
} from 'src/dto/onboarding/onboarding.dto';

/** Profile fields an employee is allowed to fill from the public link. */
const EMPLOYEE_EDITABLE_FIELDS = [
  'profileImage',
  'education',
  'personalDetails',
  'address',
  'bankDetails',
  'educationalDetails',
  'documents',
] as const;

const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Injectable()
export class OnboardingLogic {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
    private readonly userLogic: UserLogic,
    private readonly emailService: EmailService,
    private readonly fileUploader: FileUploaderService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  private actorId(actor: any): Types.ObjectId | undefined {
    const id = actor?._id || actor?.userId;
    return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined;
  }

  private buildLink(token: string, req?: any, baseUrl?: string) {
    const fromReq = req?.headers?.origin as string | undefined;
    const candidate =
      process.env.CRM_FRONTEND_URL || fromReq || baseUrl || '';
    const base = /^https?:\/\//i.test(candidate)
      ? candidate.replace(/\/+$/, '')
      : '';
    return `${base}/onboarding/${token}`;
  }

  private async findUserOrThrow(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(userId).populate('role', 'name');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async findByTokenOrThrow(token: string) {
    if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) {
      throw new NotFoundException('Invalid onboarding link');
    }
    const user = await this.userModel
      .findOne({ 'onboarding.token': token })
      .populate('role', 'name');
    if (!user) throw new NotFoundException('Invalid onboarding link');
    return user;
  }

  private assertLinkActive(user: User) {
    if (!user.onboarding?.linkActive) {
      throw new ForbiddenException(
        'This onboarding link is not active. Please contact your manager to re-open it.',
      );
    }
  }

  private pickEmployeeFields(dto: SubmitOnboardingDto) {
    const payload: any = {};
    for (const key of EMPLOYEE_EDITABLE_FIELDS) {
      if ((dto as any)[key] !== undefined) payload[key] = (dto as any)[key];
    }
    if (payload.personalDetails?.panNumber) {
      payload.personalDetails.panNumber = String(payload.personalDetails.panNumber).toUpperCase();
    }
    if (payload.bankDetails?.ifscCode) {
      payload.bankDetails.ifscCode = String(payload.bankDetails.ifscCode).toUpperCase();
    }
    return payload;
  }

  private serializeOnboarding(user: any, req?: any) {
    const o = user.onboarding || {};
    return {
      status: o.status || OnboardingStatus.NOT_SHARED,
      linkActive: !!o.linkActive,
      sharedAt: o.sharedAt,
      submittedAt: o.submittedAt,
      approvedAt: o.approvedAt,
      submissionCount: o.submissionCount || 0,
      token: o.token,
      link: o.token ? this.buildLink(o.token, req) : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* staff (admin / bd)                                                  */
  /* ------------------------------------------------------------------ */

  /** Create the link, or re-activate the existing one (same URL). */
  async generateLink(
    actor: any,
    userId: string,
    dto: GenerateOnboardingLinkDto,
    req?: any,
  ) {
    await this.userLogic.assertCanManageUser(actor, userId);
    const user = await this.findUserOrThrow(userId);

    const token =
      !dto.regenerate && user.onboarding?.token
        ? user.onboarding.token
        : randomBytes(24).toString('hex');

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $set: {
          'onboarding.token': token,
          'onboarding.linkActive': true,
          'onboarding.status': OnboardingStatus.PENDING,
          'onboarding.sharedAt': new Date(),
          'onboarding.sharedBy': this.actorId(actor),
        },
      },
      { new: true },
    );

    const link = this.buildLink(token, req, dto.baseUrl);

    let emailSent = false;
    if (dto.sendEmail) {
      emailSent = await this.emailService.onboardingLink(user.email, user.name, link);
    }

    return {
      message: 'Onboarding link is active',
      link,
      emailSent,
      onboarding: this.serializeOnboarding(updated, req),
    };
  }

  async revokeLink(actor: any, userId: string, req?: any) {
    await this.userLogic.assertCanManageUser(actor, userId);
    await this.findUserOrThrow(userId);
    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { 'onboarding.linkActive': false } },
      { new: true },
    );
    return {
      message: 'Onboarding link deactivated',
      onboarding: this.serializeOnboarding(updated, req),
    };
  }

  async getForStaff(actor: any, userId: string, req?: any) {
    await this.userLogic.assertCanManageUser(actor, userId);
    const user = await this.userModel
      .findById(userId)
      .select('-password -otp -otpExpiry')
      .populate('role', 'name')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .populate('departmentId', 'name')
      .populate('reportingSeniorId', 'name')
      .populate('poolIds', 'name')
      .lean();

    return {
      user: { ...user, onboarding: undefined },
      profile,
      onboarding: this.serializeOnboarding(user, req),
    };
  }

  /** Review → optionally edit → approve. Closes the link. */
  async approve(actor: any, userId: string, dto: ApproveOnboardingDto, req?: any) {
    await this.userLogic.assertCanManageUser(actor, userId);
    const user = await this.findUserOrThrow(userId);

    if (user.onboarding?.status !== OnboardingStatus.SUBMITTED) {
      throw new BadRequestException(
        'Employee has not submitted onboarding details yet',
      );
    }

    const { activateUser, ...edits } = dto;
    const hasEdits = Object.values(edits).some((v) => v !== undefined);
    if (hasEdits) {
      await this.userLogic.updateUserAndProfile(userId, edits as any, actor);
    }

    const set: any = {
      'onboarding.status': OnboardingStatus.APPROVED,
      'onboarding.linkActive': false,
      'onboarding.approvedAt': new Date(),
      'onboarding.approvedBy': this.actorId(actor),
    };
    if (activateUser) set.status = UserStatus.ACTIVE;

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: set },
      { new: true },
    );

    return {
      message: activateUser
        ? 'Onboarding approved and user activated'
        : 'Onboarding approved',
      onboarding: this.serializeOnboarding(updated, req),
      status: updated?.status,
    };
  }

  /* ------------------------------------------------------------------ */
  /* public (employee, via token)                                        */
  /* ------------------------------------------------------------------ */

  async getByToken(token: string) {
    const user: any = await this.findByTokenOrThrow(token);
    const base = {
      linkActive: !!user.onboarding?.linkActive,
      status: user.onboarding?.status,
      submittedAt: user.onboarding?.submittedAt,
      user: { name: user.name },
    };

    // Don't expose any details once the link is closed.
    if (!base.linkActive) return base;

    const profile: any = await this.profileModel
      .findOne({ userId: user._id })
      .populate('departmentId', 'name')
      .populate('reportingSeniorId', 'name')
      .lean();

    const editable: any = {};
    for (const key of EMPLOYEE_EDITABLE_FIELDS) editable[key] = profile?.[key];

    return {
      ...base,
      user: {
        name: user.name,
        email: user.email,
        number: user.number,
        employeeId: user.employeeId,
        role: user.role?.name,
        department: profile?.departmentId?.name,
        reportingSenior: profile?.reportingSeniorId?.name,
        joinedAt: user.createdAt,
      },
      profile: editable,
    };
  }

  async submit(token: string, dto: SubmitOnboardingDto) {
    const user = await this.findByTokenOrThrow(token);
    this.assertLinkActive(user);

    const payload = this.pickEmployeeFields(dto);

    await this.profileModel.findOneAndUpdate(
      { userId: user._id },
      { $set: payload, $setOnInsert: { userId: user._id } },
      { upsert: true, new: true },
    );

    // Atomic close: only succeeds if the link is still active (prevents double submit).
    const closed = await this.userModel.findOneAndUpdate(
      { _id: user._id, 'onboarding.linkActive': true },
      {
        $set: {
          'onboarding.linkActive': false,
          'onboarding.status': OnboardingStatus.SUBMITTED,
          'onboarding.submittedAt': new Date(),
        },
        $inc: { 'onboarding.submissionCount': 1 },
      },
      { new: true },
    );
    if (!closed) {
      throw new ForbiddenException('This onboarding link is no longer active');
    }

    return {
      message:
        'Your details have been submitted. Your manager will review and activate your profile.',
    };
  }

  async upload(token: string, file?: Express.Multer.File) {
    const user = await this.findByTokenOrThrow(token);
    this.assertLinkActive(user);

    if (!file) throw new BadRequestException('File is required');
    if (!ALLOWED_UPLOAD_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, WEBP or PDF files are allowed');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('File must be 5 MB or smaller');
    }

    const uploaded = await this.fileUploader.uploadProfileImage(file);
    return { success: true, message: 'File uploaded', data: uploaded };
  }
}
