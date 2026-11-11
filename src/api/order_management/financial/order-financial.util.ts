/**
 * ============================================================================
 *  ORDER FINANCIALS – SINGLE SOURCE OF TRUTH
 * ============================================================================
 *
 * Every calculation about an order's money lives here:
 *   - planned payment coverage (what the payment sources are expected to pay)
 *   - actual received revenue (what has really been received)
 *   - validation of the financial structure
 *   - MongoDB aggregation expressions used by every report
 *   - mapping of the legacy (v1) single-object structure into v2 arrays
 *
 * Definitions
 * -----------
 * Lumpsum entries carry a registrationAmount (what was paid at registration,
 * a record only) and amountReceived (registration + later payments). The
 * entry covers the fee with what has been received: planned = amountReceived.
 *
 * Planned coverage
 *   lumpsum      = Σ lumpsumPayments.amount            (status not Failed/Refunded)
 *   loan         = Σ loans.loanAmount                  (status not Cancelled)
 *   subscription = Σ installmentAmount × numberOfInstallments
 *   credits      = Σ credits.amount                    (must equal finalFee − coverage)
 *
 * Received on the order (paymentSummary.actualReceivedRevenue, order status,
 * outstanding amount)
 *   lumpsum      = Σ lumpsumPayments.amountReceived    (status not Failed/Refunded)
 *   loan         = Σ loans.loanAmount                  (status not Cancelled)
 *   subscription = Σ subscriptions.paymentHistory.amount (status SUCCESS)
 *   credits      = Σ credits.amount                    (status Paid)
 *
 * Revenue in reports (calculateActualRevenue and the aggregation expressions)
 *   same as above, except loan = Σ loans.disbursementAmount (status not Cancelled)
 *
 * Orders that have not been migrated (paymentSchemaVersion < 2) fall back to
 * the legacy rule used by the reports before this change:
 *   Loan → loanDetails.disbursementAmount, Lumpsum → lumpsumDetails.totalReceived,
 *   Subscription → 0.
 * ============================================================================
 */
import { Types } from 'mongoose';
import {
  CoverageStatus,
  CreditStatus,
  CURRENT_PAYMENT_SCHEMA_VERSION,
  LoanDisbursementStatus,
  LumpsumPaymentStatus,
  OrderStatus,
  PaymentMode,
  PaymentSource,
} from 'src/schema/order_Management/order.schema';

/* =========================================================================
   NUMBERS / DATES
   ========================================================================= */

export const MONEY_EPSILON = 0.01;

export function toMoney(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function moneyEquals(a: any, b: any): boolean {
  return Math.abs(toMoney(a) - toMoney(b)) < MONEY_EPSILON;
}

function sumBy<T>(items: T[] | undefined | null, fn: (item: T) => any): number {
  return toMoney(
    (items || []).reduce((total, item) => total + toMoney(fn(item)), 0),
  );
}

export function toDateOrUndefined(value: any): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Business timezone used for "due today / overdue" decisions. */
export function getBusinessTimezone(): string {
  return (
    process.env.PENDING_CREDIT_TIMEZONE ||
    process.env.BUSINESS_TIMEZONE ||
    'Asia/Kolkata'
  );
}

/** Timezone of this server – used by reports whose date ranges are built with local Date(). */
export function getServerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** YYYY-MM-DD of `date` in `timeZone`. */
export function toDateKey(
  date: Date,
  timeZone = getBusinessTimezone(),
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which `dateKey` (YYYY-MM-DD) starts in `timeZone`. */
export function startOfDayInTimezone(
  dateKey: string,
  timeZone = getBusinessTimezone(),
): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d);
  const offset = timezoneOffsetMs(new Date(utcGuess), timeZone);
  let result = utcGuess - offset;
  const corrected = timezoneOffsetMs(new Date(result), timeZone);
  if (corrected !== offset) result = utcGuess - corrected;
  return new Date(result);
}

/** Whole days between two YYYY-MM-DD keys (b − a). */
export function diffDateKeys(a: string, b: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

function idString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Types.ObjectId) return value.toString();
  if (value._id) return idString(value._id);
  return String(value);
}

