import { BadRequestException, Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Lead, LeadStatus } from 'src/schema/lead_management/lead.schema';

import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from 'src/schema/user.schema';

import { BulkWhatsappDto, TemplateButtonsDto, TemplateHeaderDto, VariableDto } from 'src/api/whatsapp/dto/bulk-whatsapp.dto';
import { MessageQueueService } from 'src/common/queue/message-queue.service';
import { WhatsappService } from 'src/api/whatsapp/whatsapp.service';
import { BulkCustomMessageDto } from '../whatsapp/dto/bulk-custom-message.dto';
import { WhatsappCampaign } from './schema/campaign.schema';
import { CampaignRecipientLog } from './schema/campaign-recipient-log.schema';
import { SocketGateway } from '../socket/socket.gateway';
import { GetCampaignsQueryDto } from './dto/get-campaigns-query.dto';
import { GetCampaignLogsQueryDto } from './dto/get-campaign-logs-query.dto';
import { SendTemplateDto } from '../whatsapp/dto/send-template.dto';

@Injectable()
export class CampaignLogic {
  private readonly logger = new Logger(
    CampaignLogic.name,
  );
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,

    @InjectModel(User.name)
    private readonly userModel: Model<User>,

    @InjectModel(WhatsappCampaign.name)
    private readonly campaignModel: Model<WhatsappCampaign>,

    @InjectModel(CampaignRecipientLog.name)
    private readonly campaignRecipientLogModel: Model<CampaignRecipientLog>,

    private readonly whatsappService: WhatsappService,
    private readonly messageQueue: MessageQueueService,
     private readonly socketGateway: SocketGateway,
  ) { }

  private canViewLeadDetails(user?: any) {
    return Boolean(
      user?.isSuperAdmin ||
      user?.roleName?.toString()?.toLowerCase() === 'admin',
    );
  }
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
private formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);

  const period = hours >= 12 ? 'PM' : 'AM';

  const formattedHours = hours % 12 || 12;

  return `${formattedHours
    .toString()
    .padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')} ${period}`;
}

private escapeRegex(value: string): string {
    return value.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
  }

// private buildTemplateParams(
//   data: Record<string, any>,
//   variables: VariableDto[] = [],
// ): string[] {
//   return variables.map((variable) => {
//     if (variable.dynamic === false) {
//       return String(variable.value);
//     }

//     const value = this.getNestedValue(
//       data,
//       variable.value,
//     );

//     if (
//       value === undefined ||
//       value === null
//     ) {
//       return '';
//     }

//     return String(value);
//   });
// }
private buildTemplateParams(
  data: Record<string, any>,
  variables: VariableDto[] = [],
): string[] {
  return variables.map((variable) => {
    // Static value
    if (variable.dynamic === false) {
      return String(variable.value ?? '');
    }

    // Dynamic value from lead
    const value = this.getNestedValue(
      data,
      variable.value,
    );

    // UDO does not want null values
    if (
      value === undefined ||
      value === null
    ) {
      return '';
    }

    return String(value);
  });
}

// private getNestedValue(
//   obj: Record<string, any>,
//   path: string,
// ): any {
//   return path
//     .split('.')
//     .reduce(
//       (current, key) => current?.[key],
//       obj,
//     );
// }

private getNestedValue(
  obj: Record<string, any>,
  path: string,
): any {
  if (!obj || !path) {
    return undefined;
  }

  return path
    .split('.')
    .reduce(
      (current, key) =>
        current?.[key],
      obj,
    );
}

private replaceVariables(
  text: string,
  lead: any,
): string {
  if (!text) {
    return text;
  }

  return text.replace(
    /{{\s*([^}]+)\s*}}/g,
    (_, variable: string) => {
      const value = this.getNestedValue(
        lead,
        variable.trim(),
      );

      if (
        value === undefined ||
        value === null
      ) {
        return '';
      }

      return String(value);
    },
  );
}

private replaceVariablesInObject(
  value: any,
  lead: any,
): any {
  if (typeof value === 'string') {
    return this.replaceVariables(value, lead);
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      this.replaceVariablesInObject(
        item,
        lead,
      ),
    );
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    const result: Record<string, any> = {};

    for (const [key, val] of Object.entries(value)) {
      result[key] =
        this.replaceVariablesInObject(
          val,
          lead,
        );
    }

    return result;
  }

  return value;
}

