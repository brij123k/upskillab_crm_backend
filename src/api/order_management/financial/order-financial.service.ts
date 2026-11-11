import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  CreditStatus,
  Order,
  PaymentSource,
} from 'src/schema/order_Management/order.schema';
import { LoanEmi } from 'src/schema/order_Management/loan-emi.schema';
import { ProcessedPaymentEvent } from 'src/schema/order_Management/processed-payment-event.schema';
import { Subscription } from 'src/schema/order_Management/subscription.schema';
import { SubscriptionPayment } from 'src/schema/order_Management/subscription-payment.schema';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { hasPermission } from 'src/common/utils/has-permission.util';
import {
  calculateActualRevenue,
  calculatePlannedCoverage,
  calculateReceivedAmounts,
  hasLegacyFinancialInput,
  hasV2FinancialInput,
  isV2Order,
  LegacyMappingExtras,
  mapLegacyPaymentDetails,
  MONEY_EPSILON,
  normalizeCreditInput,
  normalizeLoanInput,
  normalizeLumpsumInput,
  normalizeSubscriptionInput,
  recalculateOrderFinancials,
  toMoney,
  upgradeLegacyOrder,
  validateOrderFinancials,
} from './order-financial.util';
import {
  allocateLumpsumPayment,
  applyCreditPayment,
  applyFinancialPatch,
  applySubscriptionGatewayPayment,
  AuditEntry,
  FinancialOperationError,
  FinancialPatch,
  OperationContext,
  revertCreditPayment,
} from './order-financial.operations';

/** Order fields owned by the financial service. */
export const FINANCIAL_FIELDS = [
  'lumpsumPayments',
  'loans',
  'subscriptions',
  'credits',
  'paymentSummary',
  'paymentSchemaVersion',
  'paymentModes',
  'paymentMode',
  'status',
  'lumpsumDetails',
  'loanDetails',
  'subscriptionDetails',
] as const;

/** DTO keys that must never be written directly by the generic order APIs. */
export const PROTECTED_ORDER_KEYS = [
  ...FINANCIAL_FIELDS,
  'financialAuditLog',
  'migrationInfo',
  'countedRevenue',
  'Approved',
  'approvedBy',
  'counsellorId',
  'counsellorName',
];

export type PaymentApplicationStatus = 'APPLIED' | 'DUPLICATE';

export interface PaymentApplicationResult {
  status: PaymentApplicationStatus;
  orderId?: string;
  allocations?: any;
  key: string;
}

class ConcurrentModificationError extends Error {
  constructor() {
    super('Order was modified concurrently');
  }
}

export interface FinancialActor {
  userId?: string;
  roleName?: string;
  permissions?: any[];
}

