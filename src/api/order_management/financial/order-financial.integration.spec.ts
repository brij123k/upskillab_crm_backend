/**
 * Integration tests against a real MongoDB (in-memory replica set, so that
 * transactions are exercised exactly like on the Atlas deployment).
 */
import crypto from 'crypto';
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  CoverageStatus,
  CreditStatus,
  LoanDisbursementStatus,
  Order,
  OrderSchema,
  OrderStatus,
  PaymentMode,
} from 'src/schema/order_Management/order.schema';
import { Pool, PoolSchema } from 'src/schema/Pool.schema';
import {
  LoanEmi,
  LoanEmiSchema,
} from 'src/schema/order_Management/loan-emi.schema';
import {
  Subscription,
  SubscriptionSchema,
} from 'src/schema/order_Management/subscription.schema';
import {
  SubscriptionPayment,
  SubscriptionPaymentSchema,
} from 'src/schema/order_Management/subscription-payment.schema';
import {
  SubscriptionsPlan,
  SubscriptionsPlanSchema,
} from 'src/schema/order_Management/subscriptions-plan.schema';
import {
  Payment,
  PaymentSchema,
} from 'src/schema/order_Management/payment.schema';
import {
  ProcessedPaymentEvent,
  ProcessedPaymentEventSchema,
} from 'src/schema/order_Management/processed-payment-event.schema';
import {
  CreditNotificationLog,
  CreditNotificationLogSchema,
  CreditNotificationRun,
  CreditNotificationRunSchema,
} from 'src/schema/order_Management/credit-notification.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import {
  LeadStage,
  LeadStageSchema,
} from 'src/schema/lead_management/lead-stage.schema';
import {
  LeadStageHistory,
  LeadStageHistorySchema,
} from 'src/schema/lead_management/LeadStageHistory.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { Role, RoleSchema } from 'src/schema/role.schema';
import {
  LoanPartner,
  LoanPartnerSchema,
} from 'src/schema/order_Management/loan-partner.schema';
import { OrderFinancialService } from './order-financial.service';
import {
  buildActualRevenueExpression,
  buildRevenueBreakdownExpressions,
  buildUnrealisedRevenueExpression,
  calculateActualRevenue,
  calculateUnrealisedRevenue,
  getBusinessTimezone,
  startOfDayInTimezone,
  toDateKey,
} from './order-financial.util';
import { OrderService } from '../order.service';
import { PendingCreditService } from '../credits/pending-credit.service';
import { PendingCreditNotificationService } from '../credits/pending-credit-notification.service';
import { PaymentService } from '../payment/payment.service';
import { PaymentController } from '../payment/payment.controller';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  migrateOrderPayments,
  rollbackOrderPayments,
  verifyMigratedOrders,
} from 'src/scripts/migrations/migrate-order-payments';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';

// The real engine imports notification.schema.ts, whose enum-typed @Prop
// cannot be reflected under ts-jest isolatedModules; a stub is injected below.
jest.mock('src/notifications/services/notification-engine.service', () => ({
  NotificationEngineService: class NotificationEngineService {},
}));

jest.setTimeout(180000);

let replSet: MongoMemoryReplSet;
const m: Record<string, Model<any>> = {};
let financial: OrderFinancialService;
let orderService: OrderService;
let pendingCredits: PendingCreditService;
let notifications: PendingCreditNotificationService;
let notificationCalls: any[];

const ADMIN = new Types.ObjectId().toString();
const BD = new Types.ObjectId().toString();
const BD_SUB = new Types.ObjectId().toString();
const OTHER_BD = new Types.ObjectId().toString();
const LOAN_PARTNER = new Types.ObjectId().toString();
let poolId: Types.ObjectId;

const fullPermissions = [{ module: '*', actions: ['*'] }];
const adminUser = {
  userId: ADMIN,
  roleName: 'Admin',
  permissions: fullPermissions,
};
const bdUser = (permissions: string[] = ['create', 'read', 'update']) => ({
  userId: BD,
  roleName: 'bd',
  permissions: [{ module: PERMISSIONS.Orders.MODULE, actions: permissions }],
});

const userLogicStub: any = {
  findById: async (id: string) => ({ _id: id, name: `User ${id.slice(-4)}` }),
  getUsersUnder: async (user: any) =>
    String(user?.userId) === BD ? [{ _id: new Types.ObjectId(BD_SUB) }] : [],
  getDirectUsersUnder: async () => [],
};
const activityStub: any = { log: async () => undefined };

const TZ = 'Asia/Kolkata';
/** A Date at 12:00 business time, `offset` days from today. */
function businessDay(offset: number, base = new Date()) {
  const start = startOfDayInTimezone(toDateKey(base, TZ), TZ);
  return new Date(start.getTime() + offset * 86_400_000 + 12 * 3_600_000);
}

let emailCounter = 0;
function baseOrderDto(overrides: any = {}) {
  emailCounter++;
  return {
    mobile: `90000${String(emailCounter).padStart(5, '0')}`,
    email: `student${emailCounter}@example.com`,
    studentName: `Student ${emailCounter}`,
    fatherName: 'F',
    dob: '2000-01-01',
    education: 'B.Tech',
    address: 'Addr',
    city: 'Pune',
    state: 'Maharashtra',
    courseVertical: poolId.toString(),
    courseName: 'Data Science',
    courseDuration: '6 months',
    totalFee: 100000,
    finalFee: 100000,
    discount: 0,
    GSTEnabled: false,
    GSTAmount: 0,
    orderDate: new Date('2025-06-15T06:00:00Z'),
    feeDepositDate: new Date('2025-06-15T06:00:00Z'),
    remarks: 'test',
    ...overrides,
  };
}