private async processCustomCampaign(
  campaignId: string,
  dto: BulkCustomMessageDto,
  userId: string,
) {
  console.log("started",campaignId,dto)
  await this.campaignModel.updateOne(
    { _id: campaignId },
    {
      $set: {
        status: 'PROCESSING',
      },
    },
  );

  const logs =
    await this.campaignRecipientLogModel
      .find({
        campaignId: new Types.ObjectId(campaignId),
        status: 'PENDING',
      })
      .lean();
      console.log("logs",logs)
  await this.messageQueue.processInBatches(
    logs,
    5,
    10000,
    async (log) => {
      await this.processCustomRecipient(
        campaignId,
        log,
        dto,
        userId,
      );
    },
  );

  await this.finishCampaign(campaignId);

const finalCampaign =
  await this.campaignModel
    .findById(campaignId)
    .lean();

this.socketGateway.emitToUser(
  userId,
  'campaign-completed',
  {
    campaignId,
    status: finalCampaign?.status,
    totalRecipients:
      finalCampaign?.totalRecipients || 0,
    sentCount:
      finalCampaign?.sentCount || 0,
    failedCount:
      finalCampaign?.failedCount || 0,
    pendingCount:
      finalCampaign?.pendingCount || 0,
    completedAt:
      finalCampaign?.completedAt || null,
  },
);
  
}
private async finishCampaign(
  campaignId: string,
) {
  const stats =
    await this.campaignRecipientLogModel.aggregate([
      {
        $match: {
          campaignId:
            new Types.ObjectId(campaignId),
        },
      },
      {
        $group: {
          _id: '$status',
          count: {
            $sum: 1,
          },
        },
      },
    ]);

  let sent = 0;
  let failed = 0;
  let pending = 0;

  for (const item of stats) {
    if (item._id === 'SENT') {
      sent = item.count;
    }

    if (item._id === 'FAILED') {
      failed = item.count;
    }

    if (item._id === 'PENDING') {
      pending = item.count;
    }
  }

  let status = 'COMPLETED';

  if (failed > 0 && sent > 0) {
    status = 'PARTIAL';
  }

  if (failed > 0 && sent === 0) {
    status = 'FAILED';
  }

  if (pending > 0) {
    status = 'PROCESSING';
  }

  await this.campaignModel.updateOne(
    { _id: campaignId },
    {
      $set: {
        status,
        sentCount: sent,
        failedCount: failed,
        pendingCount: pending,
        ...(pending === 0
          ? { completedAt: new Date() }
          : {}),
      },
    },
  );
}
private buildCustomWhatsappPayload(
  dto: BulkCustomMessageDto,
  lead: any,
) {
  const to = this.formatPhoneNumber(
    lead.phone,
  );

  switch (dto.type) {
    // =========================
    // TEXT
    // =========================
    case 'text': {
      if (!dto.body) {
        throw new BadRequestException(
          'body is required for text message',
        );
      }

      return {
        recipient_type: 'individual',
        from: dto.from,
        to,
        type: 'text',
        text: {
          body: this.replaceVariables(
            dto.body,
            lead,
          ),
        },
      };
    }

    // =========================
    // IMAGE
    // =========================
    case 'image': {
      if (!dto.mediaUrl) {
        throw new BadRequestException(
          'mediaUrl is required for image message',
        );
      }

      return {
        recipient_type: 'individual',
        from: dto.from,
        to,
        type: 'image',
        image: {
          link: dto.mediaUrl,
          ...(dto.body
            ? {
                caption:
                  this.replaceVariables(
                    dto.body,
                    lead,
                  ),
              }
            : {}),
        },
      };
    }

    // =========================
    // VIDEO
    // =========================
    case 'video': {
      if (!dto.mediaUrl) {
        throw new BadRequestException(
          'mediaUrl is required for video message',
        );
      }

      return {
        recipient_type: 'individual',
        from: dto.from,
        to,
        type: 'video',
        video: {
          link: dto.mediaUrl,
          ...(dto.body
            ? {
                caption:
                  this.replaceVariables(
                    dto.body,
                    lead,
                  ),
              }
            : {}),
        },
      };
    }

    // =========================
    // DOCUMENT
    // =========================
    case 'document': {
      if (!dto.mediaUrl) {
        throw new BadRequestException(
          'mediaUrl is required for document message',
        );
      }

      if (!dto.filename) {
        throw new BadRequestException(
          'filename is required for document message',
        );
      }

      return {
        recipient_type: 'individual',
        from: dto.from,
        to,
        type: 'document',
        document: {
          link: dto.mediaUrl,
          filename: this.replaceVariables(
            dto.filename,
            lead,
          ),
          ...(dto.body
            ? {
                caption:
                  this.replaceVariables(
                    dto.body,
                    lead,
                  ),
              }
            : {}),
        },
      };
    }

    // =========================
    // INTERACTIVE
    // =========================
    case 'interactive': {
      if (!dto.interactive) {
        throw new BadRequestException(
          'interactive data is required',
        );
      }

      const interactive =
        this.replaceVariablesInObject(
          dto.interactive,
          lead,
        );

      if (!interactive.body) {
        throw new BadRequestException(
          'interactive body is required',
        );
      }

      // BUTTON validation
      if (
        interactive.type === 'button'
      ) {
        if (
          !interactive.action?.buttons ||
          !Array.isArray(
            interactive.action.buttons,
          ) ||
          interactive.action.buttons
            .length === 0
        ) {
          throw new BadRequestException(
            'Button interactive messages require action.buttons',
          );
        }
      }

      // LIST validation
      if (
        interactive.type === 'list'
      ) {
        if (
          !interactive.action?.sections ||
          !Array.isArray(
            interactive.action.sections,
          ) ||
          interactive.action.sections
            .length === 0
        ) {
          throw new BadRequestException(
            'List interactive messages require action.sections',
          );
        }
      }

      /*
       * Frontend sends:
       *
       * "body": "Hello {{name}}"
       *
       * UDO expects:
       *
       * "body": {
       *   "text": "Hello Abhishek"
       * }
       */

      return {
        recipient_type: 'individual',
        from: dto.from,
        to,
        type: 'interactive',
        interactive: {
          ...interactive,

          body: {
            text: interactive.body,
          },
        },
      };
    }

    default:
      throw new BadRequestException(
        `Unsupported message type: ${dto.type}`,
      );
  }
}
private buildTemplateHeader(
  lead: Record<string, any>,
  header?: TemplateHeaderDto,
  headerVariables: VariableDto[] = [],
): Record<string, any> | undefined {

  if (!header) {
    return undefined;
  }

  switch (header.type) {

    // =========================
    // TEXT
    // =========================

    case 'text': {
      let text = header.text ?? '';

      // Replace variables if supplied
      if (headerVariables.length) {
        const values =
          this.buildTemplateParams(
            lead,
            headerVariables,
          );

        headerVariables.forEach(
          (variable, index) => {
            text = text.replace(
              new RegExp(
                `\\{\\{${index + 1}\\}\\}`,
                'g',
              ),
              values[index] ?? '',
            );
          },
        );
      }

      return {
        type: 'text',
        text,
      };
    }

    // =========================
    // IMAGE
    // =========================

    case 'image':
      if (!header.link) {
        throw new Error(
          'Header image link is required',
        );
      }

      return {
        type: 'image',
        image: {
          link: header.link,
        },
      };

    // =========================
    // VIDEO
    // =========================

    case 'video':
      if (!header.link) {
        throw new Error(
          'Header video link is required',
        );
      }

      return {
        type: 'video',
        video: {
          link: header.link,
        },
      };

    // =========================
    // DOCUMENT
    // =========================

    case 'document':
      if (!header.link) {
        throw new Error(
          'Header document link is required',
        );
      }

      if (!header.filename) {
        throw new Error(
          'Header document filename is required',
        );
      }

      return {
        type: 'document',
        document: {
          link: header.link,
          filename: header.filename,
        },
      };

    default:
      throw new Error(
        `Unsupported header type: ${header.type}`,
      );
  }
}
private buildTemplateButtons(
  buttons?: TemplateButtonsDto,
): Record<string, any> | undefined {

  if (
    !buttons ||
    !buttons.params?.length
  ) {
    return undefined;
  }

  return {
    params: buttons.params.map(
      (value) => String(value),
    ),
  };
}
private async processCustomRecipient(
  campaignId: string,
  log: any,
  dto: BulkCustomMessageDto,
  userId:any
) {
  try {
    console.log('==============================');
    console.log('Processing recipient');
    console.log('Campaign ID:', campaignId);
    console.log('Lead ID:', log.leadId);
    console.log('Phone:', log.phone);
    console.log('Message Type:', dto.type);
    console.log('==============================');

    // 1. Mark recipient as PROCESSING
    const processingResult =
      await this.campaignRecipientLogModel.updateOne(
        {
          _id: log._id,
          status: 'PENDING',
        },
        {
          $set: {
            status: 'PROCESSING',
          },
        },
      );

    console.log(
      'Recipient marked PROCESSING:',
      processingResult,
    );

    // 2. Get latest lead data
    const lead =
      await this.leadModel
        .findById(log.leadId)
        .lean();

    if (!lead) {
      throw new Error(
        'Lead not found',
      );
    }

    if (!lead.phone) {
      throw new Error(
        'Lead phone number is missing',
      );
    }

    console.log(
      'Lead found:',
      {
        id: lead._id,
        name: lead.name,
        phone: lead.phone,
      },
    );
    const payload =
      this.buildCustomWhatsappPayload(
        dto,
        lead,
      );

    console.log(
      '========== UDO PAYLOAD ==========',
    );

    console.log(
      JSON.stringify(
        payload,
        null,
        2,
      ),
    );

    console.log(
      '=================================',
    );

    // 4. Send WhatsApp message
    const response =
      await this.whatsappService.sendCustomMessage(
        payload,
      );

    console.log(
      '========== UDO RESPONSE ==========',
    );

    console.log(
      JSON.stringify(
        response,
        null,
        2,
      ),
    );

    console.log(
      '==================================',
    );

    // 5. Get message ID
    const messageId =
      response?.data?.[0]?.messageId ||
      response?.data?.[0]?.id ||
      response?.messageId ||
      null;

    // 6. Mark recipient as SENT
    await this.campaignRecipientLogModel.updateOne(
      {
        _id: log._id,
      },
      {
        $set: {
          status: 'SENT',
          messageId,
          messageSent: payload,
          sentAt: new Date(),
          error: null,
        },
      },
    );

    // 7. Update campaign counters
    await this.campaignModel.updateOne(
      {
        _id: campaignId,
      },
      {
        $inc: {
          sentCount: 1,
          pendingCount: -1,
        },
      },
    );
    const campaign =
  await this.campaignModel
    .findById(campaignId)
    .lean();

if (campaign) {
  this.socketGateway.emitToUser(
    userId,
    'campaign-progress',
    {
      campaignId,

      status: 'PROCESSING',

      totalRecipients:
        campaign.totalRecipients,

      sentCount:
        campaign.sentCount,

      failedCount:
        campaign.failedCount,

      pendingCount:
        campaign.pendingCount,

      currentLead: {
        leadId: lead._id,
        name: lead.name,
        phone: lead.phone,
      },

      result: 'SENT',

      messageId,
    },
  );
}
    console.log(
      `Message successfully sent to ${lead.name}`,
    );

  } catch (error: any) {

    console.log(
      '========== MESSAGE FAILED ==========',
    );

    console.log(
      'Lead ID:',
      log.leadId,
    );

    console.log(
      'Error:',
      error,
    );

    console.log(
      '====================================',
    );

    // Get proper error from UDO
    const errorMessage =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      'Unknown error';

    // 8. Mark recipient as FAILED
    await this.campaignRecipientLogModel.updateOne(
      {
        _id: log._id,
      },
      {
        $set: {
          status: 'FAILED',
          error: errorMessage,
          failedAt: new Date(),
        },
      },
    );

    // 9. Update campaign counters
    await this.campaignModel.updateOne(
      {
        _id: campaignId,
      },
      {
        $inc: {
          failedCount: 1,
          pendingCount: -1,
        },
      },
    );
    const campaign =
  await this.campaignModel
    .findById(campaignId)
    .lean();

if (campaign) {
  this.socketGateway.emitToUser(
    userId,
    'campaign-progress',
    {
      campaignId,

      status: 'PROCESSING',

      totalRecipients:
        campaign.totalRecipients,

      sentCount:
        campaign.sentCount,

      failedCount:
        campaign.failedCount,

      pendingCount:
        campaign.pendingCount,

      currentLead: {
        leadId: log.leadId,
        name: log.leadName,
        phone: log.phone,
      },

      result: 'FAILED',

      error: errorMessage,
    },
  );
}

    console.log(
      `Message failed for lead ${log.leadId}: ${errorMessage}`,
    );

    // IMPORTANT:
    // Don't throw the error again.
    //
    // The queue should continue with
    // the next lead.
  }
}
private async processTemplateCampaign(
  campaignId: string,
  dto: BulkWhatsappDto,
  userId: string,
) {
  await this.campaignModel.updateOne(
    { _id: campaignId },
    {
      $set: {
        status: 'PROCESSING',
      },
    },
  );

  const logs =
    await this.campaignRecipientLogModel
      .find({
        campaignId:
          new Types.ObjectId(
            campaignId,
          ),

        status: 'PENDING',
      })
      .lean();

  await this.messageQueue.processInBatches(
    logs,
    5,
    10000,

    async (log) => {
      await this.processTemplateRecipient(
        campaignId,
        log,
        dto,
        userId,
      );
    },
  );

  await this.finishCampaign(
    campaignId,
  );

  const campaign =
    await this.campaignModel
      .findById(campaignId)
      .lean();

  this.socketGateway.emitToUser(
    userId,
    'campaign-completed',
    {
      campaignId,

      status:
        campaign?.status,

      totalRecipients:
        campaign?.totalRecipients || 0,

      sentCount:
        campaign?.sentCount || 0,

      failedCount:
        campaign?.failedCount || 0,

      pendingCount:
        campaign?.pendingCount || 0,

      completedAt:
        campaign?.completedAt ||
        null,
    },
  );
}