@Injectable()
export class OrderFinancialService {
  private readonly logger = new Logger(OrderFinancialService.name);
  private transactionsSupported: boolean | null = null;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(LoanEmi.name) private readonly emiModel: Model<LoanEmi>,
    @InjectModel(ProcessedPaymentEvent.name)
    private readonly processedModel: Model<ProcessedPaymentEvent>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(SubscriptionPayment.name)
    private readonly subscriptionPaymentModel: Model<SubscriptionPayment>,
  ) {}

  /* =======================================================================
     INFRASTRUCTURE
     ======================================================================= */

  private isTransactionUnsupported(error: any): boolean {
    const message = String(error?.message || '');
    return (
      error?.code === 20 ||
      error?.codeName === 'IllegalOperation' ||
      message.includes('Transaction numbers are only allowed') ||
      message.includes('does not support transactions')
    );
  }

  /**
   * Runs `work` inside a MongoDB transaction. The deployment (Atlas replica
   * set) supports transactions; if a deployment does not, the work runs
   * without one and optimistic concurrency guards still apply.
   */
  async runInTransaction<T>(
    work: (session?: ClientSession) => Promise<T>,
  ): Promise<T> {
    if (this.transactionsSupported === false) return work(undefined);

    const session = await this.connection.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      this.transactionsSupported = true;
      return result!;
    } catch (error) {
      if (
        this.transactionsSupported !== true &&
        this.isTransactionUnsupported(error)
      ) {
        this.transactionsSupported = false;
        this.logger.warn(
          'MongoDB deployment does not support transactions; financial writes continue with optimistic concurrency only',
        );
        return work(undefined);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  private async withConcurrencyRetry<T>(
    fn: () => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof ConcurrentModificationError && attempt < attempts)
          continue;
        if (error instanceof ConcurrentModificationError) {
          throw new BadRequestException(
            'The order was modified by another request. Please retry.',
          );
        }
        throw error;
      }
    }
  }

  private toBadRequest(error: any): never {
    if (error instanceof FinancialOperationError) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid order financials',
        errors: error.errors,
      });
    }
    throw error;
  }

  private assertValid(order: any, requireBalanced = true) {
    const errors = validateOrderFinancials(order, { requireBalanced });
    if (errors.length) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid order financials',
        errors,
      });
    }
  }

  private async loadOrder(orderId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('Invalid order id');
    }
    const order: any = await this.orderModel
      .findById(orderId)
      .session(session ?? null)
      .lean();
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** Data from other collections needed to upgrade a legacy order. */
  async loadLegacyExtras(
    orderId: any,
    session?: ClientSession,
  ): Promise<LegacyMappingExtras> {
    const id = new Types.ObjectId(String(orderId));
    const [subscriptionDocs, subscriptionSuccessPayments] = await Promise.all([
      this.subscriptionModel
        .find({ orderId: id })
        .session(session ?? null)
        .lean(),
      this.subscriptionPaymentModel
        .find({ orderId: id, eventType: 'SUBSCRIPTION_PAYMENT_SUCCESS' })
        .session(session ?? null)
        .lean(),
    ]);
    return { subscriptionDocs, subscriptionSuccessPayments };
  }

  private async ensureV2(
    order: any,
    session?: ClientSession,
  ): Promise<AuditEntry[]> {
    if (isV2Order(order)) return [];
    const extras = await this.loadLegacyExtras(order._id, session);
    const { warnings } = upgradeLegacyOrder(order, extras);
    return [
      {
        action: 'AUTO_UPGRADE_TO_V2',
        entryType: 'order',
        entryId: order._id?.toString(),
        after: { warnings },
        source: 'SYSTEM',
        performedAt: new Date(),
      },
    ];
  }

  /** Persists financial fields with an optimistic guard on updatedAt. */
  private async persist(
    order: any,
    guardUpdatedAt: any,
    auditEntries: AuditEntry[],
    session?: ClientSession,
    extraSet: Record<string, any> = {},
  ) {
    const $set: Record<string, any> = { ...extraSet };
    const $unset: Record<string, ''> = {};
    for (const key of FINANCIAL_FIELDS) {
      if (order[key] === undefined) $unset[key] = '';
      else $set[key] = order[key];
    }
    const update: any = { $set };
    if (Object.keys($unset).length) update.$unset = $unset;
    if (auditEntries.length) {
      update.$push = { financialAuditLog: { $each: auditEntries } };
    }
    const filter: any = { _id: order._id };
    if (guardUpdatedAt) filter.updatedAt = guardUpdatedAt;

    const result = await this.orderModel.updateOne(filter, update, { session });
    if (result.matchedCount === 0) throw new ConcurrentModificationError();
  }

  private async claimPaymentKey(
    key: string,
    data: Partial<ProcessedPaymentEvent>,
    session?: ClientSession,
  ) {
    await this.processedModel.create([{ key, ...data }], { session });
  }

  private isDuplicatePaymentKey(error: any): boolean {
    return (
      error?.code === 11000 &&
      (error?.keyPattern?.key !== undefined ||
        String(error?.message || '').includes('processed_payment_events'))
    );
  }

  /** Creates LoanEmi trackers for loans that do not have one yet. */
  async createLoanTrackers(order: any, loans: any[], session?: ClientSession) {
    for (const loan of loans) {
      if (loan.loanId) continue;
      const firstDate = loan.firstEmiDate
        ? new Date(loan.firstEmiDate)
        : undefined;
      const secondDate = firstDate ? new Date(firstDate) : undefined;
      secondDate?.setMonth(secondDate.getMonth() + 1);
      const thirdDate = firstDate ? new Date(firstDate) : undefined;
      thirdDate?.setMonth(thirdDate.getMonth() + 2);

      const [emi] = await this.emiModel.create(
        [
          {
            orderId: order._id,
            learnerName: order.studentName,
            mobile: order.mobile,
            email: order.email,
            couselorId: order.counsellorId,
            counselorName: order.counsellorName,
            LoanPartner: loan.loanPartner,
            loanAmount: loan.loanAmount,
            disbursementAmount: loan.disbursementAmount,
            loanDate: loan.loanDate,
            firstEmiDate: firstDate,
            secondEmiDate: secondDate,
            thirdEmiDate: thirdDate,
          },
        ],
        { session },
      );
      loan.loanId = emi._id;
    }
  }

  /** Keeps the LoanEmi tracker amounts in sync with the loan entries. */
  private async syncLoanTrackers(loans: any[], session?: ClientSession) {
    for (const loan of loans) {
      if (!loan.loanId) continue;
      await this.emiModel.updateOne(
        { _id: loan.loanId },
        {
          $set: {
            LoanPartner: loan.loanPartner,
            loanAmount: loan.loanAmount,
            disbursementAmount: loan.disbursementAmount,
            loanDate: loan.loanDate,
          },
        },
        { session },
      );
    }
  }

  private canRevert(actor?: FinancialActor) {
    return hasPermission(
      actor,
      PERMISSIONS.Orders.MODULE,
      PERMISSIONS.Orders.ACTIONS.REVERT_PAYMENT,
    );
  }

  private canRecord(actor?: FinancialActor) {
    return hasPermission(
      actor,
      PERMISSIONS.Orders.MODULE,
      PERMISSIONS.Orders.ACTIONS.RECORD_PAYMENT,
    );
  }

  private canApprove(actor?: FinancialActor) {
    return hasPermission(
      actor,
      PERMISSIONS.Orders.MODULE,
      PERMISSIONS.Orders.ACTIONS.APPROVE,
    );
  }

  /* =======================================================================
     CREATE
     ======================================================================= */

  /**
   * Builds and validates the financial part of a new order from either the
   * v2 arrays or the legacy single-object payload. Throws 400 on any error.
   */
  extractFinancialFields(order: any) {
    const result: Record<string, any> = {};
    for (const key of FINANCIAL_FIELDS) result[key] = order[key];
    return result;
  }

  /**
   * Returns a validated holder object containing finalFee and every
   * financial field; persist it with extractFinancialFields() after any
   * loan trackers have been created (then recalculate the mirror).
   */
  prepareNewOrderFinancials(dto: any, finalFee: number, actorId?: string): any {
    const ctx = { actorId, source: PaymentSource.MANUAL };
    const order: any = { finalFee, paymentMode: dto?.paymentMode };

    if (hasV2FinancialInput(dto)) {
      const invalidCredit = (dto.credits || []).some(
        (c: any) => c?.status === CreditStatus.PAID,
      );
      if (invalidCredit) {
        throw new BadRequestException({
          success: false,
          message: 'Invalid order financials',
          errors: [
            'A new credit cannot be created as Paid; record the payment against it after creation',
          ],
        });
      }
      order.lumpsumPayments = (dto.lumpsumPayments || []).map((e: any) =>
        normalizeLumpsumInput({ ...e, _id: undefined }, ctx),
      );
      order.loans = (dto.loans || []).map((e: any) =>
        normalizeLoanInput({ ...e, _id: undefined, loanId: undefined }, ctx),
      );
      order.subscriptions = (dto.subscriptions || []).map((e: any) =>
        normalizeSubscriptionInput(
          {
            ...e,
            _id: undefined,
            paymentHistory: [],
            cashfreeSubscriptionId: undefined,
            gatewaySubscriptionId: undefined,
            subscriptionRef: undefined,
          },
          ctx,
        ),
      );
      order.credits = (dto.credits || []).map((c: any) =>
        normalizeCreditInput({ ...c, _id: undefined }, ctx),
      );
    } else if (hasLegacyFinancialInput(dto)) {
      const mapped = mapLegacyPaymentDetails(
        { ...dto, finalFee },
        'api',
        {},
        ctx,
      );
      order.lumpsumPayments = mapped.lumpsumPayments;
      order.loans = mapped.loans;
      order.subscriptions = mapped.subscriptions;
      order.credits = [];
    } else {
      order.lumpsumPayments = [];
      order.loans = [];
      order.subscriptions = [];
      order.credits = [];
    }

    recalculateOrderFinancials(order);
    this.assertValid(order, true);
    return order;
  }

  /* =======================================================================
     UPDATE (patch payment entries / credits)
     ======================================================================= */

  /**
   * Converts a legacy update payload (lumpsumDetails/loanDetails/
   * subscriptionDetails) into a patch that targets the order's existing
   * first entry of each type, so old clients can still edit orders.
   */
  buildPatchFromLegacyDto(
    order: any,
    dto: any,
    finalFee: number,
  ): FinancialPatch {
    const mapped = mapLegacyPaymentDetails(
      {
        ...order,
        ...dto,
        paymentMode: dto.paymentMode || order.paymentMode,
        finalFee,
      },
      'api',
    );
    // A legacy payload describes the complete payment structure (one source),
    // so the other sources are cleared (removal is blocked if money was received).
    const patch: FinancialPatch = {
      lumpsumPayments: [],
      loans: [],
      subscriptions: [],
    };
    const attach = (
      key: keyof FinancialPatch,
      entries: any[],
      strip: string[],
    ) => {
      if (!entries.length) return;
      const existing = (order[key] || [])[0];
      patch[key] = entries.map((entry, index) => {
        const copy: any = { ...entry };
        for (const f of strip) delete copy[f];
        if (index === 0 && existing) copy._id = existing._id.toString();
        else delete copy._id;
        return copy;
      });
    };
    attach('lumpsumPayments', mapped.lumpsumPayments, [
      'receipts',
      'createdBy',
      'origin',
    ]);
    if (patch.lumpsumPayments?.[0]) {
      const legacy = dto.lumpsumDetails || {};
      patch.lumpsumPayments[0].amountReceived = toMoney(legacy.totalReceived);
      if (legacy.paymentType)
        patch.lumpsumPayments[0].paymentMode = legacy.paymentType;
    }
    attach('loans', mapped.loans, ['createdBy', 'origin', 'loanId']);
    attach('subscriptions', mapped.subscriptions, [
      'createdBy',
      'origin',
      'paymentHistory',
      'totalReceived',
      'cashfreeSubscriptionId',
      'gatewaySubscriptionId',
      'subscriptionRef',
      'status',
    ]);
    return patch;
  }

  async updateFinancials(
    orderId: string,
    patch: FinancialPatch & { finalFee?: number; reason?: string },
    actor: FinancialActor,
    options: {
      extraSet?: Record<string, any>;
      allowApproved?: boolean;
      /** Legacy single-object payload from an old client (mapped after upgrade). */
      legacyDto?: any;
    } = {},
  ) {
    return this.withConcurrencyRetry(() =>
      this.runInTransaction(async (session) => {
        const order = await this.loadOrder(orderId, session);
        const guard = order.updatedAt;
        patch = { ...patch };

        if (
          order.Approved &&
          !this.canApprove(actor) &&
          options.allowApproved !== true
        ) {
          throw new ForbiddenException(
            'Changing the payment structure of an approved order requires the order approval permission',
          );
        }

        const auditEntries: AuditEntry[] = await this.ensureV2(order, session);
        const revenueBefore = calculateActualRevenue(order).total;
        const finalFeeBefore = toMoney(order.finalFee);

        if (
          patch.finalFee !== undefined &&
          !Number.isNaN(Number(patch.finalFee))
        ) {
          order.finalFee = toMoney(patch.finalFee);
          if (toMoney(order.finalFee) !== finalFeeBefore) {
            auditEntries.push({
              action: 'FINAL_FEE_CHANGED',
              entryType: 'order',
              entryId: order._id.toString(),
              before: { finalFee: finalFeeBefore },
              after: { finalFee: order.finalFee },
              reason: patch.reason,
              performedBy: actor?.userId
                ? new Types.ObjectId(actor.userId)
                : undefined,
              source: 'API',
              performedAt: new Date(),
            });
          }
        }

        if (options.legacyDto) {
          Object.assign(
            patch,
            this.buildPatchFromLegacyDto(
              order,
              options.legacyDto,
              order.finalFee,
            ),
          );
        }

        const ctx: OperationContext = {
          actorId: actor?.userId,
          canRevertPayments: this.canRevert(actor),
          reason: patch.reason,
          source: PaymentSource.MANUAL,
        };

        let removedLoans: any[] = [];
        try {
          const result = applyFinancialPatch(order, patch, ctx);
          auditEntries.push(...result.audit);
          removedLoans = result.removedLoans;
        } catch (error) {
          this.toBadRequest(error);
        }

        await this.createLoanTrackers(order, order.loans || [], session);
        for (const loan of removedLoans) {
          if (loan.loanId) {
            await this.emiModel.deleteOne({ _id: loan.loanId }, { session });
          }
        }
        await this.syncLoanTrackers(order.loans || [], session);

        recalculateOrderFinancials(order);
        this.assertValid(order, true);

        const revenueAfter = calculateActualRevenue(order).total;
        if (
          revenueAfter - revenueBefore > MONEY_EPSILON &&
          !this.canRecord(actor)
        ) {
          throw new ForbiddenException(
            'Recording received amounts requires the record_payment permission',
          );
        }

        await this.persist(order, guard, auditEntries, session, {
          ...(options.extraSet || {}),
          ...(patch.finalFee !== undefined ? { finalFee: order.finalFee } : {}),
        });
        return this.orderModel
          .findById(order._id)
          .session(session ?? null)
          .lean();
      }),
    );
  }

  /* =======================================================================
     CREDITS – manual verified payment / revert
     ======================================================================= */

  async markCreditPaid(
    orderId: string,
    creditId: string,
    input: {
      paymentReferenceId: string;
      amount: number;
      paymentDate?: string | Date;
      paymentMode?: string;
      remarks?: string;
    },
    actor: FinancialActor,
  ) {
    const reference = String(input.paymentReferenceId || '').trim();
    const key = `manual-credit-payment:${reference.toLowerCase()}`;
    try {
      return await this.withConcurrencyRetry(() =>
        this.runInTransaction(async (session) => {
          const order = await this.loadOrder(orderId, session);
          const guard = order.updatedAt;
          const auditEntries = await this.ensureV2(order, session);

          try {
            auditEntries.push(
              applyCreditPayment(
                order,
                creditId,
                {
                  amount: input.amount,
                  paymentReferenceId: reference,
                  paymentDate: input.paymentDate,
                  paymentMode: input.paymentMode,
                  remarks: input.remarks,
                  source: PaymentSource.MANUAL,
                  idempotencyKey: key,
                },
                { actorId: actor?.userId },
              ),
            );
          } catch (error) {
            this.toBadRequest(error);
          }

          await this.claimPaymentKey(
            key,
            {
              source: 'manual-credit-payment',
              orderId: order._id,
              targetType: 'credit',
              targetEntryId: String(creditId),
              amount: toMoney(input.amount),
              gatewayPaymentId: reference,
              processedBy: actor?.userId
                ? new Types.ObjectId(actor.userId)
                : undefined,
            },
            session,
          );

          recalculateOrderFinancials(order);
          await this.persist(order, guard, auditEntries, session);
          return this.orderModel
            .findById(order._id)
            .session(session ?? null)
            .lean();
        }),
      );
    } catch (error) {
      if (this.isDuplicatePaymentKey(error)) {
        throw new BadRequestException(
          `Payment reference ${reference} has already been used for another payment`,
        );
      }
      throw error;
    }
  }

  async revertCreditPayment(
    orderId: string,
    creditId: string,
    reason: string,
    actor: FinancialActor,
  ) {
    if (!this.canRevert(actor)) {
      throw new ForbiddenException(
        'Reverting a paid credit requires the revert permission',
      );
    }
    return this.withConcurrencyRetry(() =>
      this.runInTransaction(async (session) => {
        const order = await this.loadOrder(orderId, session);
        const guard = order.updatedAt;
        const auditEntries = await this.ensureV2(order, session);
        const credit = (order.credits || []).find(
          (c: any) => c._id?.toString() === String(creditId),
        );
        const previousKey = credit?.idempotencyKey;

        try {
          auditEntries.push(
            revertCreditPayment(order, creditId, {
              actorId: actor?.userId,
              canRevertPayments: this.canRevert(actor),
              reason,
            }),
          );
        } catch (error) {
          this.toBadRequest(error);
        }

        // Release the reference so a corrected payment can use it again;
        // the ledger row is kept (renamed) for audit purposes.
        if (previousKey) {
          await this.processedModel.updateOne(
            { key: previousKey },
            { $set: { key: `${previousKey}:reverted:${Date.now()}` } },
            { session },
          );
        }

        recalculateOrderFinancials(order);
        await this.persist(order, guard, auditEntries, session);
        return this.orderModel
          .findById(order._id)
          .session(session ?? null)
          .lean();
      }),
    );
  }

  /* =======================================================================
     GATEWAY PAYMENTS (idempotent)
     ======================================================================= */

  /**
   * Applies a successful payment-link payment. Target: a credit (exact
   * amount), a specific lumpsum entry, or FIFO across lumpsum entries.
   */
  async recordLinkPayment(input: {
    orderId: string;
    amount: number;
    gatewayPaymentKey: string;
    referenceId?: string;
    creditId?: string;
    lumpsumEntryId?: string;
    paidAt?: Date;
    paymentMode?: string;
  }): Promise<PaymentApplicationResult> {
    const key = `cashfree-link:${input.gatewayPaymentKey}`;
    if (await this.processedModel.exists({ key })) {
      return { status: 'DUPLICATE', key, orderId: input.orderId };
    }

    try {
      return await this.withConcurrencyRetry(() =>
        this.runInTransaction(async (session) => {
          const order = await this.loadOrder(input.orderId, session);
          const guard = order.updatedAt;
          const auditEntries = await this.ensureV2(order, session);
          const ctx: OperationContext = {
            auditSource: 'GATEWAY',
            now: input.paidAt,
          };
          let allocations: any;

          try {
            if (input.creditId) {
              auditEntries.push(
                applyCreditPayment(
                  order,
                  input.creditId,
                  {
                    amount: input.amount,
                    paymentReferenceId:
                      input.referenceId || input.gatewayPaymentKey,
                    paymentDate: input.paidAt,
                    paymentMode: input.paymentMode || 'Payment Link',
                    source: PaymentSource.GATEWAY,
                    idempotencyKey: key,
                  },
                  ctx,
                ),
              );
              allocations = [
                { creditId: input.creditId, amount: toMoney(input.amount) },
              ];
            } else {
              const result = allocateLumpsumPayment(
                order,
                {
                  amount: input.amount,
                  referenceId: input.referenceId,
                  paidAt: input.paidAt,
                  entryId: input.lumpsumEntryId,
                  idempotencyKey: key,
                  paymentMode: input.paymentMode,
                },
                ctx,
              );
              auditEntries.push(...result.audit);
              allocations = result.allocations;
            }
          } catch (error) {
            this.toBadRequest(error);
          }

          await this.claimPaymentKey(
            key,
            {
              source: 'cashfree-link',
              orderId: order._id,
              targetType: input.creditId ? 'credit' : 'lumpsum',
              targetEntryId: input.creditId || input.lumpsumEntryId,
              amount: toMoney(input.amount),
              gatewayPaymentId: input.referenceId,
              allocations,
            },
            session,
          );

          recalculateOrderFinancials(order);
          await this.persist(order, guard, auditEntries, session);
          return {
            status: 'APPLIED' as const,
            key,
            orderId: order._id.toString(),
            allocations,
          };
        }),
      );
    } catch (error) {
      if (this.isDuplicatePaymentKey(error)) {
        return { status: 'DUPLICATE', key, orderId: input.orderId };
      }
      throw error;
    }
  }

  /** Applies a successful subscription installment payment. */
  async recordSubscriptionPayment(input: {
    orderId?: string;
    gatewaySubscriptionId?: string;
    cashfreeSubscriptionId?: string;
    subscriptionEntryId?: string;
    gatewayPaymentId: string;
    amount: number;
    paidAt?: Date;
    installmentNo?: number;
    subscriptionPaymentRecordId?: any;
  }): Promise<PaymentApplicationResult> {
    const key = `cashfree-subscription:${input.gatewayPaymentId}`;
    if (await this.processedModel.exists({ key })) {
      return { status: 'DUPLICATE', key, orderId: input.orderId };
    }

    let orderId = input.orderId;
    if (!orderId) {
      const or: any[] = [];
      if (input.gatewaySubscriptionId) {
        or.push({
          'subscriptions.gatewaySubscriptionId': input.gatewaySubscriptionId,
        });
      }
      if (input.cashfreeSubscriptionId) {
        or.push({
          'subscriptions.cashfreeSubscriptionId': input.cashfreeSubscriptionId,
        });
        or.push({
          'subscriptionDetails.cashfreeSubscriptionId':
            input.cashfreeSubscriptionId,
        });
      }
      const found = or.length
        ? await this.orderModel.findOne({ $or: or }).select('_id').lean()
        : null;
      if (!found && input.gatewaySubscriptionId) {
        const sub = await this.subscriptionModel
          .findOne({ subscriptionId: input.gatewaySubscriptionId })
          .select('orderId')
          .lean();
        orderId = sub?.orderId?.toString();
      } else {
        orderId = found?._id?.toString();
      }
    }
    if (!orderId) {
      throw new NotFoundException('Order for subscription payment not found');
    }

    try {
      return await this.withConcurrencyRetry(() =>
        this.runInTransaction(async (session) => {
          const order = await this.loadOrder(orderId, session);
          const guard = order.updatedAt;
          const auditEntries = await this.ensureV2(order, session);

          let result: any;
          try {
            result = applySubscriptionGatewayPayment(
              order,
              {
                gatewaySubscriptionId: input.gatewaySubscriptionId,
                cashfreeSubscriptionId: input.cashfreeSubscriptionId,
                subscriptionEntryId: input.subscriptionEntryId,
                gatewayPaymentId: input.gatewayPaymentId,
                amount: input.amount,
                paidAt: input.paidAt,
                installmentNo: input.installmentNo,
                idempotencyKey: key,
                subscriptionPaymentRecordId: input.subscriptionPaymentRecordId,
              },
              { auditSource: 'GATEWAY', now: input.paidAt },
            );
          } catch (error) {
            this.toBadRequest(error);
          }

          await this.claimPaymentKey(
            key,
            {
              source: 'cashfree-subscription',
              orderId: order._id,
              targetType: 'subscription',
              targetEntryId: result.entryId,
              amount: toMoney(input.amount),
              gatewayPaymentId: input.gatewayPaymentId,
            },
            session,
          );

          if (!result.applied) {
            // Already present (e.g. imported by the migration) – nothing to add.
            return {
              status: 'DUPLICATE' as const,
              key,
              orderId: order._id.toString(),
            };
          }
          if (result.audit) auditEntries.push(result.audit);

          recalculateOrderFinancials(order);
          await this.persist(order, guard, auditEntries, session);
          return {
            status: 'APPLIED' as const,
            key,
            orderId: order._id.toString(),
            allocations: { subscriptionEntryId: result.entryId },
          };
        }),
      );
    } catch (error) {
      if (this.isDuplicatePaymentKey(error)) {
        return { status: 'DUPLICATE', key, orderId };
      }
      throw error;
    }
  }

  /**
   * Links a Cashfree subscription to a subscription entry of the order.
   * Returns the entry the subscription was attached to.
   */
  async linkSubscriptionEntry(
    orderId: string,
    entryId: string | undefined,
    link: {
      gatewaySubscriptionId: string;
      cashfreeSubscriptionId?: string;
      subscriptionRef?: any;
      status?: string;
      firstInstallmentDate?: Date;
      lastInstallmentDate?: Date;
    },
  ) {
    return this.withConcurrencyRetry(() =>
      this.runInTransaction(async (session) => {
        const order = await this.loadOrder(orderId, session);
        const guard = order.updatedAt;
        const auditEntries = await this.ensureV2(order, session);
        const subs: any[] = order.subscriptions || [];
        const entry = entryId
          ? subs.find((s) => s._id?.toString() === String(entryId))
          : subs.find(
              (s) => !s.gatewaySubscriptionId && !s.cashfreeSubscriptionId,
            ) || (subs.length === 1 ? subs[0] : undefined);
        if (!entry) {
          throw new BadRequestException(
            entryId
              ? `Subscription entry ${entryId} not found on this order`
              : 'No unlinked subscription plan found on this order; pass subscriptionEntryId',
          );
        }
        if (
          entry.gatewaySubscriptionId &&
          entry.gatewaySubscriptionId !== link.gatewaySubscriptionId
        ) {
          throw new BadRequestException(
            'This subscription plan is already linked to another gateway subscription',
          );
        }
        const before = { ...entry, paymentHistory: undefined };
        entry.gatewaySubscriptionId = link.gatewaySubscriptionId;
        entry.cashfreeSubscriptionId =
          link.cashfreeSubscriptionId || entry.cashfreeSubscriptionId;
        entry.subscriptionRef = link.subscriptionRef || entry.subscriptionRef;
        entry.status = link.status || entry.status;
        entry.gateway = 'Cashfree';
        auditEntries.push({
          action: 'SUBSCRIPTION_LINKED',
          entryType: 'subscription',
          entryId: entry._id.toString(),
          before,
          after: {
            gatewaySubscriptionId: entry.gatewaySubscriptionId,
            cashfreeSubscriptionId: entry.cashfreeSubscriptionId,
          },
          source: 'SYSTEM',
          performedAt: new Date(),
        });
        recalculateOrderFinancials(order);
        await this.persist(order, guard, auditEntries, session);
        return entry;
      }),
    );
  }

  /** Updates the gateway status of a subscription entry (no money movement). */
  async updateSubscriptionEntryStatus(
    ref: { gatewaySubscriptionId?: string; cashfreeSubscriptionId?: string },
    status: string,
  ) {
    const or: any[] = [];
    if (ref.gatewaySubscriptionId)
      or.push({ gatewaySubscriptionId: ref.gatewaySubscriptionId });
    if (ref.cashfreeSubscriptionId)
      or.push({ cashfreeSubscriptionId: ref.cashfreeSubscriptionId });
    if (!or.length || !status) return;
    await this.orderModel.updateOne(
      { subscriptions: { $elemMatch: { $or: or } } },
      { $set: { 'subscriptions.$.status': status } },
    );
  }

  /* =======================================================================
     APPROVAL / READ
     ======================================================================= */

  /**
   * Validates that the order is balanced before approval and returns the
   * (possibly upgraded) financial fields to persist with the approval.
   */
  async prepareApproval(orderId: string, session?: ClientSession) {
    const order = await this.loadOrder(orderId, session);
    const auditEntries = await this.ensureV2(order, session);
    recalculateOrderFinancials(order);
    const errors = validateOrderFinancials(order, { requireBalanced: true });
    if (errors.length) {
      throw new BadRequestException({
        success: false,
        message:
          'Order cannot be approved until its payment coverage plus credits equals finalFee',
        errors,
      });
    }
    return { order, auditEntries, guard: order.updatedAt };
  }

  async approve(orderId: string, approvedBy: string) {
    return this.withConcurrencyRetry(() =>
      this.runInTransaction(async (session) => {
        const { order, auditEntries, guard } = await this.prepareApproval(
          orderId,
          session,
        );
        auditEntries.push({
          action: 'ORDER_APPROVED',
          entryType: 'order',
          entryId: order._id.toString(),
          performedBy: new Types.ObjectId(approvedBy),
          source: 'API',
          performedAt: new Date(),
        });
        await this.persist(order, guard, auditEntries, session, {
          Approved: true,
          // same representation as the previous approval workflow
          approvedBy,
        });
        return this.orderModel.findById(orderId).session(session ?? null);
      }),
    );
  }

  /** Financial view of an order (legacy orders are upgraded in memory only). */
  async getFinancialSummary(orderId: string) {
    const order = await this.loadOrder(orderId);
    const legacy = !isV2Order(order);
    if (legacy) {
      upgradeLegacyOrder(order, await this.loadLegacyExtras(order._id));
    } else {
      recalculateOrderFinancials(order);
    }
    const revenue = calculateActualRevenue(order);
    return {
      orderId: order._id,
      finalFee: order.finalFee,
      approved: !!order.Approved,
      paymentSchemaVersion: legacy ? 1 : order.paymentSchemaVersion,
      migrated: !legacy,
      paymentMode: order.paymentMode,
      paymentModes: order.paymentModes,
      status: order.status,
      coverage: calculatePlannedCoverage(order),
      /** Revenue as counted by the reports (loans: disbursed amount). */
      revenue,
      /** Received on the order (loans: loan amount). */
      received: calculateReceivedAmounts(order),
      summary: order.paymentSummary,
      validationErrors: validateOrderFinancials(order, {
        requireBalanced: true,
      }),
      lumpsumPayments: order.lumpsumPayments,
      loans: order.loans,
      subscriptions: order.subscriptions,
      credits: order.credits,
      financialAuditLog: order.financialAuditLog || [],
    };
  }
}
