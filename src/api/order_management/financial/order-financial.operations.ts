/**
 * Pure (DB-free) operations that mutate an order's financial structure.
 * Each function works on a plain order object, records audit entries and
 * leaves recalculation/validation to the caller (OrderFinancialService),
 * which always re-validates the complete order before saving.
 */
import { Types } from 'mongoose';
import {
  CreditStatus,
  LoanDisbursementStatus,
  LumpsumPaymentStatus,
  PaymentSource,
} from 'src/schema/order_Management/order.schema';
import {
  deriveCreditStatus,
  FinancialContext,
  getBusinessTimezone,
  MONEY_EPSILON,
  moneyEquals,
  normalizeCreditInput,
  normalizeLoanInput,
  normalizeLumpsumInput,
  normalizeSubscriptionInput,
  SUBSCRIPTION_SUCCESS_STATUS,
  toDateKey,
  toDateOrUndefined,
  toMoney,
} from './order-financial.util';

export class FinancialOperationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '));
  }
}

export interface AuditEntry {
  action: string;
  entryType?: string;
  entryId?: string;
  before?: any;
  after?: any;
  reason?: string;
  performedBy?: Types.ObjectId;
  source?: string;
  performedAt: Date;
}

export interface OperationContext extends FinancialContext {
  /** Holder of the revert permission (allows reducing received amounts / reverting paid credits). */
  canRevertPayments?: boolean;
  reason?: string;
  auditSource?: string;
}

const idOf = (value: any) => (value?._id ?? value)?.toString?.();

const actorObjectId = (ctx: OperationContext) =>
  ctx.actorId && Types.ObjectId.isValid(ctx.actorId)
    ? new Types.ObjectId(ctx.actorId)
    : undefined;

function snapshot(value: any) {
  if (!value) return value;
  const plain = typeof value.toObject === 'function' ? value.toObject() : value;
  return JSON.parse(JSON.stringify(plain));
}

function audit(
  ctx: OperationContext,
  action: string,
  entryType: string,
  entryId: string | undefined,
  before: any,
  after: any,
): AuditEntry {
  return {
    action,
    entryType,
    entryId,
    before: snapshot(before),
    after: snapshot(after),
    reason: ctx.reason,
    performedBy: actorObjectId(ctx),
    source: ctx.auditSource || 'API',
    performedAt: ctx.now || new Date(),
  };
}

const sameDate = (a: any, b: any) => {
  const da = toDateOrUndefined(a);
  const db = toDateOrUndefined(b);
  if (!da && !db) return true;
  if (!da || !db) return false;
  return da.getTime() === db.getTime();
};

const sameId = (a: any, b: any) => (idOf(a) || '') === (idOf(b) || '');

const provided = (obj: any, key: string) =>
  obj &&
  Object.prototype.hasOwnProperty.call(obj, key) &&
  obj[key] !== undefined;

/* =========================================================================
   PATCH (add / update / remove entries)
   ========================================================================= */

export interface FinancialPatch {
  lumpsumPayments?: any[];
  loans?: any[];
  subscriptions?: any[];
  credits?: any[];
}

/**
 * Applies a financial patch. For each array present in the patch:
 *  - items with an `_id` update the existing entry (with protections),
 *  - items without `_id` are added,
 *  - existing entries missing from the array are removed (only when nothing
 *    has been received on them).
 * Arrays not present in the patch are left untouched.
 */