private buildTemplatePayload(
  lead: Record<string, any>,
  dto: BulkWhatsappDto,
): SendTemplateDto  {

  const components: Record<
    string,
    any
  > = {};

  // =========================
  // BODY
  // =========================

  if (dto.variables?.length) {
    components.body = {
      params:
        this.buildTemplateParams(
          lead,
          dto.variables,
        ),
    };
  }

  // =========================
  // HEADER
  // =========================

if (dto.header) {
  const isTextHeader = dto.header.type === 'text';
const shouldSendHeader =
  !isTextHeader ||
  (dto.headerVariables?.length ?? 0) > 0;

  if (shouldSendHeader) {
    const header =
      this.buildTemplateHeader(
        lead,
        dto.header,
        dto.headerVariables,
      );

    if (header) {
      components.header = header;
    }
  }
}

  // =========================
  // BUTTONS
  // =========================

  // const buttons =
  //   this.buildTemplateButtons(
  //     dto.buttons,
  //   );

  // if (buttons) {
  //   components.buttons = buttons;
  // }

  // =========================
  // FINAL PAYLOAD
  // =========================

  return {
    from: dto.from,

    campaignName:
      dto.templateName,

    to:
      this.formatPhoneNumber(
        lead.phone,
      ),

    templateName:
      dto.templateName,

    components,

    type: 'template',
  };
}