function toObjectIdOrUndefined(value: any): Types.ObjectId | undefined {
  const id = idString(value);
  if (!id || !Types.ObjectId.isValid(id)) return undefined;
  return new Types.ObjectId(id);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/* =========================================================================
   STATUS CONSTANTS
   ========================================================================= */

export const LUMPSUM_EXCLUDED_STATUSES: string[] = [
  LumpsumPaymentStatus.FAILED,
  LumpsumPaymentStatus.REFUNDED,
];

export const SUBSCRIPTION_SUCCESS_STATUS = 'SUCCESS';

export const UNPAID_CREDIT_STATUSES: string[] = [
  CreditStatus.PENDING,
  CreditStatus.OVERDUE,
];

export function isV2Order(order: any): boolean {
  return (
    Number(order?.paymentSchemaVersion || 1) >= CURRENT_PAYMENT_SCHEMA_VERSION
  );
}

const isLumpsumActive = (entry: any) =>
  !LUMPSUM_EXCLUDED_STATUSES.includes(entry?.status);

const isLoanActive = (entry: any) =>
  entry?.disbursementStatus !== LoanDisbursementStatus.CANCELLED;

/* =========================================================================
   CALCULATIONS (JS) – mirror the aggregation expressions below exactly
   ========================================================================= */

export interface PlannedCoverage {
  plannedLumpsumAmount: number;
  plannedLoanAmount: number;
  plannedSubscriptionAmount: number;
  plannedPaymentCoverage: number;
  remainingAmount: number;
  totalCredits: number;
  unallocatedAmount: number;
}

export function calculatePlannedCoverage(order: any): PlannedCoverage {
  const finalFee = toMoney(order?.finalFee);
  const plannedLumpsumAmount = sumBy(
    (order?.lumpsumPayments || []).filter(isLumpsumActive),
    (e: any) => e.amount,
  );
  const plannedLoanAmount = sumBy(
    (order?.loans || []).filter(isLoanActive),
    (e: any) => e.loanAmount,
  );
  const plannedSubscriptionAmount = sumBy(
    order?.subscriptions || [],
    (e: any) =>
      toMoney(e.installmentAmount) * (Number(e.numberOfInstallments) || 0),
  );
  const plannedPaymentCoverage = toMoney(
    plannedLumpsumAmount + plannedLoanAmount + plannedSubscriptionAmount,
  );
  const remainingAmount = toMoney(finalFee - plannedPaymentCoverage);
  const totalCredits = sumBy(order?.credits || [], (c: any) => c.amount);

  return {
    plannedLumpsumAmount,
    plannedLoanAmount,
    plannedSubscriptionAmount,
    plannedPaymentCoverage,
    remainingAmount,
    totalCredits,
    unallocatedAmount: toMoney(remainingAmount - totalCredits),
  };
}

export interface RevenueBreakdown {
  lumpsum: number;
  loan: number;
  subscription: number;
  credit: number;
  total: number;
}

export function sumSuccessfulSubscriptionPayments(entry: any): number {
  return sumBy(
    (entry?.paymentHistory || []).filter(
      (p: any) => p?.status === SUBSCRIPTION_SUCCESS_STATUS,
    ),
    (p: any) => p.amount,
  );
}

/**
 * Revenue of a single order as counted by the reports: a loan counts with its
 * disbursed amount.
 */
export function calculateActualRevenue(order: any): RevenueBreakdown {
  return calculateOrderMoney(order, 'revenue');
}

/**
 * Money received on a single order, as shown on the order: a loan counts with
 * its full loan amount as soon as it is added.
 */
export function calculateReceivedAmounts(order: any): RevenueBreakdown {
  return calculateOrderMoney(order, 'received');
}

function calculateOrderMoney(
  order: any,
  basis: 'revenue' | 'received',
): RevenueBreakdown {
  if (!order) {
    return { lumpsum: 0, loan: 0, subscription: 0, credit: 0, total: 0 };
  }

  if (!isV2Order(order)) {
    const lumpsum =
      order.paymentMode === PaymentMode.LUMPSUM
        ? toMoney(order.lumpsumDetails?.totalReceived)
        : 0;
    const loan =
      order.paymentMode === PaymentMode.LOAN
        ? toMoney(
            basis === 'received'
              ? order.loanDetails?.loanAmount
              : order.loanDetails?.disbursementAmount,
          )
        : 0;
    return {
      lumpsum,
      loan,
      subscription: 0,
      credit: 0,
      total: toMoney(lumpsum + loan),
    };
  }

  const lumpsum = sumBy(
    (order.lumpsumPayments || []).filter(isLumpsumActive),
    (e: any) => e.amountReceived,
  );
  const loan = sumBy((order.loans || []).filter(isLoanActive), (e: any) =>
    basis === 'received' ? e.loanAmount : e.disbursementAmount,
  );
  const subscription = sumBy(order.subscriptions || [], (e: any) =>
    sumSuccessfulSubscriptionPayments(e),
  );
  const credit = sumBy(
    (order.credits || []).filter((c: any) => c?.status === CreditStatus.PAID),
    (c: any) => c.amount,
  );

  return {
    lumpsum,
    loan,
    subscription,
    credit,
    total: toMoney(lumpsum + loan + subscription + credit),
  };
}

/** Planned-but-not-yet-received amount (legacy: lumpsum pendingAmount). */
export function calculateUnrealisedRevenue(order: any): number {
  if (!order) return 0;
  if (!isV2Order(order)) {
    return order.paymentMode === PaymentMode.LUMPSUM
      ? toMoney(order.lumpsumDetails?.pendingAmount)
      : 0;
  }
  const coverage = calculatePlannedCoverage(order);
  const actual = calculateActualRevenue(order);
  return Math.max(
    0,
    toMoney(
      coverage.plannedPaymentCoverage + coverage.totalCredits - actual.total,
    ),
  );
}

export function buildPaymentSummary(order: any, now = new Date()) {
  const finalFee = toMoney(order?.finalFee);
  const coverage = calculatePlannedCoverage(order);
  const received = calculateReceivedAmounts(order);
  const revenue = calculateActualRevenue(order);
  const unpaidCredits = (order?.credits || []).filter((c: any) =>
    UNPAID_CREDIT_STATUSES.includes(c?.status),
  );

  let coverageStatus = CoverageStatus.BALANCED;
  if (coverage.unallocatedAmount > MONEY_EPSILON) {
    coverageStatus = CoverageStatus.UNDER_COVERED;
  } else if (coverage.unallocatedAmount < -MONEY_EPSILON) {
    coverageStatus = CoverageStatus.OVER_COVERED;
  }

  return {
    ...coverage,
    lumpsumReceived: received.lumpsum,
    loanReceived: received.loan,
    loanDisbursed: revenue.loan,
    subscriptionReceived: received.subscription,
    creditsReceived: received.credit,
    /** Received on the order (loans count with their loan amount). */
    actualReceivedRevenue: received.total,
    /** Revenue counted by the reports (loans count with their disbursement). */
    reportedRevenue: revenue.total,
    outstandingAmount: Math.max(0, toMoney(finalFee - received.total)),
    pendingCreditAmount: sumBy(unpaidCredits, (c: any) => c.amount),
    pendingCreditCount: unpaidCredits.length,
    coverageStatus,
    calculatedAt: now,
  };
}

/* =========================================================================
   VALIDATION
   ========================================================================= */

export interface ValidationOptions {
  /** Require planned coverage + credits === finalFee (default true). */
  requireBalanced?: boolean;
}

export function validateOrderFinancials(
  order: any,
  options: ValidationOptions = {},
): string[] {
  const requireBalanced = options.requireBalanced !== false;
  const errors: string[] = [];
  const finalFee = toMoney(order?.finalFee);

  if (!(finalFee > 0)) {
    errors.push('finalFee must be greater than 0');
  }

  (order?.lumpsumPayments || []).forEach((entry: any, index: number) => {
    const label = `lumpsumPayments[${index}]`;
    if (!(toMoney(entry.amount) > 0)) {
      errors.push(`${label}.amount must be greater than 0`);
    }
    if (toMoney(entry.amountReceived) < 0) {
      errors.push(`${label}.amountReceived cannot be negative`);
    }
    if (toMoney(entry.amountReceived) - toMoney(entry.amount) > MONEY_EPSILON) {
      errors.push(
        `${label}.amountReceived (${toMoney(entry.amountReceived)}) cannot exceed amount (${toMoney(entry.amount)})`,
      );
    }
    if (
      toMoney(entry.registrationAmount) - toMoney(entry.amountReceived) >
      MONEY_EPSILON
    ) {
      errors.push(
        `${label}.amountReceived (${toMoney(entry.amountReceived)}) cannot be less than the registrationAmount (${toMoney(entry.registrationAmount)})`,
      );
    }
    if (
      entry.status === LumpsumPaymentStatus.FAILED &&
      toMoney(entry.amountReceived) > 0
    ) {
      errors.push(`${label} cannot be Failed when an amount has been received`);
    }
  });

  (order?.loans || []).forEach((entry: any, index: number) => {
    const label = `loans[${index}]`;
    if (!(toMoney(entry.loanAmount) > 0)) {
      errors.push(`${label}.loanAmount must be greater than 0`);
    }
    if (!entry.loanPartner) {
      errors.push(`${label}.loanPartner is required`);
    }
    if (toMoney(entry.disbursementAmount) < 0) {
      errors.push(`${label}.disbursementAmount cannot be negative`);
    }
    if (
      toMoney(entry.disbursementAmount) - toMoney(entry.loanAmount) >
      MONEY_EPSILON
    ) {
      errors.push(
        `${label}.disbursementAmount (${toMoney(entry.disbursementAmount)}) cannot exceed loanAmount (${toMoney(entry.loanAmount)})`,
      );
    }
    if (
      entry.disbursementStatus === LoanDisbursementStatus.CANCELLED &&
      toMoney(entry.disbursementAmount) > 0
    ) {
      errors.push(`${label} cannot be Cancelled after a disbursement`);
    }
  });

  (order?.subscriptions || []).forEach((entry: any, index: number) => {
    const label = `subscriptions[${index}]`;
    if (!(toMoney(entry.installmentAmount) > 0)) {
      errors.push(`${label}.installmentAmount must be greater than 0`);
    }
    const count = Number(entry.numberOfInstallments);
    if (!Number.isInteger(count) || count < 1) {
      errors.push(`${label}.numberOfInstallments must be a whole number >= 1`);
    }
    if (!toDateOrUndefined(entry.firstInstallmentDate)) {
      errors.push(`${label}.firstInstallmentDate is required`);
    }
    const planned = toMoney(entry.installmentAmount) * (count || 0);
    const received = sumSuccessfulSubscriptionPayments(entry);
    if (planned > 0 && received - planned > MONEY_EPSILON) {
      errors.push(
        `${label} received payments (${received}) exceed the planned subscription amount (${planned})`,
      );
    }
  });

  (order?.credits || []).forEach((credit: any, index: number) => {
    const label = `credits[${index}]`;
    if (!(toMoney(credit.amount) > 0)) {
      errors.push(`${label}.amount must be greater than 0`);
    }
    if (!toDateOrUndefined(credit.dueDate)) {
      errors.push(`${label}.dueDate is required`);
    }
    if (credit.status === CreditStatus.PAID && !credit.paymentReferenceId) {
      errors.push(`${label} is Paid but has no payment reference`);
    }
  });

  const coverage = calculatePlannedCoverage(order);

  if (coverage.remainingAmount < -MONEY_EPSILON) {
    errors.push(
      `Planned payment coverage (${coverage.plannedPaymentCoverage}) exceeds finalFee (${finalFee}) by ${toMoney(-coverage.remainingAmount)}. Overpayment is not supported.`,
    );
  } else if (requireBalanced) {
    const expectedCredits = Math.max(0, coverage.remainingAmount);
    if (!moneyEquals(coverage.totalCredits, expectedCredits)) {
      if (expectedCredits === 0) {
        errors.push(
          `Payment sources already cover finalFee; credits total (${coverage.totalCredits}) must be 0`,
        );
      } else {
        errors.push(
          `Credits total (${coverage.totalCredits}) must equal the remaining amount (${expectedCredits}) = finalFee (${finalFee}) - planned payment coverage (${coverage.plannedPaymentCoverage})`,
        );
      }
    }
  }

  return errors;
}

/* =========================================================================
   DERIVED FIELDS
   ========================================================================= */

export function deriveLumpsumStatus(entry: any): LumpsumPaymentStatus {
  if (entry?.status === LumpsumPaymentStatus.REFUNDED) {
    return LumpsumPaymentStatus.REFUNDED;
  }
  const received = toMoney(entry?.amountReceived);
  if (entry?.status === LumpsumPaymentStatus.FAILED && received === 0) {
    return LumpsumPaymentStatus.FAILED;
  }
  if (received <= 0) return LumpsumPaymentStatus.PENDING;
  if (toMoney(entry?.amount) - received > MONEY_EPSILON) {
    return LumpsumPaymentStatus.PARTIALLY_RECEIVED;
  }
  return LumpsumPaymentStatus.RECEIVED;
}

/**
 * Loan status is not entered by users: it follows from the disbursed amount.
 * Only an explicit Cancelled is kept (validation rejects it after a disbursement).
 */
export function deriveLoanStatus(entry: any): LoanDisbursementStatus {
  const disbursed = toMoney(entry?.disbursementAmount);
  if (entry?.disbursementStatus === LoanDisbursementStatus.CANCELLED) {
    return LoanDisbursementStatus.CANCELLED;
  }
  if (disbursed <= 0) return LoanDisbursementStatus.PENDING;
  return toMoney(entry?.loanAmount) - disbursed > MONEY_EPSILON
    ? LoanDisbursementStatus.PARTIALLY_DISBURSED
    : LoanDisbursementStatus.DISBURSED;
}

export function deriveCreditStatus(
  credit: any,
  todayKey: string,
  timeZone = getBusinessTimezone(),
): CreditStatus {
  if (credit?.status === CreditStatus.PAID) return CreditStatus.PAID;
  const due = toDateOrUndefined(credit?.dueDate);
  if (due && toDateKey(due, timeZone) < todayKey) return CreditStatus.OVERDUE;
  return CreditStatus.PENDING;
}

export function derivePaymentModes(order: any): string[] {
  const modes: string[] = [];
  if ((order?.lumpsumPayments || []).some(isLumpsumActive))
    modes.push(PaymentMode.LUMPSUM);
  if ((order?.loans || []).some(isLoanActive)) modes.push(PaymentMode.LOAN);
  if ((order?.subscriptions || []).length) modes.push(PaymentMode.SUBSCRIPTION);
  if ((order?.credits || []).length) modes.push(PaymentMode.CREDIT);
  return modes;
}

export function derivePrimaryPaymentMode(
  modes: string[],
  fallback?: PaymentMode,
): PaymentMode | undefined {
  const sources = modes.filter((m) => m !== String(PaymentMode.CREDIT));
  if (sources.length === 1) return sources[0] as PaymentMode;
  if (sources.length > 1) return PaymentMode.MIXED;
  if (modes.includes(PaymentMode.CREDIT)) return PaymentMode.CREDIT;
  return fallback;
}

export function deriveOrderStatus(order: any, summary: any): OrderStatus {
  if (order?.status === OrderStatus.CANCELLED) return OrderStatus.CANCELLED;
  const finalFee = toMoney(order?.finalFee);
  const received = toMoney(summary?.actualReceivedRevenue);
  if (finalFee > 0 && received >= finalFee - MONEY_EPSILON) {
    return OrderStatus.FULLY_PAID;
  }
  if (received > 0) return OrderStatus.PARTIALLY_PAID;
  if (
    (order?.loans || []).some(
      (l: any) => l?.disbursementStatus === LoanDisbursementStatus.PENDING,
    )
  ) {
    return OrderStatus.LOAN_PROCESSING;
  }
  return OrderStatus.PENDING_PAYMENT;
}

/**
 * Keeps the legacy single-object fields in sync with the v2 arrays so that
 * consumers which still read lumpsumDetails / loanDetails / subscriptionDetails
 * keep working. lumpsumDetails.totalReceived = total lumpsum received.
 */
export function buildLegacyMirror(order: any, summary: any) {
  const lumpsum = (order?.lumpsumPayments || []).filter(isLumpsumActive);
  const loans = (order?.loans || []).filter(isLoanActive);
  const subs = order?.subscriptions || [];

  const lumpsumDetails = lumpsum.length
    ? {
        ...(order?.lumpsumDetails || {}),
        registrationDate:
          order?.lumpsumDetails?.registrationDate ||
          lumpsum[0].paymentDate ||
          undefined,
        registrationAmount: sumBy(lumpsum, (e: any) => e.registrationAmount),
        totalReceived: summary.lumpsumReceived,
        pendingAmount: Math.max(
          0,
          toMoney(summary.plannedLumpsumAmount - summary.lumpsumReceived),
        ),
        paymentType:
          lumpsum[0].paymentMode || order?.lumpsumDetails?.paymentType,
      }
    : undefined;

  const loanDetails = loans.length
    ? {
        loanPartner: loans[0].loanPartner,
        loanId: loans[0].loanId,
        loanAmount: sumBy(loans, (l: any) => l.loanAmount),
        disbursementAmount: sumBy(loans, (l: any) => l.disbursementAmount),
        firstEmiDate: loans[0].firstEmiDate,
        loanDate: loans[0].loanDate,
      }
    : undefined;

  const subscriptionDetails = subs.length
    ? {
        cashfreeSubscriptionId: subs[0].cashfreeSubscriptionId,
        gateway: subs[0].gateway,
        installmentAmount: subs[0].installmentAmount,
        firstInstallmentDate: subs[0].firstInstallmentDate,
        lastInstallmentDate: subs[0].lastInstallmentDate,
        numberOfInstallments: subs[0].numberOfInstallments,
        status: subs[0].status,
        lastPaymentAt: subs[0].lastPaymentAt,
      }
    : undefined;

  return { lumpsumDetails, loanDetails, subscriptionDetails };
}

/**
 * Recalculate every derived field of a v2 order in place:
 * entry statuses, receipts totals, subscription totals, credit overdue
 * status, summary, payment modes, order status and the legacy mirror.
 */
export function recalculateOrderFinancials(order: any, now = new Date()) {
  const timeZone = getBusinessTimezone();
  const todayKey = toDateKey(now, timeZone);

  for (const entry of order.lumpsumPayments || []) {
    entry.receipts = entry.receipts || [];
    entry.amountReceived = sumBy(entry.receipts, (r: any) => r.amount);
    entry.registrationAmount = toMoney(entry.registrationAmount);
    entry.status = deriveLumpsumStatus(entry);
  }

  for (const entry of order.loans || []) {
    entry.disbursementAmount = toMoney(entry.disbursementAmount);
    entry.disbursementStatus = deriveLoanStatus(entry);
  }

  for (const entry of order.subscriptions || []) {
    entry.paymentHistory = entry.paymentHistory || [];
    entry.totalReceived = sumSuccessfulSubscriptionPayments(entry);
    const paidDates = entry.paymentHistory
      .filter((p: any) => p.status === SUBSCRIPTION_SUCCESS_STATUS)
      .map((p: any) => toDateOrUndefined(p.paidAt))
      .filter(Boolean) as Date[];
    entry.lastPaymentAt = paidDates.length
      ? new Date(Math.max(...paidDates.map((d) => d.getTime())))
      : entry.lastPaymentAt;
    const first = toDateOrUndefined(entry.firstInstallmentDate);
    const count = Number(entry.numberOfInstallments) || 0;
    if (first && count > 0 && !toDateOrUndefined(entry.lastInstallmentDate)) {
      entry.lastInstallmentDate = addMonths(first, count - 1);
    }
  }

  for (const credit of order.credits || []) {
    credit.status = deriveCreditStatus(credit, todayKey, timeZone);
  }

  order.paymentSchemaVersion = CURRENT_PAYMENT_SCHEMA_VERSION;
  const summary = buildPaymentSummary(order, now);
  order.paymentSummary = summary;
  order.paymentModes = derivePaymentModes(order);
  order.paymentMode = derivePrimaryPaymentMode(
    order.paymentModes,
    order.paymentMode,
  );
  order.status = deriveOrderStatus(order, summary);

  const mirror = buildLegacyMirror(order, summary);
  order.lumpsumDetails = mirror.lumpsumDetails;
  order.loanDetails = mirror.loanDetails;
  order.subscriptionDetails = mirror.subscriptionDetails;

  return order;
}

/* =========================================================================
   NORMALISATION OF INPUT ENTRIES (create / add)
   ========================================================================= */

export interface FinancialContext {
  actorId?: string;
  now?: Date;
  source?: PaymentSource;
}

function cleanString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

export function normalizeLumpsumInput(input: any, ctx: FinancialContext = {}) {
  const now = ctx.now || new Date();
  // amountReceived defaults to the registration amount and may be higher
  // (registration + later payments). The entry is planned for what is received.
  const hasRegistration =
    input?.registrationAmount !== undefined &&
    input?.registrationAmount !== null;
  const registrationAmount = toMoney(input?.registrationAmount);
  const hasReceived =
    input?.amountReceived !== undefined && input?.amountReceived !== null;
  const amountReceived = hasReceived
    ? toMoney(input?.amountReceived)
    : registrationAmount;
  const paymentDate = toDateOrUndefined(input?.paymentDate);
  const transactionId = cleanString(input?.transactionId);
  const receipts =
    Array.isArray(input?.receipts) && input.receipts.length
      ? input.receipts.map((r: any) => ({ ...r, amount: toMoney(r.amount) }))
      : amountReceived > 0
        ? [
            {
              amount: amountReceived,
              receivedAt: paymentDate || now,
              referenceId: transactionId,
              source: ctx.source || PaymentSource.MANUAL,
              recordedBy: toObjectIdOrUndefined(ctx.actorId),
            },
          ]
        : [];

  return {
    _id: toObjectIdOrUndefined(input?._id) || new Types.ObjectId(),
    amount: hasRegistration
      ? sumBy(receipts, (r: any) => r.amount)
      : toMoney(input?.amount),
    amountReceived: sumBy(receipts, (r: any) => r.amount),
    registrationAmount,
    paymentDate,
    transactionId,
    status:
      input?.status === LumpsumPaymentStatus.FAILED ||
      input?.status === LumpsumPaymentStatus.REFUNDED
        ? input.status
        : undefined,
    paymentMode: cleanString(input?.paymentMode),
    remarks: cleanString(input?.remarks),
    origin: cleanString(input?.origin),
    receipts,
    createdBy: toObjectIdOrUndefined(ctx.actorId),
  };
}

export function normalizeLoanInput(input: any, ctx: FinancialContext = {}) {
  return {
    _id: toObjectIdOrUndefined(input?._id) || new Types.ObjectId(),
    loanPartner: toObjectIdOrUndefined(input?.loanPartner),
    loanId: toObjectIdOrUndefined(input?.loanId),
    partnerLoanReference: cleanString(input?.partnerLoanReference),
    loanAmount: toMoney(input?.loanAmount),
    disbursementAmount: toMoney(input?.disbursementAmount),
    loanDate: toDateOrUndefined(input?.loanDate),
    firstEmiDate: toDateOrUndefined(input?.firstEmiDate),
    disbursementDate: toDateOrUndefined(input?.disbursementDate),
    // Only Cancelled can be set; every other status follows from the amounts.
    disbursementStatus:
      input?.disbursementStatus === LoanDisbursementStatus.CANCELLED
        ? LoanDisbursementStatus.CANCELLED
        : undefined,
    remarks: cleanString(input?.remarks),
    origin: cleanString(input?.origin),
    createdBy: toObjectIdOrUndefined(ctx.actorId),
  };
}

export function normalizeSubscriptionInput(
  input: any,
  ctx: FinancialContext = {},
) {
  return {
    _id: toObjectIdOrUndefined(input?._id) || new Types.ObjectId(),
    cashfreeSubscriptionId: cleanString(input?.cashfreeSubscriptionId),
    gatewaySubscriptionId: cleanString(input?.gatewaySubscriptionId),
    subscriptionRef: toObjectIdOrUndefined(input?.subscriptionRef),
    gateway: cleanString(input?.gateway) || 'Cashfree',
    installmentAmount: toMoney(input?.installmentAmount),
    numberOfInstallments: Number(input?.numberOfInstallments),
    firstInstallmentDate: toDateOrUndefined(input?.firstInstallmentDate),
    lastInstallmentDate: toDateOrUndefined(input?.lastInstallmentDate),
    status: cleanString(input?.status) || 'PENDING_AUTH',
    paymentHistory: Array.isArray(input?.paymentHistory)
      ? input.paymentHistory
      : [],
    totalReceived: 0,
    lastPaymentAt: toDateOrUndefined(input?.lastPaymentAt),
    remarks: cleanString(input?.remarks),
    origin: cleanString(input?.origin),
    createdBy: toObjectIdOrUndefined(ctx.actorId),
  };
}

export function normalizeCreditInput(input: any, ctx: FinancialContext = {}) {
  const now = ctx.now || new Date();
  return {
    _id: toObjectIdOrUndefined(input?._id) || new Types.ObjectId(),
    amount: toMoney(input?.amount),
    dueDate: toDateOrUndefined(input?.dueDate),
    status: CreditStatus.PENDING,
    remarks: cleanString(input?.remarks),
    createdBy: toObjectIdOrUndefined(ctx.actorId),
    statusHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface FinancialInput {
  lumpsumPayments?: any[];
  loans?: any[];
  subscriptions?: any[];
  credits?: any[];
}

export function hasV2FinancialInput(input: any): boolean {
  return ['lumpsumPayments', 'loans', 'subscriptions', 'credits'].some((key) =>
    Array.isArray(input?.[key]),
  );
}

export function hasLegacyFinancialInput(input: any): boolean {
  return ['lumpsumDetails', 'loanDetails', 'subscriptionDetails'].some(
    (key) => input?.[key] && typeof input[key] === 'object',
  );
}

/* =========================================================================
   LEGACY (v1) → v2 MAPPING – shared by the create API and the migration
   ========================================================================= */

export interface LegacyMappingExtras {
  /** Subscription documents of this order (subscriptions collection). */
  subscriptionDocs?: any[];
  /** Successful SubscriptionPayment records of this order. */
  subscriptionSuccessPayments?: any[];
}

export interface LegacyMappingResult {
  lumpsumPayments: any[];
  loans: any[];
  subscriptions: any[];
  credits: any[];
  warnings: string[];
}

/**
 * Converts the single-object legacy payment fields into v2 entries.
 *
 * mode 'api'       – a create/update request from an old client: only the
 *                    object matching paymentMode is used (old behaviour), and
 *                    a lumpsum order is planned for the full finalFee.
 * mode 'migration' – an existing document: every populated object is mapped,
 *                    entry/_id references are preserved and inconsistencies are
 *                    reported as warnings. Credits are never invented.
 */
export function mapLegacyPaymentDetails(
  order: any,
  mode: 'api' | 'migration',
  extras: LegacyMappingExtras = {},
  ctx: FinancialContext = {},
): LegacyMappingResult {
  const warnings: string[] = [];
  const finalFee = toMoney(order?.finalFee);
  const source =
    mode === 'migration' ? PaymentSource.MIGRATION : PaymentSource.MANUAL;
  const origin = mode === 'migration' ? 'LEGACY_MIGRATION' : undefined;
  const paymentMode = order?.paymentMode;

  const use = (
    key: 'lumpsumDetails' | 'loanDetails' | 'subscriptionDetails',
    modeName: PaymentMode,
  ) => {
    const value = order?.[key];
    if (!value || typeof value !== 'object') return undefined;
    if (mode === 'api') return paymentMode === modeName ? value : undefined;
    if (paymentMode && paymentMode !== modeName) {
      warnings.push(`${key} present on a ${paymentMode} order`);
    }
    return value;
  };

  /* ---------------- LUMPSUM ---------------- */
  const lumpsumPayments: any[] = [];
  const legacyLumpsum = use('lumpsumDetails', PaymentMode.LUMPSUM);
  if (legacyLumpsum) {
    const received = toMoney(legacyLumpsum.totalReceived);
    const pending = toMoney(legacyLumpsum.pendingAmount);
    let planned: number;
    if (mode === 'api') {
      // Old create API: the whole finalFee is payable as lumpsum.
      planned = finalFee;
    } else {
      // finalFee is authoritative (pendingAmount was not recalculated on edits).
      planned = Math.max(finalFee, received);
      if (received - finalFee > MONEY_EPSILON) {
        warnings.push(
          `lumpsum totalReceived (${received}) exceeds finalFee (${finalFee})`,
        );
      }
      if (
        legacyLumpsum.pendingAmount !== undefined &&
        !moneyEquals(received + pending, finalFee)
      ) {
        warnings.push(
          `legacy pendingAmount (${pending}) inconsistent with finalFee (${finalFee}) - totalReceived (${received}); finalFee used`,
        );
      }
    }
    if (planned > 0 || received > 0) {
      const receivedAt =
        toDateOrUndefined(legacyLumpsum.registrationDate) ||
        toDateOrUndefined(order?.feeDepositDate) ||
        toDateOrUndefined(order?.orderDate);
      lumpsumPayments.push({
        _id: toObjectIdOrUndefined(legacyLumpsum._id) || new Types.ObjectId(),
        amount: planned,
        amountReceived: received,
        registrationAmount: Math.min(
          toMoney(legacyLumpsum.registrationAmount),
          received,
        ),
        paymentDate: receivedAt,
        transactionId: cleanString(legacyLumpsum.transactionId),
        paymentMode: cleanString(legacyLumpsum.paymentType),
        remarks:
          legacyLumpsum.registrationAmount > 0
            ? `Includes registration amount ${toMoney(legacyLumpsum.registrationAmount)}`
            : undefined,
        origin,
        receipts:
          received > 0
            ? [
                {
                  amount: received,
                  receivedAt,
                  referenceId: cleanString(legacyLumpsum.transactionId),
                  source,
                  recordedBy: toObjectIdOrUndefined(ctx.actorId),
                  remarks:
                    mode === 'migration'
                      ? 'Aggregated legacy lumpsumDetails.totalReceived'
                      : undefined,
                },
              ]
            : [],
        createdBy: toObjectIdOrUndefined(ctx.actorId),
      });
    }
  }

  /* ---------------- LOAN ---------------- */
  const loans: any[] = [];
  const legacyLoan = use('loanDetails', PaymentMode.LOAN);
  if (legacyLoan) {
    const loanAmount = toMoney(legacyLoan.loanAmount);
    const disbursementAmount = toMoney(legacyLoan.disbursementAmount);
    if (
      mode === 'migration' &&
      disbursementAmount - loanAmount > MONEY_EPSILON
    ) {
      warnings.push(
        `loan disbursementAmount (${disbursementAmount}) exceeds loanAmount (${loanAmount})`,
      );
    }
    if (mode === 'migration' && !(loanAmount > 0)) {
      warnings.push('loan has no loanAmount');
    }
    if (loanAmount > 0 || disbursementAmount > 0 || mode === 'api') {
      loans.push({
        _id: toObjectIdOrUndefined(legacyLoan._id) || new Types.ObjectId(),
        loanPartner: toObjectIdOrUndefined(legacyLoan.loanPartner),
        loanId: toObjectIdOrUndefined(legacyLoan.loanId),
        partnerLoanReference: cleanString(legacyLoan.partnerLoanReference),
        loanAmount,
        disbursementAmount,
        loanDate: toDateOrUndefined(legacyLoan.loanDate),
        firstEmiDate: toDateOrUndefined(legacyLoan.firstEmiDate),
        disbursementStatus:
          disbursementAmount > 0
            ? LoanDisbursementStatus.DISBURSED
            : LoanDisbursementStatus.PENDING,
        origin,
        createdBy: toObjectIdOrUndefined(ctx.actorId),
      });
    }
  }

  /* ---------------- SUBSCRIPTION ---------------- */
  const subscriptions: any[] = [];
  const legacySub = use('subscriptionDetails', PaymentMode.SUBSCRIPTION);
  if (legacySub) {
    const installmentAmount = toMoney(legacySub.installmentAmount);
    const numberOfInstallments = Number(legacySub.numberOfInstallments) || 0;
    if (
      mode === 'migration' &&
      !(installmentAmount > 0 && numberOfInstallments > 0)
    ) {
      warnings.push(
        `subscriptionDetails has no planned amount (installmentAmount=${installmentAmount}, numberOfInstallments=${numberOfInstallments}); not migrated`,
      );
    } else {
      const subDoc = (extras.subscriptionDocs || [])[0];
      if ((extras.subscriptionDocs || []).length > 1) {
        warnings.push(
          `${extras.subscriptionDocs!.length} subscription documents found; payments attached to the single migrated plan`,
        );
      }
      const seen = new Set<string>();
      const paymentHistory = (extras.subscriptionSuccessPayments || [])
        .map((p: any) => {
          const gatewayPaymentId = cleanString(
            p.cfPaymentId || p.paymentId || p.cfTxnId || p._id,
          );
          return {
            gatewayPaymentId,
            amount: toMoney(p.paymentAmount ?? p.installmentAmount),
            status: SUBSCRIPTION_SUCCESS_STATUS,
            paidAt:
              toDateOrUndefined(p.eventTime) || toDateOrUndefined(p.createdAt),
            installmentNo: p.installmentNo,
            source: PaymentSource.MIGRATION,
            idempotencyKey: gatewayPaymentId
              ? `cashfree-subscription:${gatewayPaymentId}`
              : undefined,
            subscriptionPaymentRecordId: toObjectIdOrUndefined(p._id),
          };
        })
        .filter((p: any) => {
          if (!p.gatewayPaymentId || seen.has(p.gatewayPaymentId)) return false;
          seen.add(p.gatewayPaymentId);
          return p.amount > 0;
        });

      subscriptions.push({
        _id: toObjectIdOrUndefined(legacySub._id) || new Types.ObjectId(),
        cashfreeSubscriptionId:
          cleanString(legacySub.cashfreeSubscriptionId) ||
          cleanString(subDoc?.cashfreeSubscriptionId),
        gatewaySubscriptionId: cleanString(subDoc?.subscriptionId),
        subscriptionRef: toObjectIdOrUndefined(subDoc?._id),
        gateway: cleanString(legacySub.gateway) || 'Cashfree',
        installmentAmount,
        numberOfInstallments,
        firstInstallmentDate: toDateOrUndefined(legacySub.firstInstallmentDate),
        lastInstallmentDate: toDateOrUndefined(legacySub.lastInstallmentDate),
        status:
          cleanString(subDoc?.status) ||
          cleanString(legacySub.status) ||
          'PENDING_AUTH',
        paymentHistory,
        totalReceived: 0,
        lastPaymentAt: toDateOrUndefined(legacySub.lastPaymentAt),
        origin,
        createdBy: toObjectIdOrUndefined(ctx.actorId),
      });
    }
  }

  if (
    mode === 'migration' &&
    !lumpsumPayments.length &&
    !loans.length &&
    !subscriptions.length
  ) {
    warnings.push('no legacy payment details could be mapped');
  }

  return { lumpsumPayments, loans, subscriptions, credits: [], warnings };
}

/**
 * Returns a v2 copy of a (possibly legacy) order: arrays mapped from the
 * legacy objects and all derived fields recalculated. Used when a legacy
 * order is touched by a payment or an edit before the migration ran.
 */
export function upgradeLegacyOrder(
  order: any,
  extras: LegacyMappingExtras = {},
  now = new Date(),
) {
  if (isV2Order(order)) return { order, warnings: [] as string[] };
  const mapped = mapLegacyPaymentDetails(order, 'migration', extras);
  order.lumpsumPayments = mapped.lumpsumPayments;
  order.loans = mapped.loans;
  order.subscriptions = mapped.subscriptions;
  order.credits = order.credits || [];
  recalculateOrderFinancials(order, now);
  return { order, warnings: mapped.warnings };
}

/* =========================================================================
   MONGODB AGGREGATION EXPRESSIONS – used by every revenue report
   ========================================================================= */

const toDoubleExpr = (input: any) => ({
  $convert: { input, to: 'double', onError: 0, onNull: 0 },
});

const sumArrayExpr = (arrayExpr: any, valueExpr: any, condExpr?: any) => ({
  $reduce: {
    input: { $cond: [{ $isArray: arrayExpr }, arrayExpr, []] },
    initialValue: 0,
    in: {
      $add: [
        '$$value',
        condExpr
          ? { $cond: [condExpr, toDoubleExpr(valueExpr), 0] }
          : toDoubleExpr(valueExpr),
      ],
    },
  },
});

const field = (prefix: string, path: string) => `$${prefix}${path}`;

export function isV2OrderExpression(prefix = '') {
  return {
    $gte: [
      { $ifNull: [field(prefix, 'paymentSchemaVersion'), 1] },
      CURRENT_PAYMENT_SCHEMA_VERSION,
    ],
  };
}

/**
 * Per-source actual received revenue as aggregation expressions.
 * `prefix` allows use on a nested document (e.g. 'order.').
 */
export function buildRevenueBreakdownExpressions(prefix = '') {
  const v2 = isV2OrderExpression(prefix);

  const lumpsumV2 = sumArrayExpr(
    field(prefix, 'lumpsumPayments'),
    '$$this.amountReceived',
    { $not: [{ $in: ['$$this.status', LUMPSUM_EXCLUDED_STATUSES] }] },
  );
  // Reports count a loan with its disbursed amount.
  const loanV2 = sumArrayExpr(
    field(prefix, 'loans'),
    '$$this.disbursementAmount',
    { $ne: ['$$this.disbursementStatus', LoanDisbursementStatus.CANCELLED] },
  );
  const subscriptionV2 = sumArrayExpr(
    field(prefix, 'subscriptions'),
    sumArrayExpr('$$this.paymentHistory', '$$this.amount', {
      $eq: ['$$this.status', SUBSCRIPTION_SUCCESS_STATUS],
    }),
  );
  const creditV2 = sumArrayExpr(field(prefix, 'credits'), '$$this.amount', {
    $eq: ['$$this.status', CreditStatus.PAID],
  });

  const lumpsumLegacy = {
    $cond: [
      { $eq: [field(prefix, 'paymentMode'), PaymentMode.LUMPSUM] },
      toDoubleExpr(field(prefix, 'lumpsumDetails.totalReceived')),
      0,
    ],
  };
  const loanLegacy = {
    $cond: [
      { $eq: [field(prefix, 'paymentMode'), PaymentMode.LOAN] },
      toDoubleExpr(field(prefix, 'loanDetails.disbursementAmount')),
      0,
    ],
  };

  return {
    lumpsumRevenue: { $cond: [v2, lumpsumV2, lumpsumLegacy] },
    loanRevenue: { $cond: [v2, loanV2, loanLegacy] },
    subscriptionRevenue: { $cond: [v2, subscriptionV2, 0] },
    creditRevenue: { $cond: [v2, creditV2, 0] },
  };
}

/** Report revenue of an order as a single aggregation expression. */
export function buildActualRevenueExpression(prefix = '') {
  const parts = buildRevenueBreakdownExpressions(prefix);
  return {
    $round: [
      {
        $add: [
          parts.lumpsumRevenue,
          parts.loanRevenue,
          parts.subscriptionRevenue,
          parts.creditRevenue,
        ],
      },
      2,
    ],
  };
}

/** Planned-but-not-received amount as an aggregation expression. */
export function buildUnrealisedRevenueExpression(prefix = '') {
  const v2 = isV2OrderExpression(prefix);
  const planned = {
    $add: [
      sumArrayExpr(field(prefix, 'lumpsumPayments'), '$$this.amount', {
        $not: [{ $in: ['$$this.status', LUMPSUM_EXCLUDED_STATUSES] }],
      }),
      sumArrayExpr(field(prefix, 'loans'), '$$this.loanAmount', {
        $ne: ['$$this.disbursementStatus', LoanDisbursementStatus.CANCELLED],
      }),
      sumArrayExpr(field(prefix, 'subscriptions'), {
        $multiply: [
          toDoubleExpr('$$this.installmentAmount'),
          toDoubleExpr('$$this.numberOfInstallments'),
        ],
      }),
      sumArrayExpr(field(prefix, 'credits'), '$$this.amount'),
    ],
  };
  return {
    $cond: [
      v2,
      {
        $round: [
          {
            $max: [
              0,
              { $subtract: [planned, buildActualRevenueExpression(prefix)] },
            ],
          },
          2,
        ],
      },
      {
        $cond: [
          { $eq: [field(prefix, 'paymentMode'), PaymentMode.LUMPSUM] },
          toDoubleExpr(field(prefix, 'lumpsumDetails.pendingAmount')),
          0,
        ],
      },
    ],
  };
}

/** `$addFields` content: calculatedRevenue + per-source breakdown. */
export function buildRevenueAddFields(
  prefix = '',
  fieldName = 'calculatedRevenue',
) {
  return {
    [fieldName]: buildActualRevenueExpression(prefix),
    ...buildRevenueBreakdownExpressions(prefix),
  };
}

/** Query fragment matching orders that have actual received revenue > 0. */
export function hasActualRevenueMatch(prefix = '') {
  return { $expr: { $gt: [buildActualRevenueExpression(prefix), 0] } };
}