export function applyFinancialPatch(
  order: any,
  patch: FinancialPatch,
  ctx: OperationContext = {},
): { audit: AuditEntry[]; removedLoans: any[] } {
  const errors: string[] = [];
  const auditEntries: AuditEntry[] = [];
  const removedLoans: any[] = [];

  const reconcile = (
    key: keyof FinancialPatch,
    entryType: string,
    normalize: (input: any) => any,
    update: (existing: any, input: any, label: string) => void,
    canRemove: (existing: any) => string | null,
  ) => {
    const incoming = patch[key];
    if (!Array.isArray(incoming)) return;
    const current: any[] = order[key] || [];
    const byId = new Map(current.map((e: any) => [idOf(e), e]));
    const keep = new Set<string>();
    const next: any[] = [];

    incoming.forEach((input: any, index: number) => {
      const label = `${key}[${index}]`;
      const id = input?._id ? String(input._id) : undefined;
      if (id) {
        const existing = byId.get(id);
        if (!existing) {
          errors.push(
            `${label}: ${entryType} entry ${id} not found on this order`,
          );
          return;
        }
        if (keep.has(id)) {
          errors.push(`${label}: ${entryType} entry ${id} listed twice`);
          return;
        }
        keep.add(id);
        const before = snapshot(existing);
        update(existing, input, label);
        if (JSON.stringify(before) !== JSON.stringify(snapshot(existing))) {
          auditEntries.push(
            audit(ctx, 'UPDATE', entryType, id, before, existing),
          );
        }
        next.push(existing);
      } else {
        const created = normalize(input);
        auditEntries.push(
          audit(ctx, 'ADD', entryType, idOf(created), null, created),
        );
        next.push(created);
      }
    });

    for (const existing of current) {
      const id = idOf(existing);
      if (keep.has(id)) continue;
      const blocker = canRemove(existing);
      if (blocker) {
        errors.push(`Cannot remove ${entryType} entry ${id}: ${blocker}`);
        next.push(existing);
        continue;
      }
      if (key === 'loans') removedLoans.push(existing);
      auditEntries.push(audit(ctx, 'REMOVE', entryType, id, existing, null));
    }

    order[key] = next;
  };

  /* ---------------- LUMPSUM ---------------- */
  reconcile(
    'lumpsumPayments',
    'lumpsum',
    (input) => normalizeLumpsumInput(input, ctx),
    (existing, input, label) => {
      const received = toMoney(existing.amountReceived);

      // registrationAmount is a record of what was paid at registration; it
      // moves no money. amountReceived is the money received on the entry
      // (registration + later payments) and is what counts.
      if (provided(input, 'registrationAmount')) {
        existing.registrationAmount = toMoney(input.registrationAmount);
      }

      if (provided(input, 'amountReceived')) {
        const requested = toMoney(input.amountReceived);
        const difference = toMoney(requested - received);
        if (difference < -MONEY_EPSILON && !ctx.canRevertPayments) {
          errors.push(
            `${label}: amountReceived cannot be reduced from ${received} to ${requested} without the revert permission`,
          );
        } else if (difference < -MONEY_EPSILON && !ctx.reason) {
          errors.push(
            `${label}: a reason is required to reduce a received amount`,
          );
        } else if (Math.abs(difference) >= MONEY_EPSILON) {
          existing.receipts = existing.receipts || [];
          existing.receipts.push({
            amount: difference,
            receivedAt:
              toDateOrUndefined(input.paymentDate) || ctx.now || new Date(),
            referenceId: input.transactionId || existing.transactionId,
            source: PaymentSource.MANUAL,
            recordedBy: actorObjectId(ctx),
            remarks:
              difference < 0
                ? `Received amount reduced: ${ctx.reason}`
                : input.remarks,
          });
          // The lumpsum covers the fee with what has been received. An older
          // entry planned for more than was received keeps its plan until the
          // received amount goes beyond it.
          if (
            moneyEquals(existing.amount, received) ||
            requested > toMoney(existing.amount)
          ) {
            existing.amount = requested;
          }
          existing.amountReceived = requested;
        }
      } else if (provided(input, 'amount')) {
        existing.amount = toMoney(input.amount);
      }

      const lockedWhenReceived: Array<[string, (a: any, b: any) => boolean]> = [
        ['transactionId', (a, b) => (a || '') === (b || '')],
        ['paymentDate', sameDate],
        ['paymentMode', (a, b) => (a || '') === (b || '')],
      ];
      for (const [fieldName, equals] of lockedWhenReceived) {
        if (!provided(input, fieldName)) continue;
        if (
          received > 0 &&
          !ctx.canRevertPayments &&
          !equals(existing[fieldName], input[fieldName])
        ) {
          if (fieldName === 'transactionId' && !existing.transactionId) {
            existing.transactionId = input.transactionId; // filling a missing reference is allowed
            continue;
          }
          errors.push(
            `${label}: ${fieldName} of a received payment cannot be modified`,
          );
          continue;
        }
        existing[fieldName] =
          fieldName === 'paymentDate'
            ? toDateOrUndefined(input[fieldName])
            : input[fieldName];
      }

      if (provided(input, 'status') && input.status !== existing.status) {
        if (input.status === LumpsumPaymentStatus.REFUNDED) {
          if (!ctx.canRevertPayments) {
            errors.push(
              `${label}: marking a payment Refunded requires the revert permission`,
            );
          } else if (!ctx.reason) {
            errors.push(
              `${label}: a reason is required to mark a payment Refunded`,
            );
          } else {
            existing.status = LumpsumPaymentStatus.REFUNDED;
          }
        } else if (input.status === LumpsumPaymentStatus.FAILED) {
          if (toMoney(existing.amountReceived) > 0) {
            errors.push(
              `${label}: a payment with received amount cannot be marked Failed`,
            );
          } else {
            existing.status = LumpsumPaymentStatus.FAILED;
          }
        } else if (existing.status === LumpsumPaymentStatus.REFUNDED) {
          errors.push(`${label}: a Refunded payment cannot be reopened`);
        } else if (existing.status === LumpsumPaymentStatus.FAILED) {
          existing.status = LumpsumPaymentStatus.PENDING; // retry of a failed payment
        }
      }
      if (provided(input, 'remarks')) existing.remarks = input.remarks;
    },
    (existing) => {
      if (!(toMoney(existing.amountReceived) > 0)) return null;
      if (!ctx.canRevertPayments) {
        return 'payments have already been received on it (removing it requires the revert permission)';
      }
      if (!ctx.reason) {
        return 'a reason is required to remove a payment that has been received';
      }
      return null;
    },
  );

  /* ---------------- LOANS ---------------- */
  reconcile(
    'loans',
    'loan',
    (input) => normalizeLoanInput(input, ctx),
    (existing, input, label) => {
      const disbursed = toMoney(existing.disbursementAmount);
      if (provided(input, 'disbursementAmount')) {
        const requested = toMoney(input.disbursementAmount);
        if (requested < disbursed - MONEY_EPSILON && !ctx.canRevertPayments) {
          errors.push(
            `${label}: disbursementAmount cannot be reduced from ${disbursed} to ${requested} without the revert permission`,
          );
        } else if (requested < disbursed - MONEY_EPSILON && !ctx.reason) {
          errors.push(
            `${label}: a reason is required to reduce a disbursement`,
          );
        } else {
          existing.disbursementAmount = requested;
        }
      }
      if (
        provided(input, 'loanPartner') &&
        !sameId(existing.loanPartner, input.loanPartner)
      ) {
        if (disbursed > 0) {
          errors.push(
            `${label}: loanPartner of a disbursed loan cannot be changed`,
          );
        } else {
          existing.loanPartner = new Types.ObjectId(String(input.loanPartner));
        }
      }
      if (provided(input, 'loanAmount'))
        existing.loanAmount = toMoney(input.loanAmount);
      for (const dateField of [
        'loanDate',
        'firstEmiDate',
        'disbursementDate',
      ]) {
        if (provided(input, dateField))
          existing[dateField] = toDateOrUndefined(input[dateField]);
      }
      for (const textField of ['partnerLoanReference', 'remarks']) {
        if (provided(input, textField)) existing[textField] = input[textField];
      }
      // Loan status follows from the disbursed amount; only Cancelled can be
      // set explicitly. Any other value is ignored.
      if (input.disbursementStatus === LoanDisbursementStatus.CANCELLED) {
        if (toMoney(existing.disbursementAmount) > 0) {
          errors.push(`${label}: a disbursed loan cannot be Cancelled`);
        } else {
          existing.disbursementStatus = LoanDisbursementStatus.CANCELLED;
        }
      } else if (
        existing.disbursementStatus !== LoanDisbursementStatus.CANCELLED
      ) {
        existing.disbursementStatus = undefined; // derived on recalculation
      }
    },
    (existing) =>
      toMoney(existing.disbursementAmount) > 0
        ? 'the loan has been disbursed'
        : null,
  );

  /* ---------------- SUBSCRIPTIONS ---------------- */
  reconcile(
    'subscriptions',
    'subscription',
    (input) => {
      const created = normalizeSubscriptionInput(
        {
          ...input,
          paymentHistory: [],
          cashfreeSubscriptionId: undefined,
          gatewaySubscriptionId: undefined,
          subscriptionRef: undefined,
        },
        ctx,
      );
      return created;
    },
    (existing, input, label) => {
      const linked =
        !!existing.cashfreeSubscriptionId ||
        !!existing.gatewaySubscriptionId ||
        (existing.paymentHistory || []).length > 0;
      const planFields: Array<
        [string, (a: any, b: any) => boolean, (v: any) => any]
      > = [
        ['installmentAmount', moneyEquals, toMoney],
        ['numberOfInstallments', (a, b) => Number(a) === Number(b), Number],
        ['firstInstallmentDate', sameDate, toDateOrUndefined],
        ['lastInstallmentDate', sameDate, toDateOrUndefined],
      ];
      for (const [fieldName, equals, convert] of planFields) {
        if (!provided(input, fieldName)) continue;
        if (equals(existing[fieldName], input[fieldName])) continue;
        if (linked) {
          errors.push(
            `${label}: ${fieldName} cannot be changed after the subscription is linked to the gateway or has payments`,
          );
          continue;
        }
        existing[fieldName] = convert(input[fieldName]);
        if (fieldName !== 'lastInstallmentDate')
          existing.lastInstallmentDate = undefined;
      }
      if (provided(input, 'remarks')) existing.remarks = input.remarks;
      for (const protectedField of [
        'paymentHistory',
        'totalReceived',
        'cashfreeSubscriptionId',
        'gatewaySubscriptionId',
      ]) {
        if (provided(input, protectedField)) {
          errors.push(
            `${label}: ${protectedField} is managed by the payment gateway and cannot be edited`,
          );
        }
      }
    },
    (existing) =>
      existing.cashfreeSubscriptionId ||
      existing.gatewaySubscriptionId ||
      (existing.paymentHistory || []).length
        ? 'the subscription is linked to the gateway or has payments'
        : null,
  );

  /* ---------------- CREDITS ---------------- */
  reconcile(
    'credits',
    'credit',
    (input) => {
      if (input?.status === CreditStatus.PAID) {
        errors.push(
          'A new credit cannot be created as Paid; record the payment against it instead',
        );
      }
      return normalizeCreditInput(input, ctx);
    },
    (existing, input, label) => {
      const isPaid = existing.status === CreditStatus.PAID;
      const amountChanged =
        provided(input, 'amount') &&
        !moneyEquals(existing.amount, input.amount);
      const dueChanged =
        provided(input, 'dueDate') &&
        !sameDate(existing.dueDate, input.dueDate);
      if (isPaid && (amountChanged || dueChanged)) {
        errors.push(
          `${label}: a Paid credit cannot be modified; revert it first`,
        );
        return;
      }
      if (provided(input, 'status') && input.status !== existing.status) {
        if (input.status === CreditStatus.PAID) {
          errors.push(
            `${label}: use the credit payment API to mark a credit Paid`,
          );
        } else if (isPaid) {
          errors.push(
            `${label}: use the credit revert API to reopen a Paid credit`,
          );
        }
        // Pending/Overdue are derived from the due date.
      }
      const remarksChanged =
        provided(input, 'remarks') &&
        (existing.remarks || '') !== (input.remarks || '');
      if (amountChanged) existing.amount = toMoney(input.amount);
      if (dueChanged) existing.dueDate = toDateOrUndefined(input.dueDate);
      if (remarksChanged) existing.remarks = input.remarks;
      if (amountChanged || dueChanged || remarksChanged) {
        existing.updatedAt = ctx.now || new Date();
      }
    },
    (existing) =>
      existing.status === CreditStatus.PAID ? 'the credit has been paid' : null,
  );

  if (errors.length) throw new FinancialOperationError(errors);
  return { audit: auditEntries, removedLoans };
}

