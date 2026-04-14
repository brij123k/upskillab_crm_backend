import { Injectable, HttpException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types } from 'mongoose';
import { CallLog } from 'src/schema/call-log.schema';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { SocketGateway } from '../socket/socket.gateway';
import { LeadHistoryLogic } from '../lead_management/lead-history/lead-history.logic';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { CallLogReview } from 'src/schema/all-log-review.schema';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';

@Injectable()
export class SmartfloService {
  constructor(
      @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
    private readonly socketGateway: SocketGateway,

    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userActivityLogic: UserActivityLogic,

        @InjectModel(CallLogReview.name)
        private readonly model: Model<CallLogReview>,
    ) { }
   

  private baseUrl = process.env.SMARTFLO_BASE_URL;
  private baseUrl2 = process.env.SMARTFLO_BASE_URL2;
  private apiKey = process.env.SMARTFLO_API_KEY;

  // ✅ COMMON REQUEST FUNCTION
  private async makeRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    data?: any,
    params?: any,
  ) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          Authorization:`Bearer ${this.apiKey}`,
          'Accept':'application/json',
          'Content-Type': 'application/json',
        },
        data,
        params,
      });

      return response.data;
    } catch (error) {
      console.error('Smartflo Error:', error?.response?.data);
      throw new HttpException(
        error?.response?.data || 'Smartflo API Error',
        error?.response?.status || 500,
      );
    }
  }

   private async makeRequest2(
    method: 'GET' | 'POST',
    endpoint: string,
    data?: any,
    params?: any,
  ) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl2}${endpoint}`,
        headers: {
          Authorization:`Bearer ${this.apiKey}`,
          'Accept':'application/json',
          'Content-Type': 'application/json',
        },
        data,
        params,
      });

      return response.data;
    } catch (error) {
      console.error('Smartflo Error:', error?.response?.data);
      throw new HttpException(
        error?.response?.data || 'Smartflo API Error',
        error?.response?.status || 500,
      );
    }
  }

  async createIVRUser(payload: {
    name: string;
    phone: string;
    email?: string;
    login_id?:string;
    password?:string;
    caller_ids?:string[];
  }) {
    return this.makeRequest('POST', '/user', {
      create_agent: true,
      create_web_login: true,
      status: true,
      name: payload.name,
      number: payload.phone,
      email: payload.email,
      login_id: payload.login_id,
      user_role: 94922,
      password: payload.password,
      caller_id: payload.caller_ids
    });
  }


async getCallerIds() {
  const response = await this.makeRequest('GET', '/my_number');

  const numbers = response || [];

  return numbers
    .map((num: any) => ({
      label: num.alias,
      value: num.did,
      callerId: num.id,
      id: num.id,
    }));
}

async clickToCall(dto:any,user:any) {
  const lead = await this.leadModel.findOne({leadId:dto.leadId})
  if(!lead){
    throw new NotFoundException("Lead Not Found")
  }
  const response = await this.makeRequest2('POST', '/click_to_call', {
    async: 1,
    agent_number: Number(user.number),
    destination_number: Number(lead.phone),
    caller_id: process.env.CALLERID,
  });

  await this.callLogModel.create({
    refId: response.ref_id,
    leadId: lead.leadId,
    userId: user.userId,
    agentNumber: user.number,
    customerNumber: lead.phone,
    isFormSubmitted: false,
});
return response
}

async hanldeWebhook(body:any){
  let {
      ref_id,   
      duration,
      start_stamp,
      recording_url,
      call_status,
    } = body;

    const call = await this.callLogModel.findOne({ refId: ref_id });
    if(call_status!=="answered"){
      duration=0
    }
    if (!call) return { success: true };
    call.duration = duration;
    call.startedAt = new Date(start_stamp);
    call.recording_url=recording_url
    await call.save();
    // 🔥 trigger frontend
  this.socketGateway.emitToUser(
    call.userId.toString(),
    'call-completed',
    {
      callId: call._id,
      leadId: call.leadId,
      duration: call.duration,
      call:call
    },
  );
    return true
}

async updateCallLog(body:any){
  const { callId, outcome, stageId,remark } = body;

  const call = await this.callLogModel.findById(callId);

    if (!call) throw new Error('Call not found');

    call.outcome = outcome;
    call.stageId = stageId;
    call.isFormSubmitted = true;

    await call.save();

    // 🔥 update lead stage
    await this.leadModel.updateOne(
      { leadId: call.leadId },
      { stageId:new Types.ObjectId(stageId) }
    );

    await this.leadHistoryLogic.log({
        leadId: call.leadId.toString(),
        actionType: LeadActionType.CALL_LOG,
        actionBy: call.userId.toString(),
        changes: call,
        reason:remark
      });
    
      // 3️⃣ User Activity
      await this.userActivityLogic.log({
        userId: call.userId.toString(),
        action: 'CALL_LOGGED',
        referenceType: 'LEAD',
        referenceId: call.leadId.toString(),
        meta: {
          message:"Call Log created",
          call},
      });
    
      // 4️⃣ Create Review IF provided
      if (remark) {
        await this.createreview({
          leadId: call.leadId,
          callLogId: call._id,
          userId: call.userId,
          remark,
        });
      }
}
  createreview(data: any) {
    return this.model.create(data);
  }

}