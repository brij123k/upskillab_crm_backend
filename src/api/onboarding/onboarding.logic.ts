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
import { PayrollService } from '../payroll/payroll.service';
import {
  ApproveOnboardingDto,
  GenerateOnboardingLinkDto,
  SubmitOnboardingDto,
} from 'src/dto/onboarding/onboarding.dto';

/** Profile fields an employee is allowed to fill from the public link. */
const EMPLOYEE_EDITABLE_FIELDS = [
  'profileImage',
  'personalDetails',
  'address',
  'currentAddress',
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

/** Contact shown to the employee on the onboarding page and in the email. */
export const ONBOARDING_HR_EMAIL = process.env.ONBOARDING_HR_EMAIL || 'hr@upskillab.com';

/** The three qualifications every employee must add (with marksheet). */
const REQUIRED_QUALIFICATIONS: { key: string; label: string; match: RegExp }[] = [
  { key: '10th', label: '10th', match: /^10/ },
  { key: '12th', label: '12th', match: /^12/ },
  { key: "Bachelor's", label: "Bachelor's", match: /^bachelor/i },
];

const filled = (v: any) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined && v !== null;

/** Server-side copy of the public form's required-field rules. */
function validateSubmission(dto: SubmitOnboardingDto): string | null {
  const pd: any = dto.personalDetails || {};
  const personal: [string, string][] = [
    ['dateOfBirth', 'Date of birth'],
    ['gender', 'Gender'],
    ['bloodGroup', 'Blood group'],
    ['emergencyContactName', 'Emergency contact name'],
    ['emergencyContactNumber', 'Emergency contact number'],
    ['emergencyContactRelation', 'Relation with emergency contact'],
    ['aadhaarNumber', 'Aadhaar number'],
    ['panNumber', 'PAN number'],
  ];
  for (const [k, label] of personal) if (!filled(pd[k])) return `${label} is required`;

  const addr = (a: any, label: string) => {
    if (!a || !filled(a.addressLine1) || !filled(a.city) || !filled(a.state) || !filled(a.pincode)) {
      return `${label}: address line 1, city, state and pincode are required`;
    }
    if (!/^\d{6}$/.test(String(a.pincode))) return `${label}: pincode must be 6 digits`;
    return null;
  };
  const addrErr = addr(dto.address, 'Permanent address') || addr(dto.currentAddress, 'Current address');
  if (addrErr) return addrErr;

  const docs: any = dto.documents || {};
  if (!filled(docs.aadhaarFront) || !filled(docs.aadhaarBack)) return 'Aadhaar front and back are required';
  if (!filled(docs.panCard)) return 'PAN card document is required';

  const b: any = dto.bankDetails || {};
  for (const [k, label] of [
    ['accountHolderName', 'Account holder name'],
    ['bankName', 'Bank name'],
    ['accountNumber', 'Account number'],
    ['ifscCode', 'IFSC code'],
    ['branchName', 'Branch name'],
    ['accountType', 'Account type'],
  ]) if (!filled(b[k])) return `${label} is required`;
  if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(String(b.ifscCode))) return 'IFSC code is invalid';
  if (!filled(docs.passbook)) return 'Bank passbook / cancelled cheque is required';

  const edu: any[] = Array.isArray(dto.educationalDetails) ? dto.educationalDetails : [];
  for (const q of REQUIRED_QUALIFICATIONS) {
    const row = edu.find((e) => q.match.test(String(e?.qualification || '')));
    if (!row) return `${q.label} education details are required`;
    if (!filled(row.instituteName) || !filled(row.boardOrUniversity) || !row.passingYear || !filled(row.percentageOrCGPA)) {
      return `Please complete all ${q.label} education fields`;
    }
    if (!filled(row.certificate)) return `${q.label} marksheet is required`;
  }
  return null;
}

@Injectable()
export class OnboardingLogic {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
    private readonly userLogic: UserLogic,
    private readonly emailService: EmailService,
    private readonly fileUploader: FileUploaderService,
    private readonly payroll: PayrollService,
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

  /** Admin, or a role granted `user:onboarding` (e.g. HR). */
  private assertOnboardingAccess(actor: any) {
    if (!this.userLogic.canManageOnboarding(actor)) {
      throw new ForbiddenException(
        'You do not have permission to manage employee onboarding',
      );
    }
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
        'This onboarding link is not active. Please contact HR to re-open it.',
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
    this.assertOnboardingAccess(actor);
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
    this.assertOnboardingAccess(actor);
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
    this.assertOnboardingAccess(actor);
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
    this.assertOnboardingAccess(actor);
    await this.userLogic.assertCanManageUser(actor, userId);
    const user = await this.findUserOrThrow(userId);

    if (user.onboarding?.status !== OnboardingStatus.SUBMITTED) {
      throw new BadRequestException(
        'Employee has not submitted onboarding details yet',
      );
    }

    const {
      activateUser,
      annualCtc,
      salaryEffectiveFrom,
      ptState,
      pfApplicable,
      esiApplicable,
      tdsMonthly,
      insuranceAnnual,
      salaryTemplateId,
      customComponents,
      ...edits
    } = dto as any;

    // Employment details are set by staff at approval time.
    const existing: any = await this.profileModel.findOne({ userId: user._id }).lean();
    const departmentId = edits.departmentId || existing?.departmentId;
    const reportingSeniorId = edits.reportingSeniorId || existing?.reportingSeniorId;
    if (!departmentId) throw new BadRequestException('Please choose a department before approving');
    if (!reportingSeniorId) throw new BadRequestException('Please choose a reporting senior before approving');

    // CTC: annual CTC → salary structure (breakup by the payroll rules).
    // Older clients still send only the monthly `salary`.
    const ctc = Number(annualCtc) > 0 ? Number(annualCtc) : Number(edits.salary ?? existing?.salary) > 0 ? Number(edits.salary ?? existing?.salary) * 12 : 0;
    if (!(ctc > 0)) throw new BadRequestException('Please enter the CTC before approving');
    const salaryInput = {
      annualCtc: ctc,
      ptState: ptState || existing?.currentAddress?.state || existing?.address?.state || undefined,
      pfApplicable,
      esiApplicable,
      tdsMonthly,
      insuranceAnnual,
      templateId: salaryTemplateId || undefined,
      customComponents: Array.isArray(customComponents) && customComponents.length ? customComponents : undefined,
      effectiveFrom: salaryEffectiveFrom,
    };
    const breakup = await this.payroll.preview(salaryInput as any);
    // Profile.salary stays the monthly gross (used by the Salary Sheet report).
    (edits as any).salary = breakup.grossMonthly;

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

    const structure = await this.payroll.applyOnboardingCtc(userId, salaryInput as any, actor);

    return {
      salaryStructureId: structure._id,
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
      hrEmail: ONBOARDING_HR_EMAIL,
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
        onboardingId: user.employeeId,
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

    const invalid = validateSubmission(dto);
    if (invalid) throw new BadRequestException(invalid);

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
        'Your details have been submitted. The HR / administration team will review them and get back to you.',
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
