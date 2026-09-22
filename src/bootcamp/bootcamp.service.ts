import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { LeadData } from "src/api/lead_management/lead/lead.data";
import { LeadLogic } from "src/api/lead_management/lead/lead.logic";
import { PaymentService } from "src/api/order_management/payment/payment.service";
import { WhatsappService } from "src/api/whatsapp/whatsapp.service";
import { EmailService } from "src/common/services/email.service";
import { CreateBootcampRegistrationDto } from "src/dto/BootcampRegistration.dto";
import { LeadStage } from "src/schema/lead_management/lead-stage.schema";
import { Lead } from "src/schema/lead_management/lead.schema";
LeadData
@Injectable()
export class BootCampService {
    constructor(
      private readonly leadLogic: LeadLogic,
      private readonly leadData: LeadData,
      private readonly emailService: EmailService,
      private readonly paymentService: PaymentService,
      private readonly whatsappService: WhatsappService,

      @InjectModel(LeadStage.name)
      private readonly leadStageModel: Model<LeadStage>,

      @InjectModel(Lead.name)
      private readonly leadModel: Model<Lead>,
    ) {}
private formatPhoneNumber(phone: string): string {
  if (!phone) {
    return '';
  }

  // Remove spaces, hyphens, brackets, etc.
  let cleaned = phone.replace(/\D/g, '');

  // Already has the Indian country code
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  // Local Indian number
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }

