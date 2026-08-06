import { BadRequestException, Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Lead, LeadStatus } from 'src/schema/lead_management/lead.schema';

import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from 'src/schema/user.schema';

import { BulkWhatsappDto, VariableDto } from 'src/api/whatsapp/dto/bulk-whatsapp.dto';
import { MessageQueueService } from 'src/common/queue/message-queue.service';
import { WhatsappService } from 'src/api/whatsapp/whatsapp.service';

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

    private readonly whatsappService: WhatsappService,
    private readonly messageQueue: MessageQueueService,
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

private getNestedValue(
  obj: Record<string, any>,
  path: string,
): any {
  return path
    .split('.')
    .reduce((acc, part) => acc?.[part], obj);
}

private buildTemplateParams(
  data: Record<string, any>,
  variables: VariableDto[] = [],
): string[] {
  return variables.map((variable) => {
    if (variable.dynamic === false) {
      return String(variable.value);
    }

    const value = this.getNestedValue(
      data,
      variable.value,
    );

    if (
      value === undefined ||
      value === null
    ) {
      return '';
    }

    return String(value);
  });
}
async sendBulkCampaign(
  dto: BulkWhatsappDto,
) {
  const recipients = new Map<string, any>();

  // Direct phone numbers

  if (dto.phoneNumbers?.length) {
    dto.phoneNumbers.forEach((phone) => {
      recipients.set(phone, {
        phone,
      });
    });
  }

  // Lead-based numbers

  if (dto.leadIds?.length) {
    const leads = await this.leadModel.find({
      _id: {
        $in: dto.leadIds,
      },
    });

    leads.forEach((lead) => {
      if (lead.phone) {
        recipients.set(lead.phone, lead);
      }
    });
  }

  const records = Array.from(
    recipients.values(),
  );

  await this.messageQueue.processInBatches(
    records,
    5,
    10000,
    async (record) => {
      try {
        const phone = record.phone;

        const payload = {
          from: dto.from,
          campaignName: dto.templateName,
          to: this.formatPhoneNumber(phone),
          templateName: dto.templateName,
          type: 'template',

          components: {
            body: {
              params: this.buildTemplateParams(
                record,
                dto.variables,
              ),
            },
          },
        };

        await this.whatsappService.sendTemplate(
          payload,
        );

        this.logger.log(
          `Message sent to ${phone}`,
        );
      } catch (error) {
        this.logger.error(error);
      }
    },
  );

  return {
    success: true,
    totalRecipients: records.length,
  };
}
}