/* =========================================================================
   CREDITS – PAY / REVERT
   ========================================================================= */

export interface CreditPaymentInput {
  amount: number;
  paymentReferenceId: string;
  paymentDate?: Date | string;
  paymentMode?: string;
  remarks?: string;
  source: PaymentSource;
  idempotencyKey?: string;
}

export function applyCreditPayment(
  order: any,
  creditId: string,
  input: CreditPaymentInput,
  ctx: OperationContext = {},
): AuditEntry {
  const credit = (order.credits || []).find(
    (c: any) => idOf(c) === String(creditId),
  );
  if (!credit)
    throw new FinancialOperationError([
      `Credit ${creditId} not found on this order`,
    ]);
  if (credit.status === CreditStatus.PAID) {
    throw new FinancialOperationError([`Credit ${creditId} is already Paid`]);
  }
  if (!input.paymentReferenceId || !String(input.paymentReferenceId).trim()) {
    throw new FinancialOperationError([
      'paymentReferenceId is required to mark a credit Paid',
    ]);
  }
  if (!moneyEquals(input.amount, credit.amount)) {
    throw new FinancialOperationError([
      `Payment amount (${toMoney(input.amount)}) must equal the credit amount (${toMoney(credit.amount)})`,
    ]);
  }

  const before = snapshot(credit);
  const now = ctx.now || new Date();
  credit.statusHistory = credit.statusHistory || [];
  credit.statusHistory.push({
    from: credit.status,
    to: CreditStatus.PAID,
    reason: input.remarks || `Payment ${input.paymentReferenceId}`,
    changedBy: actorObjectId(ctx),
    changedAt: now,
  });
  credit.status = CreditStatus.PAID;
  credit.paymentDate = toDateOrUndefined(input.paymentDate) || now;
  credit.paymentReferenceId = String(input.paymentReferenceId).trim();
  credit.paymentMode = input.paymentMode;
  credit.paidVia = input.source;
  credit.verifiedBy =
    input.source === PaymentSource.MANUAL ? actorObjectId(ctx) : undefined;
  credit.idempotencyKey = input.idempotencyKey;
  if (input.remarks) credit.remarks = input.remarks;
  credit.updatedAt = now;

  return audit(
    { ...ctx, reason: ctx.reason || input.remarks },
    'CREDIT_PAID',
    'credit',
    idOf(credit),
    before,
    credit,
  );
}