private async processTemplateRecipient(
  campaignId: string,
  log: any,
  dto: BulkWhatsappDto,
  userId: string,
) {
  try {
    // =====================================================
    // 1. MARK RECIPIENT AS PROCESSING
    // =====================================================

    const processingResult =
      await this.campaignRecipientLogModel.updateOne(
        {
          _id: log._id,
          status: 'PENDING',
        },
        {
          $set: {
            status: 'PROCESSING',
            processingAt: new Date(),
          },
        },
      );

    // If another process already picked this recipient,
    // don't process it again.
    if (processingResult.modifiedCount === 0) {
      this.logger.warn(
        `Recipient ${log._id} is already being processed.`,
      );

      return;
    }

    // =====================================================
    // 2. GET LATEST LEAD DATA
    // =====================================================

    const lead =
      await this.leadModel
        .findById(log.leadId)
        .lean();

    if (!lead) {
      throw new Error(
        `Lead not found: ${log.leadId}`,
      );
    }

    if (!lead.phone) {
      throw new Error(
        `Lead phone number is missing: ${lead._id}`,
      );
    }

    // =====================================================
    // 3. BUILD COMPLETE UDO TEMPLATE PAYLOAD
    //
    // This helper handles:
    //
    // body
    // header
    // headerVariables
    // buttons
    //
    // and only adds components that were provided.
    // =====================================================

    const payload =
      this.buildTemplatePayload(
        lead,
        dto,
      );

    this.logger.debug(
      `Sending template to ${lead.phone}`,
    );

    // =====================================================
    // 4. SEND WHATSAPP MESSAGE
    // =====================================================

    const response =
      await this.whatsappService.sendTemplate(
        payload,
      );

    // =====================================================
    // 5. EXTRACT MESSAGE ID
    // =====================================================

    const messageId =
      response?.data?.[0]?.messageId ||
      response?.messageId ||
      null;

    // If UDO didn't give us a message ID,
    // treat it as a failed send.
    if (!messageId) {
      throw new Error(
        response?.message ||
          'WhatsApp provider did not return a message ID',
      );
    }

    // =====================================================
    // 6. SAVE SUCCESS LOG
    // =====================================================

    await this.campaignRecipientLogModel.updateOne(
      {
        _id: log._id,
      },
      {
        $set: {
          status: 'SENT',

          leadName:
            lead.name || log.leadName,

          phone:
            this.formatPhoneNumber(
              lead.phone,
            ),

          messageId,

          // Exact payload that was sent
          messageSent:
            payload,

          // Exact response received from UDO
          providerResponse:
            response,

          sentAt:
            new Date(),

          error:
            null,
        },
      },
    );

    // =====================================================
    // 7. UPDATE CAMPAIGN COUNTERS
    // =====================================================

    await this.campaignModel.updateOne(
      {
        _id: campaignId,
      },
      {
        $inc: {
          sentCount: 1,
          pendingCount: -1,
        },
      },
    );

    // =====================================================
    // 8. GET UPDATED CAMPAIGN PROGRESS
    // =====================================================

    const campaign =
      await this.campaignModel
        .findById(campaignId)
        .lean();

    // =====================================================
    // 9. SEND REAL-TIME SOCKET UPDATE
    // =====================================================

    this.socketGateway.emitToUser(
      userId,
      'campaign-progress',
      {
        campaignId,

        status:
          'PROCESSING',

        totalRecipients:
          campaign?.totalRecipients || 0,

        sentCount:
          campaign?.sentCount || 0,

        failedCount:
          campaign?.failedCount || 0,

        pendingCount:
          campaign?.pendingCount || 0,

        currentLead: {
          leadId:
            lead._id,

          name:
            lead.name,

          phone:
            lead.phone,
        },

        result:
          'SENT',

        messageId,

        timestamp:
          new Date(),
      },
    );

    this.logger.log(
      `Template sent successfully | campaign=${campaignId} | lead=${lead._id} | phone=${lead.phone}`,
    );
  } catch (error: any) {
    // =====================================================
    // ERROR MESSAGE
    // =====================================================

    const errorMessage =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      'Unknown error';

    this.logger.error(
      `Template send failed | campaign=${campaignId} | log=${log._id} | error=${errorMessage}`,
    );

    // =====================================================
    // 1. SAVE FAILED LOG
    // =====================================================

    await this.campaignRecipientLogModel.updateOne(
      {
        _id: log._id,
      },
      {
        $set: {
          status: 'FAILED',

          error:
            errorMessage,

          failedAt:
            new Date(),
        },
      },
    );

    // =====================================================
    // 2. UPDATE CAMPAIGN COUNTERS
    // =====================================================

    await this.campaignModel.updateOne(
      {
        _id: campaignId,
      },
      {
        $inc: {
          failedCount: 1,
          pendingCount: -1,
        },
      },
    );

    // =====================================================
    // 3. GET UPDATED CAMPAIGN PROGRESS
    // =====================================================

    const campaign =
      await this.campaignModel
        .findById(campaignId)
        .lean();

    // =====================================================
    // 4. SEND REAL-TIME FAILURE UPDATE
    // =====================================================

    this.socketGateway.emitToUser(
      userId,
      'campaign-progress',
      {
        campaignId,

        status:
          'PROCESSING',

        totalRecipients:
          campaign?.totalRecipients || 0,

        sentCount:
          campaign?.sentCount || 0,

        failedCount:
          campaign?.failedCount || 0,

        pendingCount:
          campaign?.pendingCount || 0,

        currentLead: {
          leadId:
            log.leadId,

          name:
            log.leadName,

          phone:
            log.phone,
        },

        result:
          'FAILED',

        error:
          errorMessage,

        timestamp:
          new Date(),
      },
    );

    // =====================================================
    // IMPORTANT
    //
    // DON'T THROW THE ERROR.
    //
    // The queue must continue with the next recipient.
    // =====================================================
  }
}

