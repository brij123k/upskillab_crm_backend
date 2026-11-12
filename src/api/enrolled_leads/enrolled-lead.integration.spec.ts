/**
 * Enrolled leads: sync from Upskillab (API mocked) + CRM actions, against an
 * in-memory MongoDB.
 */
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  EnrolledLead,
  EnrolledLeadSchema,
} from 'src/schema/enrolled_leads/enrolled-lead.schema';
import {
  EnrolledLeadHistory,
  EnrolledLeadHistorySchema,
  EnrolledLeadStage,
  EnrolledLeadStageSchema,
  EnrolledLeadSyncRun,
  EnrolledLeadSyncRunSchema,
} from 'src/schema/enrolled_leads/enrolled-lead-meta.schema';
import {
  UpskillabBatch,
  UpskillabBatchSchema,
  UpskillabCourse,
  UpskillabCourseSchema,
} from 'src/schema/enrolled_leads/upskillab-catalog.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { Reflector } from '@nestjs/core';
import { SmartfloService } from '../smartflo/smartflo.service';
import { EnrolledPermissionGuard } from './enrolled-permission.guard';
import { EnrolledLeadStageService } from './enrolled-lead-stage.service';
import { EnrolledLeadSyncService } from './enrolled-lead-sync.service';
import { EnrolledLeadService } from './enrolled-lead.service';

let mongo: MongoMemoryServer;
const m: Record<string, Model<any>> = {};
let stages: EnrolledLeadStageService;
let sync: EnrolledLeadSyncService;
let service: EnrolledLeadService;
let smartflo: SmartfloService;
const socketEvents: { userId: string; event: string; payload: any }[] = [];

const ADMIN = {
  userId: new Types.ObjectId().toString(),
  roleName: 'Admin',
  permissions: [{ module: '*', actions: ['*'] }],
};
const BD_ID = new Types.ObjectId().toString();
const BD = {
  userId: BD_ID,
  number: '9876500000',
  roleName: 'bd',
  permissions: [{ module: 'enrolled_leads', actions: ['read', 'update'] }],
};

const course = {
  _id: 'c1',
  courseName: 'Psychology',
  category: { name: 'Health' },
  language: { name: 'English' },
};
const batchNow = {
  _id: 'b1',
  batchCode: 'PSY-NOW',
  course: { _id: 'c1', courseName: 'Psychology' },
  teacher: { name: 'Dr. T' },
  status: 'Ongoing',
  startDate: '2026-10-01',
  enrolledStudents: 2,
};
const batchOld = {
  _id: 'b2',
  batchCode: 'PSY-OLD',
  course: 'c1',
  status: 'Completed',
  startDate: '2026-01-01',
};

const student = (id: string, overrides: any = {}) => ({
  studentId: id,
  userId: `u-${id}`,
  email: `${id}@Example.com`,
  mobileNumber: `9000000${id.slice(-3)}`,
  username: id,
  isActive: true,
  status: 'active',
  fullName: `Student ${id}`,
  createdAt: '2026-11-01T10:00:00Z',
  courses: ['Psychology'],
  batches: ['PSY-NOW'],
  completedBatches: [],
  ongoingBatches: ['PSY-NOW'],
  upcomingBatches: [],
  paymentSummary: {
    totalOrders: 1,
    totalAmount: 5000,
    amountPaid: 5000,
    balanceDue: 0,
  },
  orders: [
    {
      orderId: `o-${id}`,
      status: 'COMPLETED',
      batchId: { _id: 'b1', batchCode: 'PSY-NOW' },
      courseId: { _id: 'c1', courseName: 'Psychology' },
      batchStatus: 'Ongoing',
    },
  ],
  ...overrides,
});

let upstream: { students: any[]; courses: any[]; batches: any[] };
const client: any = {
  isConfigured: true,
  fetchAllStudents: async () => JSON.parse(JSON.stringify(upstream)),
};
const userLogicStub: any = { getUsersUnder: async () => [] };