function sign(raw: string, secret: string) {
  const timestamp = String(Date.now());
  return {
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}${raw}`)
      .digest('base64'),
  };
}

function webhookRequest(body: any, secret?: string) {
  const raw = JSON.stringify(body);
  return {
    body,
    rawBody: Buffer.from(raw),
    headers: secret ? sign(raw, secret) : {},
  };
}

beforeAll(async () => {
  process.env.PENDING_CREDIT_TIMEZONE = TZ;
  process.env.CASHFREE_SECRET_KEY = 'test-secret';
  delete process.env.CASHFREE_WEBHOOK_SECRET;
  delete process.env.CASHFREE_WEBHOOK_SIGNATURE_REQUIRED;

  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'crm_test' });

  const reg = (name: string, schema: any) => {
    m[name] = mongoose.models[name] || mongoose.model(name, schema);
  };
  reg(Order.name, OrderSchema);
  reg(Pool.name, PoolSchema);
  reg(LoanEmi.name, LoanEmiSchema);
  reg(Subscription.name, SubscriptionSchema);
  reg(SubscriptionPayment.name, SubscriptionPaymentSchema);
  reg(SubscriptionsPlan.name, SubscriptionsPlanSchema);
  reg(Payment.name, PaymentSchema);
  reg(ProcessedPaymentEvent.name, ProcessedPaymentEventSchema);
  reg(CreditNotificationLog.name, CreditNotificationLogSchema);
  reg(CreditNotificationRun.name, CreditNotificationRunSchema);
  reg(Lead.name, LeadSchema);
  reg(LeadStage.name, LeadStageSchema);
  reg(LeadStageHistory.name, LeadStageHistorySchema);
  reg(CallLog.name, CallLogSchema);
  reg(User.name, UserSchema);
  reg(Role.name, RoleSchema);
  reg(LoanPartner.name, LoanPartnerSchema);
  await Promise.all(Object.values(m).map((model) => model.init()));

  financial = new OrderFinancialService(
    mongoose.connection,
    m.Order,
    m.LoanEmi,
    m.ProcessedPaymentEvent,
    m.Subscription,
    m.SubscriptionPayment,
  );
  orderService = new OrderService(
    m.Order,
    m.Pool,
    m.LoanEmi,
    m.Subscription,
    m.Lead,
    m.CallLog,
    m.User,
    m.Role,
    m.LeadStage,
    m.LeadStageHistory,
    userLogicStub,
    {} as any,
    activityStub,
    financial,
  );
  pendingCredits = new PendingCreditService(m.Order, userLogicStub);
  notificationCalls = [];
  notifications = new PendingCreditNotificationService(
    m.Order,
    m.CreditNotificationLog,
    m.CreditNotificationRun,
    m.User,
    m.Role,
    {
      handleEvent: async (payload: any) => void notificationCalls.push(payload),
    } as any,
  );

  const pool = await m.Pool.collection.insertOne({
    name: 'Data Science Pool',
    revenue_percentage: 100,
  });
  poolId = pool.insertedId as Types.ObjectId;
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

/* =========================================================================
   AGGREGATION EXPRESSION == JS CALCULATION (single source of truth)
   ========================================================================= */

describe('aggregation expressions match the JS calculation', () => {
  it('produces identical revenue / breakdown / unrealised values for legacy and v2 orders', async () => {
    const docs: any[] = [
      {
        paymentMode: 'Lumpsum',
        finalFee: 1000,
        lumpsumDetails: { totalReceived: 400, pendingAmount: 600 },
      },
      {
        paymentMode: 'Loan',
        finalFee: 1000,
        loanDetails: { loanAmount: 900, disbursementAmount: 850 },
      },
      {
        paymentMode: 'Subscription',
        finalFee: 1000,
        subscriptionDetails: {
          installmentAmount: 100,
          numberOfInstallments: 10,
        },
      },
      {
        paymentSchemaVersion: 2,
        finalFee: 100000,
        lumpsumPayments: [
          { amount: 20000, amountReceived: 20000, status: 'Received' },
          { amount: 5000, amountReceived: 0, status: 'Failed' },
          { amount: 3000, amountReceived: 3000, status: 'Refunded' },
        ],
        loans: [
          {
            loanAmount: 30000,
            disbursementAmount: 25000.5,
            disbursementStatus: 'Disbursed',
          },
          {
            loanAmount: 10000,
            disbursementAmount: 0,
            disbursementStatus: 'Pending',
          },
          {
            loanAmount: 10000,
            disbursementAmount: 0,
            disbursementStatus: 'Cancelled',
          },
        ],
        subscriptions: [
          {
            installmentAmount: 5000,
            numberOfInstallments: 6,
            paymentHistory: [
              { gatewayPaymentId: 'a', amount: 5000, status: 'SUCCESS' },
              { gatewayPaymentId: 'b', amount: 5000, status: 'FAILED' },
              { gatewayPaymentId: 'c', amount: 5000, status: 'SUCCESS' },
            ],
          },
          {
            installmentAmount: 1000,
            numberOfInstallments: 2,
            paymentHistory: [],
          },
        ],
        credits: [
          { amount: 7000, status: 'Paid', paymentReferenceId: 'x' },
          { amount: 3000, status: 'Overdue' },
          { amount: 2000, status: 'Pending' },
        ],
      },
      { paymentSchemaVersion: 2, finalFee: 500 },
    ];
    for (let i = 0; i < 25; i++) {
      docs.push({
        paymentSchemaVersion: 2,
        finalFee: 50000,
        lumpsumPayments: [
          {
            amount: 10000 + i,
            amountReceived: i * 100,
            status: 'Partially Received',
          },
        ],
        credits: [
          { amount: 100 * i, status: i % 3 === 0 ? 'Paid' : 'Pending' },
        ],
      });
    }
    const collection = mongoose.connection.db!.collection('parity_orders');
    await collection.insertMany(docs.map((d) => ({ ...d })));
    const rows = await collection
      .aggregate([
        {
          $project: {
            doc: '$$ROOT',
            revenue: buildActualRevenueExpression(),
            unrealised: buildUnrealisedRevenueExpression(),
            ...buildRevenueBreakdownExpressions(),
          },
        },
      ])
      .toArray();
    expect(rows).toHaveLength(docs.length);
    for (const row of rows) {
      const js = calculateActualRevenue(row.doc);
      expect(row.revenue).toBeCloseTo(js.total, 2);
      expect(row.lumpsumRevenue).toBeCloseTo(js.lumpsum, 2);
      expect(row.loanRevenue).toBeCloseTo(js.loan, 2);
      expect(row.subscriptionRevenue).toBeCloseTo(js.subscription, 2);
      expect(row.creditRevenue).toBeCloseTo(js.credit, 2);
      expect(row.unrealised).toBeCloseTo(
        calculateUnrealisedRevenue(row.doc),
        2,
      );
    }
    const complex = rows.find((r) => r.doc.finalFee === 100000);
    expect(complex!.revenue).toBe(20000 + 25000.5 + 10000 + 7000);
  });
});

/* =========================================================================
   ORDER CREATE / UPDATE / APPROVE
   ========================================================================= */

describe('order create / update / approve', () => {
  it('creates a multi-source order with credits and loan EMI trackers in one transaction', async () => {
    const order: any = await orderService.createOrder(
      baseOrderDto({
        lumpsumPayments: [
          {
            amount: 20000,
            amountReceived: 20000,
            transactionId: 'UTR-1',
            paymentMode: 'UPI',
          },
        ],
        loans: [
          {
            loanPartner: LOAN_PARTNER,
            loanAmount: 30000,
            firstEmiDate: '2025-07-05',
          },
        ],
        subscriptions: [
          {
            installmentAmount: 5000,
            numberOfInstallments: 6,
            firstInstallmentDate: '2025-07-01',
          },
        ],
        credits: [
          { amount: 10000, dueDate: '2025-11-10' },
          { amount: 5000, dueDate: '2025-11-20' },
          { amount: 5000, dueDate: '2025-11-30' },
        ],
      }),
      BD,
    );
    const saved: any = await m.Order.findById(order._id).lean();
    expect(saved.paymentSchemaVersion).toBe(2);
    expect(saved.paymentMode).toBe(PaymentMode.MIXED);
    expect(saved.paymentSummary).toMatchObject({
      plannedPaymentCoverage: 80000,
      totalCredits: 20000,
      coverageStatus: CoverageStatus.BALANCED,
      // lumpsum 20000 received + loan 30000 counted with its loan amount
      actualReceivedRevenue: 50000,
      reportedRevenue: 20000,
    });
    expect(saved.lumpsumDetails.totalReceived).toBe(20000);
    expect(saved.loans[0].loanId).toBeDefined();
    expect(saved.loanDetails.loanId.toString()).toBe(
      saved.loans[0].loanId.toString(),
    );
    const emi: any = await m.LoanEmi.findById(saved.loans[0].loanId).lean();
    expect(emi.orderId.toString()).toBe(saved._id.toString());
    expect(emi.thirdEmiDate).toBeInstanceOf(Date);
    expect(saved.financialAuditLog[0].action).toBe('ORDER_CREATED');
  });

  it('rejects unbalanced orders with a descriptive error and writes nothing', async () => {
    const before = await m.Order.countDocuments();
    await expect(
      orderService.createOrder(
        baseOrderDto({
          lumpsumPayments: [{ amount: 20000 }],
          loans: [{ loanPartner: LOAN_PARTNER, loanAmount: 30000 }],
          credits: [{ amount: 10000, dueDate: '2025-11-10' }],
        }),
        BD,
      ),
    ).rejects.toMatchObject({
      response: {
        errors: [
          expect.stringContaining(
            'Credits total (10000) must equal the remaining amount (50000)',
          ),
        ],
      },
    });
    expect(await m.Order.countDocuments()).toBe(before);
  });

  it('rolls back loan trackers when the order insert fails (transaction)', async () => {
    const dto = baseOrderDto({
      loans: [{ loanPartner: LOAN_PARTNER, loanAmount: 100000 }],
    });
    await orderService.createOrder(dto, BD);
    const emisBefore = await m.LoanEmi.countDocuments();
    await expect(
      orderService.createOrder({ ...dto, mobile: '1' }, BD),
    ).rejects.toThrow('email already exists');
    expect(await m.LoanEmi.countDocuments()).toBe(emisBefore);
  });

  it('accepts the legacy single-object payload of old clients', async () => {
    const order: any = await orderService.createOrder(
      baseOrderDto({
        paymentMode: PaymentMode.LUMPSUM,
        lumpsumDetails: { totalReceived: 30000, paymentType: 'UPI' },
      }),
      BD,
    );
    expect(order.lumpsumPayments).toHaveLength(1);
    expect(order.lumpsumPayments[0]).toMatchObject({
      amount: 100000,
      amountReceived: 30000,
    });
    expect(order.lumpsumDetails.pendingAmount).toBe(70000);
    expect(order.status).toBe(OrderStatus.PARTIALLY_PAID);

    // Old client editing the same order through PATCH /order/:id
    const updated: any = await orderService.update(
      order._id.toString(),
      {
        paymentMode: 'Lumpsum',
        lumpsumDetails: { totalReceived: 45000 },
        city: 'Mumbai',
      },
      { userId: BD, permissions: fullPermissions },
    );
    expect(updated.city).toBe('Mumbai');
    expect(
      updated.lumpsumPayments[0].receipts.map((r: any) => r.amount),
    ).toEqual([30000, 15000]);
  });

  it('blocks approval of an unbalanced (legacy) order and approves once credits are added', async () => {
    const legacy = await m.Order.collection.insertOne({
      mobile: '8000000001',
      email: 'legacy-loan@example.com',
      studentName: 'Legacy Loan',
      courseVertical: poolId.toString(),
      counsellorId: BD /* stored as string, like production */,
      paymentMode: 'Loan',
      finalFee: 30001,
      status: 'Fully Paid',
      Approved: false,
      orderDate: new Date('2025-06-10'),
      loanDetails: {
        loanPartner: new Types.ObjectId(LOAN_PARTNER),
        loanAmount: 28000,
        disbursementAmount: 0,
      },
    });
    const id = legacy.insertedId.toString();
    await expect(orderService.approveOrder(id, ADMIN)).rejects.toMatchObject({
      response: {
        errors: [expect.stringContaining('remaining amount (2001)')],
      },
    });

    const summary: any = await orderService.getFinancialSummary(id);
    expect(summary.migrated).toBe(false);
    expect(summary.coverage.remainingAmount).toBe(2001);

    await orderService.updateFinancials(
      id,
      { credits: [{ amount: 2001, dueDate: businessDay(5).toISOString() }] },
      adminUser,
    );
    const approved: any = await orderService.approveOrder(id, ADMIN);
    expect(approved.Approved).toBe(true);
    const stored: any = await m.Order.findById(id).lean();
    expect(stored.paymentSchemaVersion).toBe(2);
    expect(stored.loans[0].disbursementStatus).toBe(
      LoanDisbursementStatus.PENDING,
    );
    expect(stored.financialAuditLog.map((a: any) => a.action)).toEqual(
      expect.arrayContaining(['AUTO_UPGRADE_TO_V2', 'ADD', 'ORDER_APPROVED']),
    );
  });

  it('protects approved orders, received payments and paid credits', async () => {
    const order: any = await orderService.createOrder(
      baseOrderDto({
        lumpsumPayments: [
          { amount: 60000, amountReceived: 10000, transactionId: 'UTR-P' },
        ],
        credits: [{ amount: 40000, dueDate: businessDay(3).toISOString() }],
      }),
      BD,
    );
    const id = order._id.toString();
    await orderService.approveOrder(id, ADMIN);

    // generic update of approved order is still blocked (existing rule)
    await expect(
      orderService.update(id, { city: 'X' }, adminUser),
    ).rejects.toThrow('Cannot update approved order');
    // financial change on an approved order requires the approve permission
    await expect(
      orderService.updateFinancials(
        id,
        {
          credits: [
            {
              _id: order.credits[0]._id.toString(),
              dueDate: businessDay(9).toISOString(),
            },
          ],
        },
        bdUser(),
      ),
    ).rejects.toThrow('approval permission');
    // admin can reschedule the credit
    await orderService.updateFinancials(
      id,
      {
        credits: [
          {
            _id: order.credits[0]._id.toString(),
            dueDate: businessDay(9).toISOString(),
          },
        ],
      },
      adminUser,
    );
    // recording money requires record_payment
    await expect(
      financial.updateFinancials(
        id,
        {
          lumpsumPayments: [
            {
              _id: order.lumpsumPayments[0]._id.toString(),
              amountReceived: 20000,
            },
          ],
        },
        {
          userId: BD,
          permissions: [{ module: 'orders', actions: ['update', 'approve'] }],
        },
      ),
    ).rejects.toThrow('record_payment');

    // mark credit paid, then the reference cannot be reused, then revert
    const creditId = order.credits[0]._id.toString();
    await orderService.markCreditPaid(
      id,
      creditId,
      { paymentReferenceId: 'UTR-CREDIT-1', amount: 40000 },
      adminUser,
    );
    let stored: any = await m.Order.findById(id).lean();
    expect(stored.credits[0].status).toBe(CreditStatus.PAID);
    expect(stored.paymentSummary.actualReceivedRevenue).toBe(50000);

    const other: any = await orderService.createOrder(
      baseOrderDto({
        finalFee: 40000,
        totalFee: 40000,
        credits: [{ amount: 40000, dueDate: businessDay(2).toISOString() }],
      }),
      BD,
    );
    await expect(
      orderService.markCreditPaid(
        other._id.toString(),
        other.credits[0]._id.toString(),
        { paymentReferenceId: 'utr-credit-1', amount: 40000 },
        adminUser,
      ),
    ).rejects.toThrow('already been used');

    await expect(
      orderService.revertCreditPayment(
        id,
        creditId,
        'mistake',
        bdUser(['update', 'record_payment']),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await orderService.revertCreditPayment(
      id,
      creditId,
      'cheque bounced',
      adminUser,
    );
    stored = await m.Order.findById(id).lean();
    expect(stored.credits[0].status).toBe(CreditStatus.PENDING);
    expect(stored.paymentSummary.actualReceivedRevenue).toBe(10000);
    // reference released after revert
    await orderService.markCreditPaid(
      id,
      creditId,
      { paymentReferenceId: 'UTR-CREDIT-1', amount: 40000 },
      adminUser,
    );
  });

  it('restricts order financials to the owner and their team', async () => {
    const own: any = await orderService.createOrder(
      baseOrderDto({ lumpsumPayments: [{ amount: 100000 }] }),
      BD_SUB,
    );
    const foreign: any = await orderService.createOrder(
      baseOrderDto({ lumpsumPayments: [{ amount: 100000 }] }),
      OTHER_BD,
    );
    await expect(
      orderService.assertOrderAccess(own._id.toString(), bdUser()),
    ).resolves.toBeUndefined();
    await expect(
      orderService.assertOrderAccess(foreign._id.toString(), bdUser()),
    ).rejects.toThrow('do not have access');
    await expect(
      orderService.assertOrderAccess(foreign._id.toString(), adminUser),
    ).resolves.toBeUndefined();
  });
});

/* =========================================================================
   PAYMENTS / WEBHOOKS – IDEMPOTENCY
   ========================================================================= */

describe('payment application is idempotent', () => {
  let orderId: string;
  let creditId: string;

  beforeAll(async () => {
    const order: any = await orderService.createOrder(
      baseOrderDto({
        lumpsumPayments: [{ amount: 50000 }],
        credits: [{ amount: 50000, dueDate: businessDay(-2).toISOString() }],
      }),
      BD,
    );
    orderId = order._id.toString();
    creditId = order.credits[0]._id.toString();
    await orderService.approveOrder(orderId, ADMIN);
  });

  it('applies a retried gateway payment only once (sequential and concurrent retries)', async () => {
    const first = await financial.recordLinkPayment({
      orderId,
      amount: 10000,
      gatewayPaymentKey: 'link1:tx1',
    });
    const second = await financial.recordLinkPayment({
      orderId,
      amount: 10000,
      gatewayPaymentKey: 'link1:tx1',
    });
    expect(first.status).toBe('APPLIED');
    expect(second.status).toBe('DUPLICATE');

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () =>
        financial.recordLinkPayment({
          orderId,
          amount: 5000,
          gatewayPaymentKey: 'link2:tx2',
        }),
      ),
    );
    expect(concurrent.filter((r) => r.status === 'APPLIED')).toHaveLength(1);

    const stored: any = await m.Order.findById(orderId).lean();
    expect(stored.lumpsumPayments[0].amountReceived).toBe(15000);
    expect(
      await m.ProcessedPaymentEvent.countDocuments({ orderId: stored._id }),
    ).toBe(2);
  });

  it('marks a credit Paid from a verified gateway payment', async () => {
    await financial.recordLinkPayment({
      orderId,
      amount: 50000,
      gatewayPaymentKey: 'link3:tx3',
      creditId,
      referenceId: 'tx3',
    });
    const stored: any = await m.Order.findById(orderId).lean();
    expect(stored.credits[0]).toMatchObject({
      status: CreditStatus.PAID,
      paidVia: 'GATEWAY',
      paymentReferenceId: 'tx3',
    });
    expect(stored.paymentSummary.creditsReceived).toBe(50000);
  });

  it('payment-link webhook: signed events are applied once, unsigned events are stored but not applied', async () => {
    const order: any = await orderService.createOrder(
      baseOrderDto({ lumpsumPayments: [{ amount: 100000 }] }),
      BD,
    );
    const id = order._id.toString();
    await orderService.approveOrder(id, ADMIN);

    const paymentService = new PaymentService(
      orderService,
      m.Subscription,
      m.SubscriptionsPlan,
      m.Payment,
      m.Order,
      m.Lead,
      userLogicStub,
      activityStub,
      { log: async () => undefined } as any,
    );
    const controller = new PaymentController(
      paymentService,
      orderService,
      m.Subscription,
      m.Payment,
      m.Order,
      m.Lead,
      activityStub,
      m.LeadStage,
      {} as any,
      financial,
    );
    const body = (txId: number, amount: number) => ({
      type: 'PAYMENT_LINK_EVENT',
      event_time: '2025-07-01T10:00:00+05:30',
      data: {
        link_id: `link_${id}`,
        link_amount_paid: amount,
        link_notes: { orderId: id, userId: BD },
        order: {
          order_id: `cf_${txId}`,
          transaction_id: txId,
          transaction_status: 'SUCCESS',
          order_amount: amount,
        },
      },
    });

    await controller.webhook(
      body(111, 25000),
      webhookRequest(body(111, 25000), 'test-secret'),
    );
    await controller.webhook(
      body(111, 25000),
      webhookRequest(body(111, 25000), 'test-secret'),
    ); // retry
    await controller.webhook(body(222, 5000), webhookRequest(body(222, 5000))); // unsigned

    const stored: any = await m.Order.findById(id).lean();
    expect(stored.paymentSummary.lumpsumReceived).toBe(25000);
    expect(stored.lumpsumDetails.totalReceived).toBe(25000);
    const payments: any[] = await m.Payment.find({
      link_id: `link_${id}`,
    }).lean();
    expect(payments).toHaveLength(2);
    expect(
      payments.find((p) => p.transaction_id === 111).financialApplication
        .status,
    ).toBe('APPLIED');
    expect(
      payments.find((p) => p.transaction_id === 222).financialApplication
        .status,
    ).toBe('SKIPPED_UNVERIFIED');
  });

  it('payment link amount is validated against the target', async () => {
    const paymentService = new PaymentService(
      orderService,
      m.Subscription,
      m.SubscriptionsPlan,
      m.Payment,
      m.Order,
      m.Lead,
      userLogicStub,
      activityStub,
      {} as any,
    );
    await expect(
      paymentService.validatePaymentLinkTarget({ orderId, amount: 50000 }),
    ).rejects.toThrow('Amount should be 35000');
    const order: any = await orderService.createOrder(
      baseOrderDto({
        lumpsumPayments: [{ amount: 90000 }],
        credits: [{ amount: 10000, dueDate: businessDay(1).toISOString() }],
      }),
      BD,
    );
    await expect(
      paymentService.validatePaymentLinkTarget({
        orderId: order._id.toString(),
        amount: 9000,
        creditId: order.credits[0]._id.toString(),
      }),
    ).rejects.toThrow('Amount should be 10000 for this credit');
    await expect(
      paymentService.validatePaymentLinkTarget({
        orderId: order._id.toString(),
        amount: 10000,
        creditId: order.credits[0]._id.toString(),
      }),
    ).resolves.toBeUndefined();
  });

  it('subscription webhook: successful installments counted once, retries ignored', async () => {
    process.env.CASHFREE_WEBHOOK_SECRET = 'sub-secret';
    const order: any = await orderService.createOrder(
      baseOrderDto({
        lumpsumPayments: [{ amount: 70000 }],
        subscriptions: [
          {
            installmentAmount: 5000,
            numberOfInstallments: 6,
            firstInstallmentDate: '2025-07-01',
          },
        ],
      }),
      BD,
    );
    const id = order._id.toString();
    const entryId = order.subscriptions[0]._id.toString();
    const sub = await m.Subscription.create({
      orderId: order._id,
      orderSubscriptionEntryId: order.subscriptions[0]._id,
      subscriptionId: `sub_${id}`,
      cashfreeSubscriptionId: `session_${id}`,
      installmentAmount: 5000,
      numberOfInstallments: 6,
      installments: Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 1,
        dueDate: new Date(2025, 6 + i, 1),
        amount: 5000,
      })),
      status: 'ACTIVE',
    });
    await financial.linkSubscriptionEntry(id, entryId, {
      gatewaySubscriptionId: sub.subscriptionId,
      cashfreeSubscriptionId: sub.cashfreeSubscriptionId,
      subscriptionRef: sub._id,
    });

    const subscriptionService = new SubscriptionService(
      m.Subscription,
      m.SubscriptionPayment,
      m.Order,
      m.SubscriptionsPlan,
      financial,
    );
    const event = (cfPaymentId: string, schedule: string) => ({
      type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
      event_time: `${schedule}T10:00:00+05:30`,
      data: {
        subscription_details: { subscription_id: sub.subscriptionId },
        cf_payment_id: cfPaymentId,
        payment_amount: 5000,
        payment_status: 'SUCCESS',
        payment_schedule_date: `${schedule}T00:00:00+05:30`,
      },
    });
    await subscriptionService.webhook(
      webhookRequest(event('cf-1', '2025-07-01'), 'sub-secret'),
    );
    const retry = await subscriptionService.webhook(
      webhookRequest(event('cf-1', '2025-07-01'), 'sub-secret'),
    );
    await subscriptionService.webhook(
      webhookRequest(event('cf-2', '2025-08-01'), 'sub-secret'),
    );
    expect(retry.message).toBe('Duplicate payment event ignored');

    const stored: any = await m.Order.findById(id).lean();
    expect(
      stored.subscriptions[0].paymentHistory.map(
        (p: any) => p.gatewayPaymentId,
      ),
    ).toEqual(['cf-1', 'cf-2']);
    expect(stored.subscriptions[0].totalReceived).toBe(10000);
    expect(stored.paymentSummary.subscriptionReceived).toBe(10000);
    expect(stored.paymentSummary.plannedSubscriptionAmount).toBe(30000);
    const updatedSub: any = await m.Subscription.findById(sub._id).lean();
    expect(updatedSub.installments.filter((i: any) => i.isPaid)).toHaveLength(
      2,
    );
    expect(
      await m.SubscriptionPayment.countDocuments({ orderId: order._id }),
    ).toBe(2);
    delete process.env.CASHFREE_WEBHOOK_SECRET;
  });
});

/* =========================================================================
   REVENUE REPORTS
   ========================================================================= */

describe('revenue reports use actual received revenue', () => {
  const YEAR = 2024;
  beforeAll(async () => {
    const seed = async (dto: any, counsellor: string, approve = true) => {
      const order: any = await orderService.createOrder(
        baseOrderDto(dto),
        counsellor,
      );
      if (approve) await orderService.approveOrder(order._id.toString(), ADMIN);
      return order;
    };
    // March: lumpsum 30k received (BD)
    await seed(
      {
        mobile: '7000000001',
        state: 'Kerala',
        orderDate: new Date(Date.UTC(YEAR, 2, 15, 6)),
        lumpsumPayments: [{ amount: 100000, amountReceived: 30000 }],
      },
      BD,
    );
    // March: loan disbursed 60k of 100k (BD_SUB)
    await seed(
      {
        mobile: '7000000002',
        state: 'Goa',
        orderDate: new Date(Date.UTC(YEAR, 2, 20, 6)),
        loans: [
          {
            loanPartner: LOAN_PARTNER,
            loanAmount: 100000,
            disbursementAmount: 60000,
          },
        ],
      },
      BD_SUB,
    );
    // July: subscription with 2 successful payments + paid credit (OTHER_BD)
    const sub = await seed(
      {
        mobile: '7000000003',
        state: 'Kerala',
        orderDate: new Date(Date.UTC(YEAR, 6, 10, 6)),
        subscriptions: [
          {
            installmentAmount: 10000,
            numberOfInstallments: 9,
            firstInstallmentDate: '2024-07-10',
          },
        ],
        credits: [{ amount: 10000, dueDate: '2024-07-30' }],
      },
      OTHER_BD,
    );
    await financial.recordSubscriptionPayment({
      orderId: sub._id.toString(),
      gatewayPaymentId: `y-${YEAR}-1`,
      amount: 10000,
    });
    await financial.recordSubscriptionPayment({
      orderId: sub._id.toString(),
      gatewayPaymentId: `y-${YEAR}-2`,
      amount: 10000,
    });
    await financial.recordSubscriptionPayment({
      orderId: sub._id.toString(),
      gatewayPaymentId: `y-${YEAR}-2`,
      amount: 10000,
    }); // retry
    await orderService.markCreditPaid(
      sub._id.toString(),
      sub.credits[0]._id.toString(),
      { paymentReferenceId: `UTR-${YEAR}`, amount: 10000 },
      adminUser,
    );
    // July: unapproved order with money received → excluded
    await seed(
      {
        mobile: '7000000004',
        state: 'Kerala',
        orderDate: new Date(Date.UTC(YEAR, 6, 12, 6)),
        lumpsumPayments: [{ amount: 100000, amountReceived: 99000 }],
      },
      BD,
      false,
    );
    // July: pending credits only → no revenue
    await seed(
      {
        mobile: '7000000005',
        state: 'Goa',
        orderDate: new Date(Date.UTC(YEAR, 6, 14, 6)),
        lumpsumPayments: [{ amount: 50000 }],
        credits: [{ amount: 50000, dueDate: '2024-08-01' }],
      },
      BD,
    );
    // Legacy approved lumpsum order (not migrated) in December
    await m.Order.collection.insertOne({
      mobile: '7000000006',
      email: `legacy-${YEAR}@example.com`,
      studentName: 'Legacy',
      state: 'Goa',
      courseVertical: poolId.toString(),
      counsellorId: BD /* stored as string, like production */,
      paymentMode: 'Lumpsum',
      finalFee: 20000,
      Approved: true,
      status: 'Partially Paid',
      orderDate: new Date(Date.UTC(YEAR, 11, 5, 6)),
      lumpsumDetails: { totalReceived: 5000, pendingAmount: 15000 },
    });
  });

  it('monthly / yearly revenue graph (admin) counts approved received revenue only', async () => {
    const result: any = await orderService.monthlyRevenueGraph(
      { year: YEAR },
      { userId: ADMIN, roleName: 'Admin' },
    );
    const byMonth = Object.fromEntries(
      result.data.map((d: any) => [d.month, d.revenue]),
    );
    expect(byMonth.Mar).toBe(90000);
    expect(byMonth.Jul).toBe(30000); // 2 installments + paid credit; unapproved & pending excluded
    expect(byMonth.Dec).toBe(5000); // legacy rule for unmigrated order
    expect(result.totalRevenue).toBe(125000);
  });

  it('counsellor scope: bd sees own + team orders only', async () => {
    const result: any = await orderService.monthlyRevenueGraph(
      { year: YEAR },
      { userId: BD, roleName: 'bd' },
    );
    expect(result.totalRevenue).toBe(30000 + 60000 + 5000);
  });

  describe('counsellor-wise / team-wise reports', () => {
    beforeAll(async () => {
      const role = await m.Role.collection.insertOne({
        name: 'BD',
        level: 1,
        permissions: [],
      });
      await m.User.collection.insertMany(
        [BD, BD_SUB, OTHER_BD].map((id, i) => ({
          _id: new Types.ObjectId(id),
          name: ['Bina', 'Sub', 'Omar'][i],
          email: `u${i}@example.com`,
          employeeId: `EMP-${i}`,
          number: `99999000${i}`,
          role: role.insertedId,
          status: 'active',
          isBlocked: false,
        })),
      );
    });

    const march = {
      orderCreatedDateFrom: `${YEAR}-03-01`,
      orderCreatedDateTo: `${YEAR}-03-31`,
    };

    it('consultant performance report (counsellor-wise) uses received revenue', async () => {
      const result: any = await orderService.consultantPerformanceReport(march);
      const byId = Object.fromEntries(
        result.employees.map((e: any) => [String(e.consultantId), e]),
      );
      // existing hierarchy roll-up: a root row includes its subordinates
      expect(byId[BD].realisedRevenue).toBe(90000);
      expect(byId[BD_SUB].realisedRevenue).toBe(60000);
      expect(byId[OTHER_BD].realisedRevenue).toBe(0);
      // unrealised: lumpsum 70k still planned for BD; loan 40k undisbursed for BD_SUB
      expect(byId[BD].unrealisedRevenue).toBe(110000);
      expect(byId[BD_SUB].unrealisedRevenue).toBe(40000);

      const july: any = await orderService.consultantPerformanceReport({
        orderCreatedDateFrom: `${YEAR}-07-01`,
        orderCreatedDateTo: `${YEAR}-07-31`,
      });
      const omar = july.employees.find(
        (e: any) => String(e.consultantId) === OTHER_BD,
      );
      expect(omar.realisedRevenue).toBe(30000);
      const bina = july.employees.find(
        (e: any) => String(e.consultantId) === BD,
      );
      expect(bina.realisedRevenue).toBe(0); // unapproved + pending-credit-only orders
    });

    it('consultant performance details list received revenue per order', async () => {
      const result: any = await orderService.consultantPerformanceDetails({
        ...march,
        counsellorId: BD_SUB,
        type: 'orders',
      });
      const orders = result.data;
      expect(orders.map((o: any) => o.revenue)).toEqual([60000]);
      expect(orders[0].revenueBreakdown).toMatchObject({
        loan: 60000,
        total: 60000,
      });
    });

    it('team view aggregates the team of a counsellor', async () => {
      const result: any = await orderService.consultantPerformanceReport({
        ...march,
        team: 'true',
        counsellorId: BD,
      });
      const total = result.employees.reduce(
        (s: number, e: any) => s + (e.realisedRevenue || 0),
        0,
      );
      expect(total).toBe(90000);
    });

    it('employee pool revenue report (course/pool-wise, monthly)', async () => {
      const result: any = await orderService.employeePoolRevenueReport({
        fromDate: `${YEAR}-03-01`,
        toDate: `${YEAR}-03-31`,
      });
      expect(result.totalRevenue).toBe(90000);
      const orders = result.employees.flatMap((e: any) =>
        (e.pools || []).flatMap((p: any) =>
          (p.months || []).flatMap((mo: any) => mo.orders || []),
        ),
      );
      if (orders.length) {
        const loanOrder = orders.find((o: any) => o.revenue === 60000);
        expect(loanOrder).toMatchObject({
          loanDisbursementAmount: 60000,
          lumpsumTotalReceived: 0,
        });
      }
    });
  });

  it('payment report aggregates received revenue by status', async () => {
    const rows: any[] = await orderService.paymentReport();
    const total = rows.reduce((s, r) => s + r.totalAmount, 0);
    const approved = rows.reduce((s, r) => s + r.approvedAmount, 0);
    const all: any[] = await m.Order.find().lean();
    expect(total).toBeCloseTo(
      all.reduce((s, o) => s + calculateActualRevenue(o).total, 0),
      2,
    );
    expect(approved).toBeCloseTo(
      all
        .filter((o) => o.Approved)
        .reduce((s, o) => s + calculateActualRevenue(o).total, 0),
      2,
    );
  });

  it('state-wise report uses approved actual revenue', async () => {
    const stage = await m.LeadStage.collection.insertOne({
      name: 'Admission Done',
      order: 9,
    });
    const leads = [
      '7000000001',
      '7000000002',
      '7000000003',
      '7000000004',
      '7000000005',
    ].map((phone, i) => ({
      leadId: 900000 + i,
      phone,
      state: i % 2 === 0 ? 'Kerala' : 'Goa',
      stageId: stage.insertedId,
      createdAt: new Date(Date.UTC(YEAR, 5, 1)),
    }));
    await m.Lead.collection.insertMany(leads);
    const result: any = await orderService.stateLeadStageRevenueReport({
      fromDate: `${YEAR}-01-01`,
      toDate: `${YEAR}-12-31`,
    });
    expect(result.summary.totalRevenue).toBe(30000 + 60000 + 30000);
    expect(result.summary.totalOrders).toBe(4); // unapproved order excluded
  });

  it('source / campaign report uses approved actual revenue', async () => {
    let stage: any = await m.LeadStage.findOne({
      name: 'Admission Done',
    }).lean();
    if (!stage) {
      const created = await m.LeadStage.collection.insertOne({
        name: 'Admission Done',
        order: 9,
      });
      stage = { _id: created.insertedId };
      await m.Lead.collection.insertMany(
        [
          '7000000001',
          '7000000002',
          '7000000003',
          '7000000004',
          '7000000005',
        ].map((phone, i) => ({
          leadId: 910000 + i,
          phone,
          stageId: stage._id,
          createdAt: new Date(Date.UTC(YEAR, 5, 1)),
        })),
      );
    }
    await m.Lead.collection.updateMany(
      { stageId: stage._id },
      {
        $set: {
          source: 'Facebook',
          source_campaign: 'Diwali',
          isActive: true,
          assignedDate: new Date(Date.UTC(YEAR, 5, 1)),
        },
      },
    );
    const result: any = await orderService.sourceCampaignWiseLeadRevenueReport({
      orderCreatedDateFrom: `${YEAR}-07-01`,
      orderCreatedDateTo: `${YEAR}-07-31`, // existing rule: max 31 days
    });
    // July: subscription order (2 installments + paid credit); the unapproved
    // order and the pending-credit-only order contribute nothing.
    expect(result.stats.totalRevenue).toBe(30000);
  });
});

/* =========================================================================
   EMPLOYEE UTILIZATION – ACTIVITY DATE FILTER
   ========================================================================= */

describe('employee utilization activity filter', () => {
  const EMP = new Types.ObjectId().toString();
  const IDLE = new Types.ObjectId().toString();
  let regStageId: string;

  beforeAll(async () => {
    const role = await m.Role.collection.insertOne({
      name: 'Activity Level',
      level: 77,
      permissions: [],
    });
    await m.User.collection.insertMany(
      [EMP, IDLE].map((id, i) => ({
        _id: new Types.ObjectId(id),
        name: ['Asha', 'Idle'][i],
        employeeId: `ACT-${i}`,
        email: `act${i}@example.com`,
        number: `88888000${i}`,
        role: role.insertedId,
        status: 'active',
        isBlocked: false,
        createdAt: new Date(Date.UTC(2025, 0, 1)),
      })),
    );

    const now = new Date();
    const old = new Date(now.getTime() - 40 * 86_400_000);
    const pcat = await m.LeadStage.collection.insertOne({
      name: 'PCAT Scheduled',
      order: 3,
    });
    const reg = await m.LeadStage.collection.insertOne({
      name: 'Registration Done',
      order: 8,
    });
    regStageId = reg.insertedId.toString();
    const empId = new Types.ObjectId(EMP);

    const leads = await m.Lead.collection.insertMany([
      // assigned today, created earlier
      {
        leadId: 990001,
        phone: '6000000001',
        assignedTo: empId,
        assignedDate: now,
        createdAt: old,
        stageId: reg.insertedId,
      },
      // new lead: created + assigned today
      {
        leadId: 990002,
        phone: '6000000002',
        assignedTo: empId,
        assignedDate: now,
        createdAt: now,
        stageId: pcat.insertedId,
      },
      // assigned long ago, worked today
      {
        leadId: 990003,
        phone: '6000000003',
        assignedTo: empId,
        assignedDate: old,
        createdAt: old,
        stageId: reg.insertedId,
      },
    ]);
    const [l1, l2, l3] = Object.values(leads.insertedIds);

    await m.LeadStageHistory.collection.insertMany([
      {
        leadId: l1,
        stageId: pcat.insertedId,
        stageName: 'PCAT Scheduled',
        userId: empId,
        changedAt: now,
      },
      {
        leadId: l1,
        stageId: reg.insertedId,
        stageName: 'Registration Done',
        userId: empId,
        changedAt: now,
      },
      {
        leadId: l3,
        stageId: reg.insertedId,
        stageName: 'Registration Done',
        userId: empId,
        changedAt: now,
      },
      // same lead moved twice -> counted once
      {
        leadId: l3,
        stageId: reg.insertedId,
        stageName: 'Registration Done',
        userId: empId,
        changedAt: now,
      },
      // outside the period
      {
        leadId: l2,
        stageId: reg.insertedId,
        stageName: 'Registration Done',
        userId: empId,
        changedAt: old,
      },
    ]);

    await m.CallLog.collection.insertMany([
      {
        userId: empId,
        customerNumber: '6000000001',
        duration: 60,
        createdAt: now,
      },
      {
        userId: empId,
        customerNumber: '6000000001',
        duration: 0,
        createdAt: now,
      },
      {
        userId: empId,
        customerNumber: '6000000002',
        duration: 0,
        createdAt: now,
      },
      {
        userId: empId,
        customerNumber: '6000000003',
        duration: 30,
        createdAt: old,
      },
    ]);
  });

  it('counts what the employee did in the period', async () => {
    const result: any = await orderService.employeePoolUtilizationReport({
      level: 77,
      activityDateFilter: 'today',
    });
    expect(result.mode).toBe('activity');
    expect(result.activityDateFilter).toBe('today');

    const asha = result.employees.find((e: any) => e.employeeId === EMP);
    expect(asha).toMatchObject({
      leadAssigned: 2,
      newLead: 1,
      totalDial: 3,
      uniqDial: 2,
      answeredCall: 1,
      answeredTalkTime: 60,
      pcatScheduled: 1,
      pcatDone: 0,
      registrationDone: 2,
      admissionDone: 0,
    });
    expect(asha.allStages).toEqual([
      expect.objectContaining({ stageName: 'PCAT Scheduled', count: 1 }),
      expect.objectContaining({ stageName: 'Registration Done', count: 2 }),
    ]);

    const idle = result.employees.find((e: any) => e.employeeId === IDLE);
    expect(idle).toMatchObject({
      leadAssigned: 0,
      totalDial: 0,
      registrationDone: 0,
    });
  });

  it('lead mode is unchanged when no activity filter is sent', async () => {
    const result: any = await orderService.employeePoolUtilizationReport({
      level: 77,
      assignedDateFilter: 'today',
    });
    expect(result.mode).toBe('lead');
    expect(result.activityStartDate).toBeNull();
    expect(result.assignedStartDate).toBeInstanceOf(Date);
  });

  it('stage drill-down lists the leads moved into the stage in the period', async () => {
    const result: any = await orderService.employeeStageLeads({
      employeeId: EMP,
      stageId: regStageId,
      activityDateFilter: 'today',
    });
    expect(result.mode).toBe('activity');
    expect(result.total).toBe(2);
    expect(result.data.map((l: any) => l.leadId).sort()).toEqual([
      990001, 990003,
    ]);
  });

  it('rejects an activity range over 31 days', async () => {
    await expect(
      orderService.employeePoolUtilizationReport({
        level: 77,
        activityDateFrom: '2025-01-01',
        activityDateTo: '2025-03-01',
      }),
    ).rejects.toThrow('cannot be more than 31 days');
  });
});

/* =========================================================================
   PENDING CREDITS REPORT + DAILY NOTIFICATION
   ========================================================================= */

describe('pending credits', () => {
  let multiOrderId: string;
  beforeAll(async () => {
    await m.Order.updateMany(
      { 'credits.0': { $exists: true } },
      {
        $set: {
          'credits.$[].status': CreditStatus.PAID,
          'credits.$[].paymentReferenceId': 'seed',
        },
      },
    );
    await m.Order.updateMany({}, { $set: { Approved: false } });
    const mk = async (dto: any, counsellor: string, approve = true) => {
      const order: any = await orderService.createOrder(
        baseOrderDto(dto),
        counsellor,
      );
      if (approve) await orderService.approveOrder(order._id.toString(), ADMIN);
      return order;
    };
    // one order, multiple credits: past due (-10), due today, upcoming (+5)
    const multi = await mk(
      {
        studentName: 'Asha Credit',
        lumpsumPayments: [{ amount: 70000 }],
        credits: [
          { amount: 10000, dueDate: businessDay(-10).toISOString() },
          { amount: 15000, dueDate: businessDay(0).toISOString() },
          { amount: 5000, dueDate: businessDay(5).toISOString() },
        ],
      },
      BD,
    );
    multiOrderId = multi._id.toString();
    // same student, second order (email is unique per order, so a different email)
    const second = await mk(
      {
        studentName: 'Asha Credit',
        mobile: multi.mobile,
        lumpsumPayments: [{ amount: 80000 }],
        credits: [{ amount: 20000, dueDate: businessDay(-1).toISOString() }],
      },
      OTHER_BD,
    );
    // paid credit
    await orderService.markCreditPaid(
      second._id.toString(),
      second.credits[0]._id.toString(),
      { paymentReferenceId: 'UTR-PC', amount: 20000 },
      adminUser,
    );
    await mk(
      {
        studentName: 'Ravi Pending',
        lumpsumPayments: [{ amount: 90000 }],
        credits: [{ amount: 10000, dueDate: businessDay(-3).toISOString() }],
      },
      OTHER_BD,
    );
    // unapproved → excluded
    await mk(
      {
        lumpsumPayments: [{ amount: 90000 }],
        credits: [{ amount: 10000, dueDate: businessDay(-3).toISOString() }],
      },
      BD,
      false,
    );
  });

  it('summarises and filters credits (admin)', async () => {
    const report: any = await pendingCredits.getReport(
      { category: 'pending' },
      adminUser,
    );
    expect(report.summary).toMatchObject({
      totalPendingCreditAmount: 40000,
      totalPendingCreditRecords: 4,
      totalOverdueCreditAmount: 20000,
      totalOverdueCreditRecords: 2,
      totalDueTodayAmount: 15000,
      totalDueTodayRecords: 1,
      totalPaidAmount: 20000,
      totalPaidRecords: 1,
    });
    expect(report.total).toBe(4);
    expect(report.data[0]).toMatchObject({
      creditAmount: 10000,
      creditStatus: 'Overdue',
      daysOverdue: 10,
      studentName: 'Asha Credit',
    });
    expect(report.data[0].courseName).toBe('Data Science');
    expect(report.data[0].counsellorName).toBeDefined();

    expect(
      (await pendingCredits.getReport({ category: 'pastDue' }, adminUser))
        .total,
    ).toBe(2);
    expect(
      (await pendingCredits.getReport({ category: 'dueToday' }, adminUser))
        .total,
    ).toBe(1);
    expect(
      (await pendingCredits.getReport({ category: 'upcoming' }, adminUser))
        .total,
    ).toBe(1);
    const paid: any = await pendingCredits.getReport(
      { category: 'paid' },
      adminUser,
    );
    expect(paid.data[0]).toMatchObject({
      creditStatus: 'Paid',
      paymentReferenceId: 'UTR-PC',
    });
    expect(
      (
        await pendingCredits.getReport(
          { category: 'all', search: 'asha' },
          adminUser,
        )
      ).total,
    ).toBe(4);
    expect(
      (
        await pendingCredits.getReport(
          { category: 'pending', counsellorId: OTHER_BD },
          adminUser,
        )
      ).total,
    ).toBe(1);
    const ranged: any = await pendingCredits.getReport(
      {
        category: 'all',
        fromDate: toDateKey(businessDay(-3), TZ),
        toDate: toDateKey(businessDay(0), TZ),
      },
      adminUser,
    );
    expect(ranged.total).toBe(3);
    const page2: any = await pendingCredits.getReport(
      { category: 'pending', page: 2, limit: 3 },
      adminUser,
    );
    expect(page2.data).toHaveLength(1);
    expect(page2.totalPages).toBe(2);
  });

  it('restricts non-admin users to their own team', async () => {
    const report: any = await pendingCredits.getReport(
      { category: 'pending' },
      bdUser(),
    );
    expect(report.total).toBe(3);
    expect(report.data.every((r: any) => r.studentName === 'Asha Credit')).toBe(
      true,
    );
    await expect(
      pendingCredits.getReport({ counsellorId: OTHER_BD }, bdUser()),
    ).rejects.toThrow('cannot view credits of this counsellor');
  });

  it('daily notification: past due + due today, no duplicates on re-run, history stored', async () => {
    const role = await m.Role.collection.insertOne({
      name: 'Admin',
      permissions: [],
    });
    await m.User.collection.insertOne({
      _id: new Types.ObjectId(ADMIN),
      name: 'Admin',
      email: 'admin@example.com',
      employeeId: 'EMP-ADMIN',
      number: '9999900099',
      role: role.insertedId,
      status: 'active',
      isBlocked: false,
    });

    // a credit that was Pending when saved and has become overdue since
    await m.Order.updateOne(
      { _id: multiOrderId },
      { $set: { 'credits.0.status': CreditStatus.PENDING } },
    );
    const first: any = await notifications.run('MANUAL', ADMIN);
    expect(first.status).toBe('COMPLETED');
    expect(first.pastDueNotified).toBe(2);
    expect(first.dueTodayNotified).toBe(1);
    expect(first.creditsMarkedOverdue).toBe(1);
    expect(notificationCalls).toHaveLength(1);
    const payload = notificationCalls[0];
    expect(payload.recipients.userIds).toEqual([ADMIN]);
    expect(payload.metadata.pastDue.items[0]).toMatchObject({
      studentName: 'Asha Credit',
      course: 'Data Science',
      creditAmount: 10000,
      daysOverdue: 10,
    });
    expect(payload.metadata.dueToday.items[0]).toMatchObject({
      creditAmount: 15000,
    });
    expect(payload.metadata.dueToday.items[0].daysOverdue).toBeUndefined();

    const stored: any = await m.Order.findById(multiOrderId).lean();
    expect(stored.credits[0].status).toBe(CreditStatus.OVERDUE);

    const second: any = await notifications.run('CRON');
    expect(second.status).toBe('SKIPPED');
    expect(second.alreadyNotified).toBe(3);
    expect(notificationCalls).toHaveLength(1);

    // next day → notified again (once)
    const tomorrow: any = await notifications.run(
      'CRON',
      undefined,
      businessDay(1),
    );
    expect(tomorrow.pastDueNotified).toBe(3);
    expect(notificationCalls).toHaveLength(2);

    const history: any = await notifications.getHistory(1, 10);
    expect(history.total).toBe(3);
    expect(getBusinessTimezone()).toBe(TZ);
  });

  it('releases claims when the notification cannot be delivered', async () => {
    const failing = new PendingCreditNotificationService(
      m.Order,
      m.CreditNotificationLog,
      m.CreditNotificationRun,
      m.User,
      m.Role,
      {
        handleEvent: async () => {
          throw new Error('socket down');
        },
      } as any,
    );
    const day = businessDay(2);
    await expect(failing.run('CRON', undefined, day)).rejects.toThrow(
      'socket down',
    );
    expect(
      await m.CreditNotificationLog.countDocuments({
        notificationDate: toDateKey(day, TZ),
      }),
    ).toBe(0);
    const ok: any = await notifications.run('CRON', undefined, day);
    expect(ok.status).toBe('COMPLETED');
  });
});

/* =========================================================================
   MIGRATION
   ========================================================================= */

describe('migration of legacy orders', () => {
  const ids: Record<string, Types.ObjectId> = {};
  beforeAll(async () => {
    await m.Order.deleteMany({});
    const base = (name: string, extra: any) => ({
      mobile: `6${String(Object.keys(ids).length).padStart(9, '0')}`,
      email: `${name}@legacy.test`,
      studentName: name,
      courseVertical: poolId.toString(),
      counsellorId: BD /* stored as string, like production */,
      counsellorName: 'BD',
      orderDate: new Date('2026-04-03T06:00:00Z'),
      feeDepositDate: new Date('2026-04-03T06:00:00Z'),
      ...extra,
    });
    const insert = async (name: string, extra: any) => {
      const res = await m.Order.collection.insertOne(base(name, extra));
      ids[name] = res.insertedId as Types.ObjectId;
    };
    await insert('lumpsum', {
      paymentMode: 'Lumpsum',
      finalFee: 40000,
      Approved: true,
      status: 'Partially Paid',
      lumpsumDetails: {
        _id: new Types.ObjectId(),
        registrationDate: new Date('2026-04-03'),
        registrationAmount: 2000,
        totalReceived: 2000,
        pendingAmount: 38000,
        paymentType: 'UPI',
      },
    });
    await insert('loan', {
      paymentMode: 'Loan',
      finalFee: 30001,
      Approved: true,
      status: 'Fully Paid',
      loanDetails: {
        _id: new Types.ObjectId(),
        loanPartner: new Types.ObjectId(LOAN_PARTNER),
        loanId: new Types.ObjectId(),
        loanAmount: 28000,
        disbursementAmount: 0,
        firstEmiDate: new Date('2026-05-05'),
      },
    });
    await insert('loanFull', {
      paymentMode: 'Loan',
      finalFee: 50000,
      Approved: false,
      status: 'Fully Paid',
      loanDetails: {
        loanPartner: new Types.ObjectId(LOAN_PARTNER),
        loanAmount: 50000,
        disbursementAmount: 48000,
      },
    });
    await insert('subscription', {
      paymentMode: 'Subscription',
      finalFee: 10000,
      Approved: true,
      status: 'Partially Paid',
      subscriptionDetails: {
        _id: new Types.ObjectId(),
        cashfreeSubscriptionId: 'sess_1',
        gateway: 'Cashfree',
        installmentAmount: 1000,
        numberOfInstallments: 10,
        firstInstallmentDate: new Date('2026-05-15'),
        status: 'PENDING_AUTH',
      },
    });
    await insert('incomplete', {
      paymentMode: 'Lumpsum',
      finalFee: 27100,
      Approved: true,
      status: 'Partially Paid',
      subscriptionDetails: {
        gateway: 'Cashfree',
        installmentAmount: 0,
        numberOfInstallments: 1,
      },
    });
    const sub = await m.Subscription.collection.insertOne({
      orderId: ids.subscription,
      subscriptionId: 'sub_legacy',
      cashfreeSubscriptionId: 'sess_1',
      status: 'ACTIVE',
      installments: [],
    });
    await m.SubscriptionPayment.collection.insertMany([
      {
        subscriptionRef: sub.insertedId,
        orderId: ids.subscription,
        subscriptionId: 'sub_legacy',
        eventType: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        cfPaymentId: 'cf-l1',
        paymentAmount: 1000,
        eventTime: new Date('2026-05-15'),
      },
      {
        subscriptionRef: sub.insertedId,
        orderId: ids.subscription,
        subscriptionId: 'sub_legacy',
        eventType: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        cfPaymentId: 'cf-l1',
        paymentAmount: 1000,
        eventTime: new Date('2026-05-15'),
      },
      {
        subscriptionRef: sub.insertedId,
        orderId: ids.subscription,
        subscriptionId: 'sub_legacy',
        eventType: 'SUBSCRIPTION_PAYMENT_FAILED',
        cfPaymentId: 'cf-l2',
        paymentAmount: 1000,
      },
    ]);
  });

  it('dry run writes nothing and reports every order', async () => {
    const before = await m.Order.find().lean();
    const report = await migrateOrderPayments(mongoose.connection.db);
    expect(report.mode).toBe('dry-run');
    expect(report.totals).toMatchObject({
      candidates: 5,
      wouldMigrate: 5,
      migrated: 0,
      errors: 0,
    });
    expect(await m.Order.find().lean()).toEqual(before);
  });

  it('applies the migration preserving references, approval, counsellor and dates', async () => {
    const report = await migrateOrderPayments(mongoose.connection.db, {
      apply: true,
    });
    // Only the subscription order changes: its successful subscription
    // payments (legacy rule: 0) are now counted.
    expect(report.totals).toMatchObject({
      candidates: 5,
      migrated: 5,
      errors: 0,
      revenueChangedOrders: 1,
    });
    const changed = report.orders.filter(
      (o) => o.revenueBefore !== o.revenueAfter,
    );
    expect(
      changed.map((o) => [o.orderId, o.revenueBefore, o.revenueAfter]),
    ).toEqual([[ids.subscription.toString(), 0, 1000]]);
    expect(report.totals.byCoverageStatus).toMatchObject({
      BALANCED: 3,
      UNDER_COVERED: 2,
    });

    const lumpsum: any = await m.Order.findById(ids.lumpsum).lean();
    expect(lumpsum.paymentSchemaVersion).toBe(2);
    expect(lumpsum.lumpsumPayments[0]._id.toString()).toBe(
      lumpsum.lumpsumDetails._id.toString(),
    );
    expect(lumpsum.lumpsumPayments[0]).toMatchObject({
      amount: 40000,
      amountReceived: 2000,
      paymentMode: 'UPI',
    });
    expect(lumpsum.lumpsumDetails).toMatchObject({
      totalReceived: 2000,
      pendingAmount: 38000,
    }); // legacy untouched
    expect(lumpsum.Approved).toBe(true);
    expect(lumpsum.counsellorId.toString()).toBe(BD);
    expect(lumpsum.orderDate.toISOString()).toBe('2026-04-03T06:00:00.000Z');
    expect(lumpsum.status).toBe('Partially Paid');

    const loan: any = await m.Order.findById(ids.loan).lean();
    expect(loan.loans[0].loanId.toString()).toBe(
      loan.loanDetails.loanId.toString(),
    );
    expect(loan.credits).toEqual([]); // no invented credits
    expect(loan.migrationInfo.needsReview).toBe(true);
    expect(loan.status).toBe('Fully Paid'); // preserved; derived value kept for review
    // The undisbursed loan counts as received but does not cover the whole fee.
    expect(loan.migrationInfo.derivedStatus).toBe(OrderStatus.PARTIALLY_PAID);

    const full: any = await m.Order.findById(ids.loanFull).lean();
    expect(full.loans[0]).toMatchObject({
      disbursementAmount: 48000,
      disbursementStatus: 'Partially Disbursed', // derived: 48000 of a larger loan amount
    });
    expect(full.Approved).toBe(false);

    const sub: any = await m.Order.findById(ids.subscription).lean();
    expect(sub.subscriptions[0]).toMatchObject({
      gatewaySubscriptionId: 'sub_legacy',
      cashfreeSubscriptionId: 'sess_1',
      totalReceived: 1000,
    });
    expect(
      sub.subscriptions[0].paymentHistory.map((p: any) => p.gatewayPaymentId),
    ).toEqual(['cf-l1']);
    expect(sub.paymentSummary.subscriptionReceived).toBe(1000);
    const subDoc: any = await m.Subscription.findOne({
      subscriptionId: 'sub_legacy',
    }).lean();
    expect(subDoc.orderSubscriptionEntryId.toString()).toBe(
      sub.subscriptions[0]._id.toString(),
    );

    const incomplete: any = await m.Order.findById(ids.incomplete).lean();
    expect(incomplete.migrationInfo.needsReview).toBe(true);
    expect(incomplete.migrationInfo.warnings.join()).toContain(
      'no planned amount',
    );
    expect(incomplete.subscriptionDetails).toBeDefined(); // legacy data kept
  });

  it('records subscription revenue from migrated history (behaviour change documented)', async () => {
    const report = await migrateOrderPayments(mongoose.connection.db);
    expect(report.totals.candidates).toBe(0);
    const sub: any = await m.Order.findById(ids.subscription).lean();
    // a late webhook retry of an imported payment is not counted again
    const retry = await financial.recordSubscriptionPayment({
      orderId: ids.subscription.toString(),
      gatewayPaymentId: 'cf-l1',
      amount: 1000,
    });
    expect(retry.status).toBe('DUPLICATE');
    expect(
      (await m.Order.findById(ids.subscription).lean()).paymentSummary
        .subscriptionReceived,
    ).toBe(sub.paymentSummary.subscriptionReceived);
  });

  it('re-running does not duplicate anything; verify reports only flagged orders', async () => {
    const again = await migrateOrderPayments(mongoose.connection.db, {
      apply: true,
    });
    expect(again.totals).toMatchObject({
      candidates: 0,
      migrated: 0,
      alreadyMigrated: 5,
    });
    const lumpsum: any = await m.Order.findById(ids.lumpsum).lean();
    expect(lumpsum.lumpsumPayments).toHaveLength(1);
    const verification = await verifyMigratedOrders(mongoose.connection.db);
    expect(verification.checked).toBe(5);
    expect(verification.issues.map((i: any) => i.orderId).sort()).toEqual(
      [ids.loan.toString(), ids.incomplete.toString()].sort(),
    );
  });

  it('rollback restores the legacy snapshot of untouched orders only', async () => {
    // a real financial change after the migration (audited) blocks rollback
    const loanFull: any = await m.Order.findById(ids.loanFull).lean();
    await orderService.updateFinancials(
      ids.loanFull.toString(),
      {
        loans: [
          { _id: loanFull.loans[0]._id.toString(), disbursementAmount: 50000 },
        ],
      },
      adminUser,
    );
    await financial.recordLinkPayment({
      orderId: ids.lumpsum.toString(),
      amount: 100,
      gatewayPaymentKey: 'rb-1',
    });
    const result = await rollbackOrderPayments(mongoose.connection.db, {
      apply: true,
    });
    expect(result.rolledBack).toBe(3);
    expect(result.skipped.map((s: any) => s.orderId).sort()).toEqual(
      [ids.lumpsum.toString(), ids.loanFull.toString()].sort(),
    );
    const loan: any = await m.Order.findById(ids.loan).lean();
    expect(loan.paymentSchemaVersion).toBeUndefined();
    expect(loan.loans).toBeUndefined();
    expect(loan.loanDetails.loanAmount).toBe(28000);
  });
});