export function revertCreditPayment(
  order: any,
  creditId: string,
  ctx: OperationContext,
): AuditEntry {
  if (!ctx.canRevertPayments) {
    throw new FinancialOperationError([
      'Reverting a paid credit requires the revert permission',
    ]);
  }
  if (!ctx.reason || !ctx.reason.trim()) {
    throw new FinancialOperationError([
      'A reason is required to revert a paid credit',
    ]);
  }
  const credit = (order.credits || []).find(
    (c: any) => idOf(c) === String(creditId),
  );
  if (!credit)
    throw new FinancialOperationError([
      `Credit ${creditId} not found on this order`,
    ]);
  if (credit.status !== CreditStatus.PAID) {
    throw new FinancialOperationError([`Credit ${creditId} is not Paid`]);
  }

  const before = snapshot(credit);
  const now = ctx.now || new Date();
  const timeZone = getBusinessTimezone();
  const reopened = deriveCreditStatus(
    { ...snapshot(credit), status: CreditStatus.PENDING },
    toDateKey(now, timeZone),
    timeZone,
  );
  credit.statusHistory = credit.statusHistory || [];
  credit.statusHistory.push({
    from: CreditStatus.PAID,
    to: reopened,
    reason: `${ctx.reason} (reverted payment ${credit.paymentReferenceId})`,
    changedBy: actorObjectId(ctx),
    changedAt: now,
  });
  credit.status = reopened;
  credit.paymentDate = undefined;
  credit.paymentReferenceId = undefined;
  credit.paymentMode = undefined;
  credit.paidVia = undefined;
  credit.verifiedBy = undefined;
  credit.idempotencyKey = undefined;
  credit.updatedAt = now;

  return audit(
    ctx,
    'CREDIT_PAYMENT_REVERTED',
    'credit',
    idOf(credit),
    before,
    credit,
  );
}

