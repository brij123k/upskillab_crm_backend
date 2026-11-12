import {
  Injectable,
  HttpException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
import { User } from 'src/schema/user.schema';
import { EnrolledLead } from 'src/schema/enrolled_leads/enrolled-lead.schema';

/** Last 10 digits of a phone number (Indian mobile without country code). */
const lastTenDigits = (num?: string | number | null) =>
  String(num ?? '').replace(/\D/g, '').slice(-10);

@Injectable()
export class SmartfloService {
  constructor(
      @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,

    @InjectModel(User.name)
    private readonly userModel: Model<Lead>,
    private readonly socketGateway: SocketGateway,

    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userActivityLogic: UserActivityLogic,

        @InjectModel(CallLogReview.name)
        private readonly model: Model<CallLogReview>,

    @InjectModel(EnrolledLead.name)
    private readonly enrolledLeadModel: Model<EnrolledLead>,
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
  console.log("Click To Call Response:",response)
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

/**
 * Click to call an enrolled lead (Upskillab student). Same Smartflo flow as
 * sales leads; the call log is linked with enrolledLeadId instead of leadId.
 */
async clickToCallEnrolled(
  enrolled: { _id: any; mobileNumber?: string; fullName?: string },
  user: any,
) {
  const destination = lastTenDigits(enrolled.mobileNumber);
  if (destination.length !== 10) {
    throw new BadRequestException('This student has no valid mobile number');
  }
  const agent = lastTenDigits(user?.number);
  if (agent.length !== 10) {
    throw new BadRequestException(
      'Your mobile number is not set on your user profile, so the call cannot be connected',
    );
  }
  const response = await this.makeRequest2('POST', '/click_to_call', {
    async: 1,
    agent_number: Number(agent),
    destination_number: Number(destination),
    caller_id: process.env.CALLERID,
  });
  const call = await this.callLogModel.create({
    refId: response?.ref_id,
    enrolledLeadId: new Types.ObjectId(String(enrolled._id)),
    userId: user.userId,
    agentNumber: agent,
    customerNumber: destination,
    isFormSubmitted: false,
  });
  return { ...response, callId: call._id };
}

/** Socket payload for a finished call (sales lead or enrolled lead). */
private async callCompletedPayload(call: any) {
  const payload: any = {
    callId: call._id,
    leadId: call.leadId,
    duration: call.duration,
    call,
  };
  if (call.enrolledLeadId) {
    const enrolled: any = await this.enrolledLeadModel
      .findById(call.enrolledLeadId)
      .select('fullName mobileNumber stageId stageName')
      .lean();
    payload.type = 'enrolled';
    payload.enrolledLeadId = call.enrolledLeadId;
    payload.enrolledLead = enrolled;
  }
  return payload;
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
  this.socketGateway.emitCallEvent(
    call.userId.toString(),
    'call-completed',
    await this.callCompletedPayload(call),
  );
    return true
}

async hanldeWebhookCallBack(body: any) {
  let {
    caller_id_number,
    customer_no_with_prefix,
  } = body;

  // 🔍 Step 1: Try with country code
  let lead = await this.leadModel.findOne({
    phone: customer_no_with_prefix,
  });

  // 🔍 Step 2: Fallback → without country code
  if (!lead) {
    lead = await this.leadModel.findOne({
      phone: caller_id_number,
    });
  }

  if (!lead) {
    return false;
  }
  if(lead.assignedTo){
  this.socketGateway.emitToUser(
    lead.assignedTo?.toString(),
    'callBack-received',
    {
      leadId: lead.leadId,
      leadName:lead.name,
      lead:lead
    },
  );
}
  return true;
}


async hanldeWebhookCallDone(body: any) {
  // 🔹 Extract agent number (handle both formats)
  const agentNumber =
    body['answered_agent[agent_number]'] ||
    body['answered_agent[number]'];

  const callerNumber = body?.caller_id_number;
  const fullNumber = body?.customer_no_with_prefix;
  const duration = body?.duration;
  const startStamp = body?.start_stamp;
  const recording_url=body?.recording_url;
console.log(agentNumber)
  // 🔹 Normalize numbers
  const normalize = (num: string) =>
    num?.replace(/\D/g, '').slice(-10);

  // 🔍 Find lead (single query - optimized)
  let lead = await this.leadModel.findOne({
    phone: { $in: [fullNumber, callerNumber] },
  });

  // 🎓 Not a sales lead → maybe an enrolled student (Upskillab)
  if (!lead) {
    const digits = lastTenDigits(fullNumber || callerNumber);
    const enrolled: any =
      digits.length === 10
        ? await this.enrolledLeadModel
            .findOne({
              mobileNumber: {
                $in: [digits, `91${digits}`, `+91${digits}`, fullNumber, callerNumber].filter(Boolean),
              },
            })
            .select('_id assignedTo')
            .lean()
        : null;
    if (enrolled?.assignedTo) {
      const call = await this.callLogModel.create({
        enrolledLeadId: enrolled._id,
        userId: enrolled.assignedTo.toString(),
        agentNumber: normalize(agentNumber),
        customerNumber: callerNumber,
        duration: duration,
        isFormSubmitted: false,
        recording_url,
        startedAt: new Date(startStamp),
      });
      this.socketGateway.emitCallEvent(
        call.userId.toString(),
        'call-completed',
        await this.callCompletedPayload(call),
      );
      return true;
    }
  }

  // ❌ Lead not found → unknown call
  if (!lead) {
    const user = await this.userModel.findOne({
      number: { $in: [agentNumber, normalize(agentNumber)] },
    });

    if (!user) return false;

    this.socketGateway.emitToUser(
      user._id.toString(),
      'Unknow-call',
      {
        message: 'You got an unknown call....',
        number: callerNumber,
        duration:duration,
        startStamp,
        recording_url,
      },
    );

    return true;
  }

  // ✅ Create call log
  const call = await this.callLogModel.create({
    leadId: lead.leadId,
    userId: lead.assignedTo?.toString(),
    agentNumber: normalize(agentNumber),
    customerNumber: callerNumber,
    duration: duration,
    isFormSubmitted: false,
    recording_url,
    startedAt: new Date(startStamp),
  });

  // 🔔 Notify user
  if (call.userId) {
    this.socketGateway.emitCallEvent(
      call.userId.toString(),
      'call-completed',
    {
      callId: call._id,
      leadId: call.leadId,
      duration: call.duration,
      call:call
    },
    );
  }

  console.log('Lead Found:', lead);

  return true;
}


async updateCallLog(body:any){
  const { callId, outcome, stageId,remark } = body;

  const call = await this.callLogModel.findById(callId);

    if (!call) throw new Error('Call not found');
    if (call.enrolledLeadId || !call.leadId) {
      // Enrolled-lead calls use POST /enrolled-leads/calls/:callId/feedback
      throw new BadRequestException(
        'This call is with an enrolled student; submit its details from the Enrolled Leads page',
      );
    }

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