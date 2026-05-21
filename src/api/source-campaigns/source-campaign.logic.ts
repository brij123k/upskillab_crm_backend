import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SourceCampaignData } from './source-campaign.data';
import { LeadData } from 'src/api/lead_management/lead/lead.data';
import { CreateSourceCampaignDto, PublicSourceLeadDto, UpdateSourceCampaignDto } from 'src/dto/source-campaign.dto';
import { LeadSource } from 'src/schema/lead_management/lead.schema';

@Injectable()
export class SourceCampaignLogic {
  constructor(
    private readonly data: SourceCampaignData,
    private readonly leadData: LeadData,
  ) {}

  async create(dto: CreateSourceCampaignDto, userId: string) {
    const existing = await this.data.findAll();
    if (existing.some((item) => item.name.toLowerCase() === dto.name.toLowerCase())) {
      throw new BadRequestException('Source campaign name already exists');
    }

    return this.data.create({
      ...dto,
      defaultStageId: new Types.ObjectId(dto.defaultStageId),
      defaultPoolId: new Types.ObjectId(dto.defaultPoolId),
      createdBy: userId,
      updatedBy: userId,
      isActive: dto.isActive ?? true,
    });
  }

  findAll() {
    return Promise.all([
      this.data.findAll(),
      this.data.countLogsByCampaign(),
    ]).then(([campaigns, counts]) => {
      const countMap = new Map(
        counts.map((item: any) => [item._id?.toString?.() || String(item._id), item.registeredCount || 0]),
      );

      return campaigns.map((campaign: any) => {
        const plain = campaign.toObject ? campaign.toObject() : campaign;
        return {
          ...plain,
          registeredCount: countMap.get(plain._id?.toString?.() || String(plain._id)) || 0,
        };
      });
    });
  }

  async findOne(id: string) {
    const campaign = await this.data.findById(id);
    if (!campaign) {
      throw new NotFoundException('Source campaign not found');
    }

    const submissions = await this.data.findLogsByCampaignId(id);

    return {
      ...campaign.toObject(),
      registeredUsers: submissions.map((submission: any) => {
        const lead = submission.leadId;
        return {
          _id: lead?._id?.toString?.() || submission.leadId?.toString?.() || submission._id?.toString?.(),
          leadId: lead?.leadId ?? null,
          name: lead?.name || submission.leadName || '',
          phone: lead?.phone || submission.leadPhone || '',
          email: lead?.email || submission.leadEmail || '',
          city: lead?.city || null,
          state: lead?.state || null,
          source: lead?.source || submission.source || null,
          source_campaign: lead?.source_campaign || campaign.name,
          status: lead?.status || null,
          submittedAt: submission.createdAt,
        };
      }),
      registeredCount: submissions.length,
    };
  }

  async update(id: string, dto: UpdateSourceCampaignDto, userId: string) {
    const campaign = await this.findOne(id);
    const data: any = {
      ...dto,
      updatedBy: userId,
    };

    if (dto.defaultStageId) data.defaultStageId = new Types.ObjectId(dto.defaultStageId);
    if (dto.defaultPoolId) data.defaultPoolId = new Types.ObjectId(dto.defaultPoolId);

    if (dto.name && dto.name.toLowerCase() !== campaign.name.toLowerCase()) {
      const duplicate = await this.data.findAll();
      if (duplicate.some((item) => item._id.toString() !== id && item.name.toLowerCase() === dto.name!.toLowerCase())) {
        throw new BadRequestException('Source campaign name already exists');
      }
    }

    return this.data.update(id, data);
  }

  async toggleActive(id: string, userId: string) {
    const campaign = await this.findOne(id);
    return this.data.update(id, {
      isActive: !campaign.isActive,
      updatedBy: userId,
    });
  }

  async getPublicCampaign(id: string) {
    const campaign = await this.findOne(id);
    if (!campaign.isActive) {
      throw new BadRequestException('This campaign is inactive');
    }
    return campaign;
  }

  async submitPublicLead(id: string, dto: PublicSourceLeadDto) {
    const campaign = await this.getPublicCampaign(id);
    const source = dto.source || (campaign.source as LeadSource);

    const lead = await this.leadData.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      city: dto.city || '',
      state: dto.state || '',
      source,
      source_campaign: campaign.name,
      stageId: campaign.defaultStageId,
      poolId: campaign.defaultPoolId,
      assignedDate: new Date(),
      modifiedAt: new Date(),
      isActive: true,
    });

    await this.data.createLog({
      sourceCampaignId: campaign._id,
      sourceCampaignName: campaign.name,
      source,
      leadId: lead._id,
      leadName: lead.name,
      leadPhone: lead.phone,
      leadEmail: lead.email,
    });

    return {
      message: 'Lead submitted successfully',
      lead,
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        source: campaign.source,
      },
    };
  }

  async comparisonReport(query: any = {}) {
    const match: any = {};
    if (query.sourceCampaignId) {
      match.sourceCampaignId = new Types.ObjectId(query.sourceCampaignId);
    }
    if (query.source) {
      match.source = query.source;
    }
    if (query.fromDate || query.toDate) {
      match.createdAt = {};
      if (query.fromDate) match.createdAt.$gte = new Date(query.fromDate);
      if (query.toDate) {
        const to = new Date(query.toDate);
        to.setHours(23, 59, 59, 999);
        match.createdAt.$lte = to;
      }
    }

    const rows = await this.data.aggregateLogs(match);
    const campaigns = rows.map((row: any) => ({
      sourceCampaignId: row._id.sourceCampaignId,
      sourceCampaignName: row._id.sourceCampaignName,
      source: row._id.source,
      totalLeads: row.totalLeads,
      lastLeadAt: row.lastLeadAt,
    }));

    const totalLeads = campaigns.reduce((sum: number, row: any) => sum + row.totalLeads, 0);
    return {
      data: campaigns,
      totalLeads,
    };
  }
}