async sendBulkCampaign(
  dto: BulkWhatsappDto,
  user: any,
) {
  console.log(dto)
  const recipients = new Map<string, any>();

  // =========================
  // GET LEADS
  // =========================

  if (dto.leadIds?.length) {
    const leads = await this.leadModel
      .find({
        _id: {
          $in: dto.leadIds,
        },
        isActive: true,
      })
      .lean();

    for (const lead of leads) {
      if (!lead.phone) {
        continue;
      }

      recipients.set(
        lead._id.toString(),
        lead,
      );
    }
  }

  const records =
    Array.from(
      recipients.values(),
    );

  if (!records.length) {
    throw new BadRequestException(
      'No valid leads found',
    );
  }

  // =========================
  // CREATE CAMPAIGN
  // =========================

  const campaign =
    await this.campaignModel.create({
      campaignName:
        dto.templateName,

      from: dto.from,

      templateName:
        dto.templateName,

      campaignType:
        'template',

      createdBy:
        user.userId,

      status:
        'PENDING',

      totalRecipients:
        records.length,

      pendingCount:
        records.length,

      sentCount: 0,

      failedCount: 0,

      messageTemplate: {
        templateName:
          dto.templateName,

        variables:
          dto.variables || [],
      },
    });

  // =========================
  // CREATE RECIPIENT LOGS
  // =========================

  const recipientLogs =
    records.map((lead) => ({
      campaignId:
        campaign._id,

      leadId:
        lead._id,

      leadName:
        lead.name,

      phone:
        this.formatPhoneNumber(
          lead.phone,
        ),

      status:
        'PENDING',
    }));

  await this.campaignRecipientLogModel.insertMany(
    recipientLogs,
  );

  // =========================
  // START BACKGROUND QUEUE
  // =========================

  void this.processTemplateCampaign(
    campaign._id.toString(),
    dto,
    user.userId,
  );

  return {
    success: true,

    campaignId:
      campaign._id,

    totalRecipients:
      records.length,

    status:
      'PENDING',

    message:
      'Campaign created and message processing started.',
  };
}