/* =========================================================================
   GATEWAY PAYMENTS
   ========================================================================= */

export interface LumpsumGatewayPayment {
  amount: number;
  referenceId?: string;
  paidAt?: Date;
  entryId?: string;
  idempotencyKey: string;
  source?: PaymentSource;
  paymentMode?: string;
}

/**
 * Allocates a received payment to lumpsum entries (the targeted entry, or
 * FIFO across entries with an outstanding balance). Any excess beyond the
 * planned lumpsum amounts is recorded as an explicit "unplanned" entry so
 * that received money is never dropped; the order then reports
 * OVER_COVERED and the excess is visible in the audit log.
 */
export function allocateLumpsumPayment(
  order: any,
  payment: LumpsumGatewayPayment,
  ctx: OperationContext = {},
) {
  const amount = toMoney(payment.amount);
  if (!(amount > 0))
    throw new FinancialOperationError([
      'Payment amount must be greater than 0',
    ]);

  order.lumpsumPayments = order.lumpsumPayments || [];
  const now = payment.paidAt || ctx.now || new Date();
  const active = order.lumpsumPayments.filter(
    (e: any) =>
      e.status !== LumpsumPaymentStatus.REFUNDED &&
      e.status !== LumpsumPaymentStatus.FAILED,
  );

  let candidates = active;
  if (payment.entryId) {
    const target = order.lumpsumPayments.find(
      (e: any) => idOf(e) === String(payment.entryId),
    );
    if (!target) {
      throw new FinancialOperationError([
        `Lumpsum entry ${payment.entryId} not found on this order`,
      ]);
    }
    candidates = [target];
  }

  let remaining = amount;
  const allocations: Array<{ entryId: string; amount: number }> = [];
  for (const entry of candidates) {
    if (remaining <= 0) break;
    const outstanding = toMoney(
      toMoney(entry.amount) - toMoney(entry.amountReceived),
    );
    if (outstanding <= 0) continue;
    const portion = Math.min(outstanding, remaining);
    entry.receipts = entry.receipts || [];
    entry.receipts.push({
      amount: toMoney(portion),
      receivedAt: now,
      referenceId: payment.referenceId,
      source: payment.source || PaymentSource.GATEWAY,
      idempotencyKey: payment.idempotencyKey,
    });
    entry.amountReceived = toMoney(toMoney(entry.amountReceived) + portion);
    if (!entry.transactionId && payment.referenceId)
      entry.transactionId = payment.referenceId;
    if (!entry.paymentDate) entry.paymentDate = now;
    allocations.push({ entryId: idOf(entry), amount: toMoney(portion) });
    remaining = toMoney(remaining - portion);
  }

  const auditEntries: AuditEntry[] = [];
  if (remaining > 0) {
    const unplanned = normalizeLumpsumInput(
      {
        amount: remaining,
        transactionId: payment.referenceId,
        paymentDate: now,
        paymentMode: payment.paymentMode || 'Payment Link',
        origin: 'UNPLANNED_GATEWAY_EXCESS',
        remarks: 'Gateway payment exceeded the planned lumpsum balance',
        receipts: [
          {
            amount: remaining,
            receivedAt: now,
            referenceId: payment.referenceId,
            source: payment.source || PaymentSource.GATEWAY,
            idempotencyKey: payment.idempotencyKey,
          },
        ],
      },
      ctx,
    );
    order.lumpsumPayments.push(unplanned);
    allocations.push({ entryId: idOf(unplanned), amount: remaining });
    auditEntries.push(
      audit(
        { ...ctx, reason: 'Gateway payment exceeded planned lumpsum balance' },
        'UNPLANNED_PAYMENT',
        'lumpsum',
        idOf(unplanned),
        null,
        unplanned,
      ),
    );
  }

  auditEntries.unshift(
    audit(
      ctx,
      'LUMPSUM_PAYMENT_RECEIVED',
      'lumpsum',
      allocations.map((a) => a.entryId).join(','),
      null,
      {
        amount,
        referenceId: payment.referenceId,
        allocations,
        idempotencyKey: payment.idempotencyKey,
      },
    ),
  );

  return { allocations, audit: auditEntries };
}

