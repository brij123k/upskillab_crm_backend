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
  ): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM,
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
    const safeName = String(name || '').replace(/[<>&"]/g, '');
    const html = `
    <h2>Complete your employee profile</h2>
    <p>Hi ${safeName},</p>
    <p>Please open the link below and fill in your personal, address, bank, education and document details.</p>
    <p><a href="${link}">${link}</a></p>
    <p>The link can be submitted once. If you need to change anything afterwards, contact your manager to re-open it.</p>
    `;
    return this.sendMail(email, 'Complete your onboarding profile', html);
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