async sendBulkCustomMessages(
  dto: BulkCustomMessageDto,
   user: any,
) {
  console.log("sendBulkCustomMessages",dto)
  const leads = await this.leadModel.find({
    _id: {
      $in: dto.leadIds,
    },
    isActive: true,
  }).lean();

  if (!leads.length) {
    throw new BadRequestException(
      'No valid leads found',
    );
  }

  const campaign =
    await this.campaignModel.create({
      campaignName: dto.campaignName,
      from: dto.from,
      campaignType: 'custom',
      createdBy: user.userId,
      status: 'PENDING',
      totalRecipients: leads.length,
      pendingCount: leads.length,
      messageTemplate: {
        type: dto.type,
        interactive: dto.interactive,
      },
    });

  const recipientLogs = leads
    .filter((lead) => !!lead.phone)
    .map((lead) => ({
      campaignId: campaign._id,
      leadId: lead._id,
      leadName: lead.name,
      phone: this.formatPhoneNumber(
        lead.phone,
      ),
      status: 'PENDING',
    }));

  if (recipientLogs.length) {
    await this.campaignRecipientLogModel.insertMany(
      recipientLogs,
    );
  }

  // Start background processing.
  void this.processCustomCampaign(
    campaign._id.toString(),
    dto,
    user.userId,
  );

  return {
    success: true,
    campaignId: campaign._id,
    totalRecipients: recipientLogs.length,
    status: 'PENDING',
    message:
      'Campaign created and message processing started.',
  };
}