export interface SubscriptionGatewayPayment {
  gatewaySubscriptionId?: string;
  cashfreeSubscriptionId?: string;
  subscriptionEntryId?: string;
  gatewayPaymentId: string;
  amount: number;
  paidAt?: Date;
  installmentNo?: number;
  idempotencyKey: string;
  subscriptionPaymentRecordId?: any;
}

export function findSubscriptionEntry(
  order: any,
  ref: Partial<SubscriptionGatewayPayment>,
) {
  const subs: any[] = order.subscriptions || [];
  const match =
    (ref.subscriptionEntryId &&
      subs.find((s) => idOf(s) === String(ref.subscriptionEntryId))) ||
    (ref.gatewaySubscriptionId &&
      subs.find(
        (s) => s.gatewaySubscriptionId === ref.gatewaySubscriptionId,
      )) ||
    (ref.cashfreeSubscriptionId &&
      subs.find(
        (s) => s.cashfreeSubscriptionId === ref.cashfreeSubscriptionId,
      ));
  if (match) return match;
  return subs.length === 1 ? subs[0] : undefined;
}

/** Returns false when the gateway payment is already in the history (duplicate). */
export function applySubscriptionGatewayPayment(
  order: any,
  payment: SubscriptionGatewayPayment,
  ctx: OperationContext = {},
): { applied: boolean; entryId?: string; audit?: AuditEntry } {
  const entry = findSubscriptionEntry(order, payment);
  if (!entry) {
    throw new FinancialOperationError([
      'Unable to identify the subscription plan on the order for this payment',
    ]);
  }
  entry.paymentHistory = entry.paymentHistory || [];
  if (
    entry.paymentHistory.some(
      (p: any) => p.gatewayPaymentId === payment.gatewayPaymentId,
    )
  ) {
    return { applied: false, entryId: idOf(entry) };
  }
  const amount = toMoney(payment.amount);
  if (!(amount > 0))
    throw new FinancialOperationError([
      'Payment amount must be greater than 0',
    ]);

  entry.paymentHistory.push({
    gatewayPaymentId: payment.gatewayPaymentId,
    amount,
    status: SUBSCRIPTION_SUCCESS_STATUS,
    paidAt: payment.paidAt || ctx.now || new Date(),
    installmentNo: payment.installmentNo,
    source: PaymentSource.GATEWAY,
    idempotencyKey: payment.idempotencyKey,
    subscriptionPaymentRecordId: payment.subscriptionPaymentRecordId,
  });
  if (payment.gatewaySubscriptionId && !entry.gatewaySubscriptionId) {
    entry.gatewaySubscriptionId = payment.gatewaySubscriptionId;
  }
  if (payment.cashfreeSubscriptionId && !entry.cashfreeSubscriptionId) {
    entry.cashfreeSubscriptionId = payment.cashfreeSubscriptionId;
  }

  return {
    applied: true,
    entryId: idOf(entry),
    audit: audit(
      ctx,
      'SUBSCRIPTION_PAYMENT_RECEIVED',
      'subscription',
      idOf(entry),
      null,
      {
        gatewayPaymentId: payment.gatewayPaymentId,
        amount,
        installmentNo: payment.installmentNo,
      },
    ),
  };
}