beforeAll(async () => {
  process.env.PENDING_CREDIT_TIMEZONE = 'Asia/Kolkata';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'enrolled_test' });
  const reg = (name: string, schema: any) => {
    m[name] = mongoose.models[name] || mongoose.model(name, schema);
  };
  reg(EnrolledLead.name, EnrolledLeadSchema);
  reg(EnrolledLeadHistory.name, EnrolledLeadHistorySchema);
  reg(EnrolledLeadStage.name, EnrolledLeadStageSchema);
  reg(EnrolledLeadSyncRun.name, EnrolledLeadSyncRunSchema);
  reg(UpskillabCourse.name, UpskillabCourseSchema);
  reg(UpskillabBatch.name, UpskillabBatchSchema);
  reg(User.name, UserSchema);
  reg(CallLog.name, CallLogSchema);
  reg(Lead.name, LeadSchema);
  await Promise.all(Object.values(m).map((model) => model.init()));

  stages = new EnrolledLeadStageService(m.EnrolledLeadStage, m.EnrolledLead);
  await stages.onModuleInit();
  sync = new EnrolledLeadSyncService(
    m.EnrolledLead,
    m.EnrolledLeadHistory,
    m.EnrolledLeadSyncRun,
    m.UpskillabCourse,
    m.UpskillabBatch,
    client,
    stages,
  );
  const socketStub: any = {
    emitCallEvent: (userId: string, event: string, payload: any) =>
      socketEvents.push({ userId, event, payload }),
    emitToUser: (userId: string, event: string, payload: any) =>
      socketEvents.push({ userId, event, payload }),
  };
  smartflo = new SmartfloService(
    m.CallLog,
    m.Lead,
    m.User,
    socketStub,
    { log: async () => undefined } as any,
    { log: async () => undefined } as any,
    { create: async () => undefined } as any,
    m.EnrolledLead,
  );
  service = new EnrolledLeadService(
    m.EnrolledLead,
    m.EnrolledLeadHistory,
    m.UpskillabCourse,
    m.UpskillabBatch,
    m.User,
    userLogicStub,
    stages,
    sync,
    m.CallLog,
    smartflo,
  );

  await m.User.collection.insertOne({
    _id: new Types.ObjectId(BD_ID),
    name: 'Bina',
    email: 'bina@example.com',
    employeeId: 'E-1',
    number: '9999900000',
    status: 'active',
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('enrolled leads', () => {
  it('first sync imports students with the Enrolled stage, plus courses and batches', async () => {
    upstream = {
      students: [
        student('s0001'),
        student('s0002'),
        student('s0003', {
          isActive: false,
          status: 'inactive',
          orders: [],
          ongoingBatches: [],
          completedBatches: ['PSY-OLD'],
          batches: ['PSY-OLD'],
        }),
      ],
      courses: [course],
      batches: [batchNow, batchOld],
    };
    const run: any = await sync.run('MANUAL', ADMIN.userId);
    expect(run).toMatchObject({
      status: 'SUCCESS',
      studentsFetched: 3,
      newStudents: 3,
      updatedStudents: 0,
      newCourses: 1,
      newBatches: 2,
    });

    const lead: any = await m.EnrolledLead.findOne({
      studentId: 's0001',
    }).lean();
    expect(lead).toMatchObject({
      stageName: 'Enrolled',
      email: 's0001@example.com',
      courseIds: ['c1'],
      batchIds: ['b1'],
      batchStatuses: ['ongoing'],
      isActive: true,
    });
    expect(lead.raw.orders).toHaveLength(1);

    const batch: any = await m.UpskillabBatch.findOne({
      upskillabId: 'b2',
    }).lean();
    expect(batch).toMatchObject({
      batchCode: 'PSY-OLD',
      courseId: 'c1',
      courseName: 'Psychology',
      status: 'completed',
    });
    const c: any = await m.UpskillabCourse.findOne({
      upskillabId: 'c1',
    }).lean();
    expect(c).toMatchObject({ category: 'Health', language: 'English' });

    expect(
      await m.EnrolledLeadHistory.countDocuments({ actionType: 'created' }),
    ).toBe(3);
  });

  it('re-running never duplicates; adds only new students; keeps CRM stage; records status changes', async () => {
    const lead: any = await m.EnrolledLead.findOne({
      studentId: 's0001',
    }).lean();
    const called: any = await m.EnrolledLeadStage.findOne({
      name: 'Called',
    }).lean();
    await service.logActivity(
      String(lead._id),
      {
        type: 'call',
        stageId: String(called._id),
        note: 'Spoke to student',
      } as any,
      ADMIN,
    );

    upstream.students = [
      student('s0001', { isActive: false, status: 'inactive' }),
      student('s0002'),
      student('s0003', {
        isActive: false,
        status: 'inactive',
        orders: [],
        ongoingBatches: [],
        completedBatches: ['PSY-OLD'],
        batches: ['PSY-OLD'],
      }),
      student('s0004'),
    ];
    const run: any = await sync.run('CRON');
    expect(run).toMatchObject({
      newStudents: 1,
      updatedStudents: 3,
      statusChanged: 1,
      newCourses: 0,
      newBatches: 0,
    });
    expect(await m.EnrolledLead.countDocuments()).toBe(4);

    const after: any = await m.EnrolledLead.findOne({
      studentId: 's0001',
    }).lean();
    expect(after.stageName).toBe('Called'); // CRM stage kept
    expect(after.isActive).toBe(false); // upstream status refreshed
    const statusHistory: any = await m.EnrolledLeadHistory.findOne({
      enrolledLeadId: after._id,
      actionType: 'status_synced',
    }).lean();
    expect(statusHistory.changes.status).toEqual({
      from: 'active',
      to: 'inactive',
    });
  });

  it('filters by stage, active, course, batch, batch status and search', async () => {
    const meta: any = await service.meta();
    const enrolled = meta.stages.find((s: any) => s.name === 'Enrolled');
    expect(meta.batchStatuses).toEqual(['completed', 'ongoing']);
    expect(meta.statuses).toEqual(['active', 'inactive']);

    const ids = (res: any) => res.data.map((l: any) => l.studentId).sort();
    expect(
      ids(await service.list({ stageId: String(enrolled._id) } as any, ADMIN)),
    ).toEqual(['s0002', 's0003', 's0004']);
    expect(
      ids(await service.list({ active: 'inactive' } as any, ADMIN)),
    ).toEqual(['s0001', 's0003']);
    expect(
      ids(await service.list({ batchStatus: 'Completed' } as any, ADMIN)),
    ).toEqual(['s0003']);
    expect(ids(await service.list({ batchId: 'b1' } as any, ADMIN))).toEqual([
      's0001',
      's0002',
      's0004',
    ]);
    expect(
      ids(
        await service.list({ courseId: 'c1', status: 'ACTIVE' } as any, ADMIN),
      ),
    ).toEqual(['s0002', 's0004']);
    expect(ids(await service.list({ search: 'S0004' } as any, ADMIN))).toEqual([
      's0004',
    ]);

    const all: any = await service.list({} as any, ADMIN);
    expect(all.stats).toMatchObject({
      total: 4,
      active: 2,
      inactive: 2,
      unassigned: 4,
    });
    expect(all.data[0].raw).toBeUndefined(); // list stays light

    const batches: any = await service.listBatches({} as any, ADMIN);
    expect(
      batches.data.find((b: any) => b.upskillabId === 'b1').crmStudents,
    ).toBe(3);
  });

  it('non-admin users only see leads assigned to them; assignment is recorded', async () => {
    expect((await service.list({} as any, BD)).total).toBe(0);
    const lead: any = await m.EnrolledLead.findOne({
      studentId: 's0002',
    }).lean();
    await service.assign({ ids: [String(lead._id)], assignedTo: BD_ID }, ADMIN);

    const mine: any = await service.list({} as any, BD);
    expect(mine.data.map((l: any) => l.studentId)).toEqual(['s0002']);

    const detail: any = await service.getOne(String(lead._id), BD);
    expect(detail.assignedTo.name).toBe('Bina');
    expect(detail.history.map((h: any) => h.actionType)).toEqual([
      'assigned',
      'created',
    ]);
    expect(detail.batchDetails.map((b: any) => b.batchCode)).toEqual([
      'PSY-NOW',
    ]);

    const other: any = await m.EnrolledLead.findOne({
      studentId: 's0004',
    }).lean();
    await expect(service.getOne(String(other._id), BD)).rejects.toThrow(
      'not found',
    );
  });

  it('bulk stage change and a second concurrent sync is refused', async () => {
    const followUp: any = await m.EnrolledLeadStage.findOne({
      name: 'Follow Up',
    }).lean();
    const leads: any[] = await m.EnrolledLead.find().select('_id').lean();
    const res: any = await service.bulkStage(
      { ids: leads.map((l) => String(l._id)), stageId: String(followUp._id) },
      ADMIN,
    );
    expect(res.updated).toBe(4);
    expect(
      await m.EnrolledLead.countDocuments({ stageName: 'Follow Up' }),
    ).toBe(4);

    await m.EnrolledLeadSyncRun.create({
      trigger: 'MANUAL',
      status: 'RUNNING',
      startedAt: new Date(),
    });
    await expect(sync.run('MANUAL')).rejects.toThrow('already running');
  });

  it('renaming a stage updates the leads', async () => {
    const followUp: any = await m.EnrolledLeadStage.findOne({
      name: 'Follow Up',
    }).lean();
    await stages.update(String(followUp._id), { name: 'Follow-up Call' });
    expect(
      await m.EnrolledLead.countDocuments({ stageName: 'Follow-up Call' }),
    ).toBe(4);
  });
});

describe('enrolled lead calls (Smartflo)', () => {
  let leadId: string;
  let smartfloRequests: any[];

  beforeAll(async () => {
    const lead: any = await m.EnrolledLead.findOne({
      studentId: 's0002',
    }).lean();
    leadId = String(lead._id); // assigned to BD earlier
    smartfloRequests = [];
    jest
      .spyOn(smartflo as any, 'makeRequest2')
      .mockImplementation(async (_method: any, _endpoint: any, data: any) => {
        smartfloRequests.push(data);
        return { ref_id: `ref-${smartfloRequests.length}` };
      });
  });

  it('click to call rings the BDA and links the call to the enrolled lead', async () => {
    const res: any = await service.startCall(leadId, BD);
    expect(res.success).toBe(true);
    expect(smartfloRequests[0]).toMatchObject({
      agent_number: 9876500000,
      destination_number: 9000000002,
    });
    const call: any = await m.CallLog.findById(res.callId).lean();
    expect(String(call.enrolledLeadId)).toBe(leadId);
    expect(call.leadId).toBeUndefined();
  });

  it('cannot call a student that is not assigned to you', async () => {
    const other: any = await m.EnrolledLead.findOne({
      studentId: 's0004',
    }).lean();
    await expect(service.startCall(String(other._id), BD)).rejects.toThrow(
      'not found',
    );
  });

  it('webhook sends an "enrolled" call-completed event; details are required and go to history', async () => {
    await smartflo.hanldeWebhook({
      ref_id: 'ref-1',
      call_status: 'answered',
      duration: 95,
      start_stamp: '2026-11-12 11:00:00',
      recording_url: 'https://rec/1.mp3',
    });
    const event = socketEvents.find((e) => e.event === 'call-completed');
    expect(event).toBeDefined();
    expect(event!.userId).toBe(BD_ID);
    expect(event!.payload).toMatchObject({ type: 'enrolled', duration: 95 });
    expect(event!.payload.enrolledLead.fullName).toBe('Student s0002');

    const pending: any[] = await service.pendingCalls(BD);
    expect(pending).toHaveLength(1);

    // the sales-lead feedback endpoint refuses enrolled calls
    await expect(
      smartflo.updateCallLog({
        callId: String(pending[0].callId),
        outcome: 'x',
        stageId: String(new Types.ObjectId()),
      }),
    ).rejects.toThrow('enrolled student');

    const interested: any = await m.EnrolledLeadStage.findOne({
      name: 'Interested',
    }).lean();
    await service.submitCallFeedback(
      String(pending[0].callId),
      {
        stageId: String(interested._id),
        outcome: 'Connected',
        remark: 'Wants the advanced batch',
      },
      BD,
    );
    expect(await service.pendingCalls(BD)).toHaveLength(0);
    await expect(
      service.submitCallFeedback(
        String(pending[0].callId),
        { stageId: String(interested._id), outcome: 'again' },
        BD,
      ),
    ).rejects.toThrow('already submitted');

    const detail: any = await service.getOne(leadId, BD);
    expect(detail.stageName).toBe('Interested');
    expect(detail.lastActivityType).toBe('call');
    const callHistory = detail.history.find(
      (h: any) => h.actionType === 'call',
    );
    expect(callHistory).toMatchObject({
      note: 'Wants the advanced batch',
      toStage: 'Interested',
    });
    expect(callHistory.changes).toMatchObject({
      outcome: 'Connected',
      duration: 95,
      recordingUrl: 'https://rec/1.mp3',
    });

    const calls: any[] = await service.listCalls(leadId, BD);
    expect(calls[0]).toMatchObject({
      outcome: 'Connected',
      isFormSubmitted: true,
    });
  });

  it('an incoming call from an enrolled student goes to the assigned BDA', async () => {
    socketEvents.length = 0;
    await smartflo.hanldeWebhookCallDone({
      'answered_agent[agent_number]': '9876500000',
      caller_id_number: '9000000002',
      customer_no_with_prefix: '+919000000002',
      duration: 30,
      start_stamp: '2026-11-12 12:00:00',
    });
    expect(socketEvents[0]).toMatchObject({
      userId: BD_ID,
      event: 'call-completed',
    });
    expect(socketEvents[0].payload.type).toBe('enrolled');
    expect(await service.pendingCalls(BD)).toHaveLength(1);
  });

  it('full_access allows every action, but only for the leads assigned to the user', async () => {
    const guard = new EnrolledPermissionGuard(new Reflector());
    const ctx = (user: any, action: string) =>
      ({
        getHandler: () => {
          const fn = () => undefined;
          Reflect.defineMetadata(
            'permission',
            { module: 'enrolled_leads', action },
            fn,
          );
          return fn;
        },
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as any;
    const full = {
      userId: BD_ID,
      roleName: 'bd',
      permissions: [{ module: 'enrolled_leads', actions: ['full_access'] }],
    };
    for (const action of [
      'read',
      'update',
      'call',
      'assign',
      'sync',
      'manage_stages',
    ]) {
      expect(guard.canActivate(ctx(full, action))).toBe(true);
    }
    const readOnly = {
      userId: BD_ID,
      roleName: 'bd',
      permissions: [{ module: 'enrolled_leads', actions: ['read'] }],
    };
    expect(() => guard.canActivate(ctx(readOnly, 'call'))).toThrow();

    const list: any = await service.list({} as any, full);
    expect(list.data.map((l: any) => l.studentId)).toEqual(['s0002']);
  });
});