private buildCampaignDateFilter(
  date?: string,
  startDate?: string,
  endDate?: string,
) {
  if (!date) {
    return undefined;
  }

  const now = new Date();

  // =========================
  // TODAY
  // =========================

  if (date === 'today') {
    const start = new Date(now);

    start.setHours(
      0,
      0,
      0,
      0,
    );

    const end = new Date(now);

    end.setHours(
      23,
      59,
      59,
      999,
    );

    return {
      $gte: start,
      $lte: end,
    };
  }

  // =========================
  // THIS WEEK
  // =========================

  if (date === 'this_week') {
    const start = new Date(now);

    const day =
      start.getDay();

    const diff =
      day === 0
        ? 6
        : day - 1;

    start.setDate(
      start.getDate() - diff,
    );

    start.setHours(
      0,
      0,
      0,
      0,
    );

    const end = new Date(now);

    end.setHours(
      23,
      59,
      59,
      999,
    );

    return {
      $gte: start,
      $lte: end,
    };
  }

  // =========================
  // THIS MONTH
  // =========================

  if (date === 'this_month') {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    );

    start.setHours(
      0,
      0,
      0,
      0,
    );

    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    );

    end.setHours(
      23,
      59,
      59,
      999,
    );

    return {
      $gte: start,
      $lte: end,
    };
  }

  // =========================
  // CUSTOM
  // =========================

  if (date === 'custom') {
    if (!startDate || !endDate) {
      throw new BadRequestException(
        'startDate and endDate are required for custom date filter',
      );
    }

    const start = new Date(
      startDate,
    );

    const end = new Date(
      endDate,
    );

    if (
      isNaN(start.getTime()) ||
      isNaN(end.getTime())
    ) {
      throw new BadRequestException(
        'Invalid startDate or endDate',
      );
    }

    start.setHours(
      0,
      0,
      0,
      0,
    );

    end.setHours(
      23,
      59,
      59,
      999,
    );

    if (start > end) {
      throw new BadRequestException(
        'startDate cannot be greater than endDate',
      );
    }

    // Maximum 31 days
    const difference =
      end.getTime() -
      start.getTime();

    const days =
      difference /
      (1000 * 60 * 60 * 24);

    if (days > 31) {
      throw new BadRequestException(
        'Custom date range cannot exceed 31 days',
      );
    }

    return {
      $gte: start,
      $lte: end,
    };
  }

  throw new BadRequestException(
    'Invalid date filter',
  );
}
async getCampaigns(
  query: GetCampaignsQueryDto,
  user: any,
) {
  const {
    search,
    status,
    type,
    date,
    startDate,
    endDate,
  } = query;

  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;

  const skip = (page - 1) * limit;

  const filter: any = {
    createdBy: user.userId,
  };

  // =========================
  // SEARCH
  // =========================

  if (search?.trim()) {
    filter.campaignName = {
      $regex: this.escapeRegex(
        search.trim(),
      ),
      $options: 'i',
    };
  }

  // =========================
  // STATUS
  // =========================

  if (status?.trim()) {
    filter.status = status;
  }

  // =========================
  // TYPE
  // =========================

  if (type?.trim()) {
    filter.campaignType = type;
  }

  // =========================
  // DATE FILTER
  // =========================

  const dateFilter =
    this.buildCampaignDateFilter(
      date,
      startDate,
      endDate,
    );

  if (dateFilter) {
    filter.createdAt = dateFilter;
  }

  // =========================
  // QUERY
  // =========================

  const [campaigns, total] =
    await Promise.all([
      this.campaignModel
        .find(filter)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      this.campaignModel.countDocuments(
        filter,
      ),
    ]);

  // =========================
  // RESPONSE
  // =========================

  return {
    success: true,

    data: campaigns.map(
      (campaign) => ({
        _id: campaign._id,

        campaignName:
          campaign.campaignName,

        from: campaign.from,

        type:
          campaign.campaignType,

        status:
          campaign.status,

        totalRecipients:
          campaign.totalRecipients,

        success:
          campaign.sentCount || 0,

        failed:
          campaign.failedCount || 0,

        pending:
          campaign.pendingCount || 0,

        createdAt:
          campaign.createdAt,

        completedAt:
          campaign.completedAt || null,
      }),
    ),

    pagination: {
      page,
      limit,
      total,
      totalPages:
        Math.ceil(total / limit),
      hasNextPage:
        page < Math.ceil(
          total / limit,
        ),
      hasPreviousPage:
        page > 1,
    },
  };
}