  // Fallback
  return phone.startsWith('+') ? phone : `+${cleaned}`;
}
private async sendRegistrationConfirmation(
  lead: any,
  amount: number,
) {
  const results = {
    whatsapp: false,
    email: false,
  };

  // ============================================================
  // WHATSAPP
  // ============================================================
  if (lead?.phone) {
    try {
      const whatsappPayload = {
        from: "+919319427070",
        campaignName: 'Bootcamp Registration Confirmation',
        to: this.formatPhoneNumber(lead.phone),
        templateName: 'bootcamp_whatsapp_confirmation',
        type: 'template',
        language: {
          code: 'en',
        },

        components: {
          body: {
            params: [
              lead.name || 'Participant',
            ],
          },
        },
      };

      await this.whatsappService.sendTemplate(
        whatsappPayload,
      );

      results.whatsapp = true;

      console.log(
        `Bootcamp WhatsApp confirmation sent to ${lead.phone}`,
      );
    } catch (error: any) {
      console.error(
        'Bootcamp WhatsApp notification failed:',
        error?.response?.data || error?.message || error,
      );
    }
  }

  // ============================================================
  // EMAIL
  // ============================================================
  if (lead?.email) {
    try {
      const subject =
        'Registration Confirmed – The Generation Nobody Prepared Us For';

const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Webinar Registration Confirmed</title>
  </head>

  <body style="
    margin: 0;
    padding: 0;
    background-color: #f5f7fb;
    font-family: Arial, Helvetica, sans-serif;
    color: #222222;
  ">

    <div style="
      max-width: 650px;
      margin: 30px auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(0,0,0,0.08);
    ">

      <!-- Header -->
      <div style="
        padding: 30px 25px;
        text-align: center;
        background-color: #f8f9ff;
      ">
        <h1 style="
          margin: 0;
          color: #222222;
          font-size: 26px;
        ">
          Registration Confirmed! 🎉
        </h1>
      </div>

      <!-- Content -->
      <div style="padding: 30px;">

        <p style="font-size: 16px; margin-top: 0;">
          Dear <strong>${lead.name || 'Participant'}</strong>,
        </p>

        <p style="
          font-size: 16px;
          line-height: 1.6;
        ">
          Thank you for registering for our upcoming webinar:
        </p>

        <!-- Webinar Details -->
        <div style="
          margin: 25px 0;
          padding: 22px;
          background-color: #f8f9ff;
          border-radius: 10px;
          border: 1px solid #e8eaf3;
        ">

          <h2 style="
            margin: 0 0 20px 0;
            font-size: 21px;
            line-height: 1.4;
            color: #222222;
          ">
            The Generation Nobody Prepared Us For:
            Understanding Gen Z & Gen Alpha
          </h2>

          <p style="font-size: 16px; margin: 10px 0;">
            📅 <strong>Date:</strong> 10 October 2026
          </p>

          <p style="font-size: 16px; margin: 10px 0;">
            🕗 <strong>Time:</strong> 8:00 PM – 9:00 PM IST
          </p>

          <p style="font-size: 16px; margin: 10px 0;">
            🎙️ <strong>Facilitator:</strong> Reshmi Sensarma Basu
          </p>

          <p style="
            font-size: 14px;
            line-height: 1.5;
            margin: 5px 0 0 0;
            color: #555555;
          ">
            MS, MPhil, PGDPC (RCI-Licensed) | 25+ Years of Experience
          </p>

        </div>

        <!-- Join Webinar -->
        <div style="
          margin: 25px 0;
          padding: 22px;
          text-align: center;
          background-color: #f1f8f4;
          border-radius: 10px;
        ">

          <h3 style="
            margin: 0 0 12px 0;
            font-size: 20px;
            color: #222222;
          ">
            Join the Webinar
          </h3>

          <p style="
            margin: 0 0 18px 0;
            font-size: 15px;
            color: #555555;
          ">
            Please join 5–10 minutes before the scheduled start time.
          </p>

          <a
            href="https://meet.google.com/spn-avdm-xog"
            target="_blank"
            style="
              display: inline-block;
              padding: 13px 25px;
              background-color: #1a73e8;
              color: #ffffff;
              text-decoration: none;
              border-radius: 6px;
              font-size: 16px;
              font-weight: bold;
            "
          >
            Join Webinar
          </a>

          <p style="
            margin: 15px 0 0 0;
            font-size: 13px;
            color: #666666;
            word-break: break-all;
          ">
            Webinar Link:<br />
            https://meet.google.com/spn-avdm-xog
          </p>

        </div>

        <!-- WhatsApp -->
        <div style="
          margin: 25px 0;
          padding: 20px;
          background-color: #f8f9ff;
          border-radius: 10px;
        ">

          <h3 style="
            margin: 0 0 10px 0;
            font-size: 18px;
          ">
            Stay Connected 📢
          </h3>

          <p style="
            margin: 0 0 15px 0;
            font-size: 15px;
            line-height: 1.6;
          ">
            Join our official WhatsApp Channel to receive webinar
            reminders, important updates and announcements.
          </p>

          <a
            href="https://whatsapp.com/channel/0029Vb6RBx0GufJ0RYlVaj2i"
            target="_blank"
            style="
              color: #128c7e;
              font-size: 15px;
              font-weight: bold;
              text-decoration: none;
            "
          >
            📢 Join WhatsApp Channel
          </a>

        </div>

        <p style="
          font-size: 15px;
          line-height: 1.6;
        ">
          We recommend joining the webinar 5–10 minutes before the
          scheduled start time.
        </p>

        <p style="
          font-size: 16px;
          line-height: 1.6;
        ">
          We look forward to having you with us for this insightful session.
        </p>

        <p style="
          margin-top: 30px;
          font-size: 16px;
          line-height: 1.6;
        ">
          Warm regards,<br />
          <strong>Team Upskillab</strong>
        </p>

      </div>

    </div>

  </body>
  </html>
`;

      const emailSent = await this.emailService.sendMail(
        lead.email,
        subject,
        html,
      );

      results.email = emailSent;

      console.log(
        `Bootcamp email confirmation sent to ${lead.email}`,
      );
    } catch (error: any) {
      console.error(
        'Bootcamp email notification failed:',
        error?.message || error,
      );
    }
  }

  return results;
}
async register(dto: CreateBootcampRegistrationDto) {
  const lead = await this.leadLogic.createBootcampLead(dto);

  if (!lead?.success || !lead?.data) {
    return {
      success: false,
      message: lead?.message || 'Bootcamp registration failed',
    };
  }

  const payment =
    await this.paymentService.createBootcampPaymentLink({
      leadId: lead.data.leadId,
      amount: 10,
    });

  return {
    success: true,
    message: 'Bootcamp registration successful',
    data: {
      lead: lead.data,
      paymentLink: payment.paymentLink,
      linkId: payment.linkId,
    },
  };
}

async handlePaymentWebhook(body: any) {
    try {
      console.log(
        '========== BOOTCAMP CASHFREE WEBHOOK =========='
      );

      console.log(
        'Webhook Type:',
        body?.type,
      );

      // -------------------------------------------------------
      // PAYMENT LINK EVENT
      // -------------------------------------------------------

      if (body?.type === 'PAYMENT_LINK_EVENT') {
        return this.handlePaymentLinkEvent(body);
      }

      // -------------------------------------------------------
      // PAYMENT SUCCESS EVENT
      // -------------------------------------------------------

      // if (body?.type === 'PAYMENT_SUCCESS_WEBHOOK') {
      //   return this.handlePaymentSuccessEvent(body);
      // }

      // -------------------------------------------------------
      // UNKNOWN EVENT
      // -------------------------------------------------------

      console.log(
        'Ignored Cashfree event:',
        body?.type,
      );

      return {
        success: true,
        message: 'Event ignored',
      };

    } catch (error: any) {
      console.error(
        'Bootcamp Webhook Error:',
        error?.response?.data ||
        error?.message ||
        error,
      );

      return {
        success: false,
        message: 'Webhook processing failed',
      };
    }
  }
  private async handlePaymentLinkEvent(
    body: any,
  ) {
    const data = body?.data;

    if (!data) {
      return {
        success: false,
        message: 'Webhook data not found',
      };
    }

    const leadId =
      data?.link_notes?.leadId;

    if (!leadId) {
      return {
        success: false,
        message:
          'Bootcamp leadId not found in link notes',
      };
    }

    const lead = await this.leadData.getByLeadId(Number(leadId));
    const leadStage = await this.leadStageModel.findOne({ name: "Bootcamp Registered" }).exec();
    if (!lead) {
      return {
        success: false,
        message: 'Bootcamp lead not found',
      };
    }
    console.log(lead,"lead data",leadStage,"lead stage");
    await this.leadModel.findByIdAndUpdate(lead._id, { stageId: new Types.ObjectId(leadStage?._id) }).exec();
    // IMPORTANT:
    // We don't mark registration completed here.
    // PAYMENT_SUCCESS_WEBHOOK handles successful payment.

    console.log(
      'Payment link event received:',
      {
        leadId,
        linkId: data?.link_id,
        status: data?.link_status,
        amountPaid: data?.link_amount_paid,
      },
    );

      const notificationResult =
    await this.sendRegistrationConfirmation(
      lead,
      data?.link_amount_paid
    );

    return {
      success: true,
      message: 'Payment link event received',
      notifications: notificationResult,
    };
  }

  // private async handlePaymentSuccessEvent(
  //   body: any,
  // ) {
  //   const data = body?.data;

  //   if (!data) {
  //     return {
  //       success: false,
  //       message: 'Payment data not found',
  //     };
  //   }

  //   const order = data?.order;
  //   const payment = data?.payment;

  //   // -------------------------------------------------------
  //   // Check payment status
  //   // -------------------------------------------------------

  //   if (
  //     payment?.payment_status !== 'SUCCESS'
  //   ) {
  //     return {
  //       success: true,
  //       message: 'Payment is not successful',
  //     };
  //   }

  //   // -------------------------------------------------------
  //   // Check Bootcamp payment
  //   // -------------------------------------------------------

  //   const orderTags =
  //     order?.order_tags;

  //   if (orderTags?.type !== 'BOOTCAMP') {
  //     console.log(
  //       'Ignoring non-bootcamp payment',
  //     );

  //     return {
  //       success: true,
  //       message: 'Not a bootcamp payment',
  //     };
  //   }

  //   // -------------------------------------------------------
  //   // Get Lead ID
  //   // -------------------------------------------------------

  //   const leadId =
  //     orderTags?.leadId;

  //   if (!leadId) {
  //     return {
  //       success: false,
  //       message:
  //         'Bootcamp leadId not found',
  //     };
  //   }

  //   // -------------------------------------------------------
  //   // Find Lead
  //   // -------------------------------------------------------

  //   const lead = await this.leadData.getByLeadId(Number(leadId));

  //   if (!lead) {
  //     return {
  //       success: false,
  //       message: 'Bootcamp lead not found',
  //     };
  //   }

  //   // -------------------------------------------------------
  //   // Prevent duplicate webhook processing
  //   // -------------------------------------------------------

  //   /*
  //    * If you have bootcampPaymentModel available
  //    * in this service, check the transaction before
  //    * creating another payment record.
  //    */

  //   console.log(
  //     '========== BOOTCAMP PAYMENT SUCCESS =========='
  //   );

  //   console.log({
  //     leadId: lead.leadId,
  //     orderId: order?.order_id,
  //     paymentId: payment?.cf_payment_id,
  //     amount: payment?.payment_amount,
  //     status: payment?.payment_status,
  //   });

  //   return {
  //     success: true,
  //     message:
  //       'Bootcamp payment successfully processed',
  //   };
  // }
  
async handlePaymentSuccessEvent(body: any) {
  const payment = body?.data?.payment;
  const order = body?.data?.order;

  // ============================================================
  // 1. CHECK PAYMENT STATUS
  // ============================================================
  if (payment?.payment_status !== 'SUCCESS') {
    return {
      success: true,
      message: 'Payment is not successful',
    };
  }
  const orderTags = order?.order_tags;

  if (orderTags?.type !== 'BOOTCAMP') {
    return {
      success: true,
      message: 'Not a bootcamp payment',
    };
  }

  const leadId = Number(orderTags?.leadId);

  if (!leadId) {
    return {
      success: false,
      message: 'Bootcamp leadId not found in payment',
    };
  }
  const lead = await this.leadData.getByLeadId(leadId);

  if (!lead) {
    return {
      success: false,
      message: 'Bootcamp lead not found',
    };
  }
  const amount = Number(payment?.payment_amount);
  const notificationResult =
    await this.sendRegistrationConfirmation(
      lead,
      amount,
    );

  // ============================================================
  // 9. RESPONSE
  // ============================================================
  return {
    success: true,
    message: 'Bootcamp payment processed successfully',
    data: {
      leadId,
      paymentId: payment?.cf_payment_id,
      orderId: order?.order_id,
      amount,

      notifications: notificationResult,
    },
  };
}
}