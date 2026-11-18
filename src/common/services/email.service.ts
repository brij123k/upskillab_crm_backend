import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT),
      secure: true,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  async sendMail(
    to: string,
    subject: string,
    html: string,
    options: {
      from?: string;
      replyTo?: string;
      attachments?: { filename: string; content: Buffer; contentType?: string }[];
    } = {},
  ): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: options.from || process.env.MAIL_FROM,
        replyTo: options.replyTo,
        attachments: options.attachments,
        to,
        subject,
        html,
      });

      this.logger.log(`Email sent to ${to}`);
      return true;
    } catch (error) {
      this.logger.error('Email sending failed', error);
      return false;
    }
  }

  // 🔥 PREMADE OTP EMAIL
  async sendOtpEmail(email: string, otp: string) {
    const html = `
      <h2>CRM OTP Verification</h2>
      <p>Your OTP is:</p>
      <h1>${otp}</h1>
      <p>This OTP is valid for 5 minutes.</p>
    `;

    return this.sendMail(email, 'OTP Verification', html);
  }

  async registerDetail(email:string,password:string){
    const html = `
    <h2>Complayee Employee Registration</h2>
    <h3>Email : </h3><p>${email}</p>
    <h3>Password : </h3><p>${password}</p>
    please wait for approvel
    `
    return this.sendMail(email, 'User Registered', html);
  }

  async dashboardUpdate(email:string, employeeId:number){
    const html = `
    <h2>CRM Update</h2>
    <p>Your CRM Dashboard Now activated now u can visit you dashboard</p>
    <p>Here is your employee Id : ${employeeId}</p>
    `

    return this.sendMail(email, 'CRM UPDATE', html);
  }

  async onboardingLink(email: string, name: string, link: string) {
    const hrEmail = process.env.ONBOARDING_HR_EMAIL || 'hr@upskillab.com';
    // Shown to the employee as the sender. The SMTP account must be allowed
    // to send as this address; override with ONBOARDING_MAIL_FROM if not.
    const from = process.env.ONBOARDING_MAIL_FROM || `Upskillab HR <${hrEmail}>`;
    const safeName = String(name || '').replace(/[<>&"]/g, '');
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#f97316;padding:20px 24px;border-radius:12px 12px 0 0">
        <h2 style="margin:0;color:#ffffff;font-size:20px">Welcome to Upskillab</h2>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 12px 12px">
        <p>Dear ${safeName},</p>
        <p>We are delighted to have you on board. To complete your joining formalities, please fill in your onboarding form using the secure link below.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#f97316;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Start onboarding</a>
        </p>
        <p style="font-size:13px;color:#475569">Please keep these ready: Aadhaar card (front &amp; back), PAN card, bank passbook or cancelled cheque, and your 10th, 12th and Bachelor's marksheets.</p>
        <p style="font-size:13px;color:#475569">The form can be submitted once. If you need to change anything afterwards, write to us at <a href="mailto:${hrEmail}">${hrEmail}</a>.</p>
        <p style="font-size:12px;color:#94a3b8;word-break:break-all">If the button does not work, copy this link: ${link}</p>
        <p>Regards,<br/>HR Team, Upskillab</p>
      </div>
    </div>`;
    return this.sendMail(email, 'Welcome to Upskillab – complete your onboarding', html, {
      from,
      replyTo: hrEmail,
    });
  }

  async sendReminder(email: string, reminderText: string) {
    const formattedText = reminderText.replace(/\n/g, '<br>');
    const html = `
      <h2>Loan EMI Reminder</h2>
      <p>${formattedText}</p>
    `;
    return this.sendMail(email, 'Loan EMI Reminder', html);
  }

}