async getCampaignLogs(
  campaignId: string,
  query: GetCampaignLogsQueryDto,
  user: any,
) {
  const {
    search,
    status,
  } = query;

  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;

  const skip =
    (page - 1) * limit;

  // =========================
  // CHECK CAMPAIGN
  // =========================

  const campaign =
    await this.campaignModel
      .findOne({
        _id: campaignId,
        createdBy: user.userId,
      })
      .lean();

  if (!campaign) {
    throw new NotFoundException(
      'Campaign not found',
    );
  }

  // =========================
  // FILTER
  // =========================

  const filter: any = {
    campaignId:
      new Types.ObjectId(
        campaignId,
      ),
  };

  // =========================
  // STATUS
  // =========================

  if (status) {
    filter.status = status;
  }

  // =========================
  // SEARCH
  // =========================

  if (search?.trim()) {
    const searchRegex = {
      $regex: this.escapeRegex(
        search.trim(),
      ),
      $options: 'i',
    };

    filter.$or = [
      {
        leadName:
          searchRegex,
      },

      {
        phone:
          searchRegex,
      },

      {
        messageId:
          searchRegex,
      },

      {
        error:
          searchRegex,
      },
    ];
  }

  // =========================
  // QUERY
  // =========================

  const [
    logs,
    total,
  ] = await Promise.all([
    this.campaignRecipientLogModel
      .find(filter)
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    this.campaignRecipientLogModel
      .countDocuments(filter),
  ]);

  // =========================
  // RESPONSE
  // =========================

  return {
    success: true,

    campaign: {
      _id: campaign._id,

      campaignName:
        campaign.campaignName,

      status:
        campaign.status,

      totalRecipients:
        campaign.totalRecipients,

      success:
        campaign.sentCount || 0,

      failed:
        campaign.failedCount || 0,

      pending:
        campaign.pendingCount || 0,
    },

    data: logs.map(
      (log) => ({
        _id: log._id,

        leadId:
          log.leadId,

        leadName:
          log.leadName,

        phone:
          log.phone,

        status:
          log.status,

        messageId:
          log.messageId || null,

        messageSent:
          log.messageSent || null,

        error:
          log.error || null,

        sentAt:
          log.sentAt || null,

        failedAt:
          log.failedAt || null,
      }),
    ),

    pagination: {
      page,
      limit,
      total,

      totalPages:
        Math.ceil(
          total / limit,
        ),

      hasNextPage:
        page <
        Math.ceil(
          total / limit,
        ),

      hasPreviousPage:
        page > 1,
    },
  };
}
}
