import { Types } from 'mongoose';
import {
  CoverageStatus,
  CreditStatus,
  LoanDisbursementStatus,
  LumpsumPaymentStatus,
  OrderStatus,
  PaymentMode,
} from 'src/schema/order_Management/order.schema';
import {
  buildPaymentSummary,
  calculateActualRevenue,
  calculatePlannedCoverage,
  calculateReceivedAmounts,
  calculateUnrealisedRevenue,
  deriveCreditStatus,
  diffDateKeys,
  mapLegacyPaymentDetails,
  normalizeCreditInput,
  normalizeLoanInput,
  normalizeLumpsumInput,
  normalizeSubscriptionInput,
  recalculateOrderFinancials,
  startOfDayInTimezone,
  toDateKey,
  upgradeLegacyOrder,
  validateOrderFinancials,
} from './order-financial.util';

const partner = new Types.ObjectId().toString();
const NOW = new Date('2026-11-10T06:00:00.000Z'); // 11:30 IST

function buildOrder(input: {
  finalFee?: number;
  lumpsum?: any[];
  loans?: any[];
  subscriptions?: any[];
  credits?: any[];
}) {
  const order: any = {
    finalFee: input.finalFee ?? 100000,
    lumpsumPayments: (input.lumpsum || []).map((e) => normalizeLumpsumInput(e)),
    loans: (input.loans || []).map((e) =>
      normalizeLoanInput({ loanPartner: partner, ...e }),
    ),
    subscriptions: (input.subscriptions || []).map((e) =>
      normalizeSubscriptionInput({
        firstInstallmentDate: '2026-11-01',
        ...e,
      }),
    ),
    credits: (input.credits || []).map((c) => normalizeCreditInput(c)),
  };
  return recalculateOrderFinancials(order, NOW);
}

const success = (id: string, amount: number) => ({
  gatewayPaymentId: id,
  amount,
  status: 'SUCCESS',
  paidAt: NOW,
});

beforeAll(() => {
  process.env.PENDING_CREDIT_TIMEZONE = 'Asia/Kolkata';
});

describe('Order calculation – planned coverage & validation', () => {
  it('1. only lumpsum', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 100000, amountReceived: 20000 }],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
    expect(calculatePlannedCoverage(order).plannedPaymentCoverage).toBe(100000);
    expect(calculateActualRevenue(order).total).toBe(20000);
    expect(order.paymentMode).toBe(PaymentMode.LUMPSUM);
    expect(order.lumpsumPayments[0].status).toBe(
      LumpsumPaymentStatus.PARTIALLY_RECEIVED,
    );
    expect(order.status).toBe(OrderStatus.PARTIALLY_PAID);
  });

  it('2. only loan (loanAmount covers the fee, revenue = disbursement)', () => {
    const order = buildOrder({
      loans: [{ loanAmount: 100000, disbursementAmount: 0 }],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
    expect(order.paymentSummary.plannedLoanAmount).toBe(100000);
    expect(calculateActualRevenue(order).total).toBe(0);
    expect(order.paymentMode).toBe(PaymentMode.LOAN);
  });

  it('3. only subscription', () => {
    const order = buildOrder({
      subscriptions: [{ installmentAmount: 10000, numberOfInstallments: 10 }],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
    expect(order.paymentSummary.plannedSubscriptionAmount).toBe(100000);
    expect(order.subscriptions[0].lastInstallmentDate).toBeInstanceOf(Date);
    expect(order.paymentMode).toBe(PaymentMode.SUBSCRIPTION);
  });

  it('4. lumpsum + loan', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 40000, amountReceived: 40000 }],
      loans: [{ loanAmount: 60000, disbursementAmount: 60000 }],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
    expect(calculateActualRevenue(order)).toMatchObject({
      lumpsum: 40000,
      loan: 60000,
      total: 100000,
    });
    expect(order.paymentMode).toBe(PaymentMode.MIXED);
    expect(order.paymentModes).toEqual([PaymentMode.LUMPSUM, PaymentMode.LOAN]);
    expect(order.status).toBe(OrderStatus.FULLY_PAID);
  });

  it('5. lumpsum + subscription', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 40000 }],
      subscriptions: [{ installmentAmount: 10000, numberOfInstallments: 6 }],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
  });

  it('6. loan + subscription', () => {
    const order = buildOrder({
      loans: [{ loanAmount: 70000 }],
      subscriptions: [{ installmentAmount: 5000, numberOfInstallments: 6 }],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
  });

  it('7. all three sources (remaining 20,000 requires credits)', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 20000, amountReceived: 20000 }],
      loans: [{ loanAmount: 30000 }],
      subscriptions: [{ installmentAmount: 5000, numberOfInstallments: 6 }],
    });
    const coverage = calculatePlannedCoverage(order);
    expect(coverage.plannedPaymentCoverage).toBe(80000);
    expect(coverage.remainingAmount).toBe(20000);
    expect(validateOrderFinancials(order).join()).toContain(
      'Credits total (0) must equal the remaining amount (20000)',
    );
    expect(order.paymentSummary.coverageStatus).toBe(
      CoverageStatus.UNDER_COVERED,
    );
  });

  it('8. all three sources plus multiple credits (requirement example)', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 20000, amountReceived: 20000 }],
      loans: [{ loanAmount: 30000 }],
      subscriptions: [{ installmentAmount: 5000, numberOfInstallments: 6 }],
      credits: [
        { amount: 10000, dueDate: '2026-11-10' },
        { amount: 5000, dueDate: '2026-11-20' },
        { amount: 5000, dueDate: '2026-11-30' },
      ],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
    expect(order.paymentSummary).toMatchObject({
      plannedPaymentCoverage: 80000,
      totalCredits: 20000,
      unallocatedAmount: 0,
      coverageStatus: CoverageStatus.BALANCED,
      pendingCreditAmount: 20000,
      pendingCreditCount: 3,
    });
    expect(order.paymentModes).toContain(PaymentMode.CREDIT);
    expect(order.paymentMode).toBe(PaymentMode.MIXED);
  });

  it('9. credit total less than remaining amount is rejected', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 80000 }],
      credits: [{ amount: 15000, dueDate: '2026-11-20' }],
    });
    expect(validateOrderFinancials(order).join()).toContain(
      'Credits total (15000) must equal the remaining amount (20000)',
    );
  });

  it('10. credit total greater than remaining amount is rejected', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 80000 }],
      credits: [{ amount: 25000, dueDate: '2026-11-20' }],
    });
    expect(validateOrderFinancials(order).join()).toContain(
      'Credits total (25000) must equal the remaining amount (20000)',
    );
  });

  it('11. payment coverage greater than finalFee is rejected (no overpayment workflow)', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 60000 }],
      loans: [{ loanAmount: 50000 }],
    });
    expect(validateOrderFinancials(order).join()).toContain(
      'exceeds finalFee (100000) by 10000',
    );
    expect(order.paymentSummary.coverageStatus).toBe(
      CoverageStatus.OVER_COVERED,
    );
  });

  it('12. partial subscription payments: planned 30,000, received 10,000', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 70000 }],
      subscriptions: [
        {
          installmentAmount: 5000,
          numberOfInstallments: 6,
          paymentHistory: [success('p1', 5000), success('p2', 5000)],
        },
      ],
    });
    expect(validateOrderFinancials(order)).toEqual([]);
    expect(order.paymentSummary.plannedSubscriptionAmount).toBe(30000);
    expect(calculateActualRevenue(order).subscription).toBe(10000);
    expect(order.subscriptions[0].totalReceived).toBe(10000);
    expect(calculateUnrealisedRevenue(order)).toBe(90000);
  });

  it('13. multiple successful installments; failed ones are not revenue', () => {
    const order = buildOrder({
      subscriptions: [
        {
          installmentAmount: 10000,
          numberOfInstallments: 10,
          paymentHistory: [
            success('p1', 10000),
            success('p2', 10000),
            { ...success('p3', 10000), status: 'FAILED' },
            success('p4', 10000),
          ],
        },
      ],
    });
    expect(calculateActualRevenue(order).subscription).toBe(30000);
  });

  it('14. undisbursed loan: no report revenue, but the loan amount counts as received', () => {
    const order = buildOrder({ loans: [{ loanAmount: 100000 }] });
    expect(order.loans[0].disbursementStatus).toBe(
      LoanDisbursementStatus.PENDING,
    );
    expect(calculateActualRevenue(order).loan).toBe(0);
    expect(calculateReceivedAmounts(order).loan).toBe(100000);
    expect(order.paymentSummary.loanReceived).toBe(100000);
    expect(order.paymentSummary.loanDisbursed).toBe(0);
    expect(order.paymentSummary.reportedRevenue).toBe(0);
    expect(order.status).toBe(OrderStatus.FULLY_PAID);
  });

  it('15. partially disbursed loan: revenue = disbursement, coverage = loanAmount', () => {
    const order = buildOrder({
      loans: [{ loanAmount: 100000, disbursementAmount: 30000 }],
    });
    expect(order.loans[0].disbursementStatus).toBe(
      LoanDisbursementStatus.PARTIALLY_DISBURSED,
    );
    expect(order.paymentSummary.plannedLoanAmount).toBe(100000);
    expect(calculateActualRevenue(order).loan).toBe(30000);
    expect(validateOrderFinancials(order)).toEqual([]);
  });

  it('derives loan status from the amounts and ignores a status sent by the client', () => {
    const order = buildOrder({
      loans: [
        {
          loanAmount: 100000,
          disbursementAmount: 92000,
          disbursementStatus: LoanDisbursementStatus.DISBURSED,
        },
      ],
    });
    expect(order.loans[0].disbursementStatus).toBe(
      LoanDisbursementStatus.PARTIALLY_DISBURSED,
    );
    expect(calculateActualRevenue(order).loan).toBe(92000);
    expect(calculateReceivedAmounts(order).loan).toBe(100000);
  });

  it('received amount defaults to the registration amount and can be higher', () => {
    const order = buildOrder({
      lumpsum: [
        { registrationAmount: 2000, paymentMode: 'UPI' },
        { registrationAmount: 2000, amountReceived: 10000, paymentMode: 'UPI' },
      ],
      credits: [{ amount: 88000, dueDate: '2026-12-01' }],
    });
    expect(order.lumpsumPayments[0]).toMatchObject({
      amount: 2000,
      amountReceived: 2000,
      registrationAmount: 2000,
      status: 'Received',
    });
    expect(order.lumpsumPayments[1]).toMatchObject({
      amount: 10000,
      amountReceived: 10000,
      registrationAmount: 2000,
    });
    expect(order.paymentSummary.lumpsumReceived).toBe(12000);
    expect(validateOrderFinancials(order)).toEqual([]);
  });

  it('rejects inconsistent entries', () => {
    const order = buildOrder({
      lumpsum: [{ amount: 1000, amountReceived: 2000 }],
      loans: [{ loanAmount: 1000, disbursementAmount: 5000 }],
      subscriptions: [{ installmentAmount: 0, numberOfInstallments: 0 }],
      credits: [{ amount: 0 }],
    });
    const errors = validateOrderFinancials(order).join('\n');
    expect(errors).toContain(
      'lumpsumPayments[0].amountReceived (2000) cannot exceed amount (1000)',
    );
    expect(errors).toContain(
      'loans[0].disbursementAmount (5000) cannot exceed loanAmount (1000)',
    );
    expect(errors).toContain(
      'subscriptions[0].installmentAmount must be greater than 0',
    );
    expect(errors).toContain('credits[0].dueDate is required');
  });

  it('does not silently modify amounts (input values are kept as sent)', () => {
    const order = buildOrder({ lumpsum: [{ amount: 99999.99 }] });
    expect(order.lumpsumPayments[0].amount).toBe(99999.99);
    expect(validateOrderFinancials(order)).toHaveLength(1);
  });
});

describe('Actual received revenue', () => {
  const base = () =>
    buildOrder({
      lumpsum: [
        { amount: 20000, amountReceived: 20000 },
        { amount: 10000, amountReceived: 0 },
      ],
      loans: [
        {
          loanAmount: 30000,
          disbursementAmount: 25000,
          disbursementStatus: 'Disbursed',
        },
      ],
      subscriptions: [
        {
          installmentAmount: 5000,
          numberOfInstallments: 2,
          paymentHistory: [success('s1', 5000)],
        },
      ],
      credits: [
        { amount: 20000, dueDate: '2026-11-01' },
        { amount: 10000, dueDate: '2026-12-01' },
      ],
    });

  it('counts received lumpsum, disbursed loan, successful subscription payments and paid credits only', () => {
    const order = base();
    expect(validateOrderFinancials(order)).toEqual([]);
    order.credits[0].status = CreditStatus.PAID;
    order.credits[0].paymentReferenceId = 'UTR-1';
    expect(calculateActualRevenue(order)).toEqual({
      lumpsum: 20000,
      loan: 25000,
      subscription: 5000,
      credit: 20000,
      total: 70000,
    });
  });

  it('excludes pending and overdue credits', () => {
    const order = base();
    expect(order.credits.map((c: any) => c.status)).toEqual([
      CreditStatus.OVERDUE,
      CreditStatus.PENDING,
    ]);
    expect(calculateActualRevenue(order).credit).toBe(0);
  });

  it('excludes refunded lumpsum payments', () => {
    const order = base();
    order.lumpsumPayments[0].status = LumpsumPaymentStatus.REFUNDED;
    recalculateOrderFinancials(order, NOW);
    expect(calculateActualRevenue(order).lumpsum).toBe(0);
  });

  it('legacy (unmigrated) orders keep the previous rule', () => {
    expect(
      calculateActualRevenue({
        paymentMode: PaymentMode.LUMPSUM,
        lumpsumDetails: { totalReceived: 1234 },
      }).total,
    ).toBe(1234);
    expect(
      calculateActualRevenue({
        paymentMode: PaymentMode.LOAN,
        loanDetails: { disbursementAmount: 500, loanAmount: 900 },
      }).total,
    ).toBe(500);
    expect(
      calculateActualRevenue({
        paymentMode: PaymentMode.SUBSCRIPTION,
        subscriptionDetails: {
          installmentAmount: 1000,
          numberOfInstallments: 5,
        },
      }).total,
    ).toBe(0);
  });

  it('builds a summary with outstanding amount', () => {
    const summary = buildPaymentSummary(base(), NOW);
    // The loan counts with its loan amount on the order...
    expect(summary.actualReceivedRevenue).toBe(55000);
    expect(summary.outstandingAmount).toBe(45000);
    // ...and with its disbursed amount in the reports.
    expect(summary.reportedRevenue).toBe(50000);
  });
});

describe('Dates & credit status (Asia/Kolkata)', () => {
  it('derives Overdue / Pending relative to the business day', () => {
    const today = toDateKey(NOW);
    expect(today).toBe('2026-11-10');
    expect(
      deriveCreditStatus({ dueDate: new Date('2026-11-09T00:00:00Z') }, today),
    ).toBe(CreditStatus.OVERDUE);
    expect(
      deriveCreditStatus({ dueDate: new Date('2026-11-10T00:00:00Z') }, today),
    ).toBe(CreditStatus.PENDING);
    // 2026-11-09T18:30Z is 2026-11-10 00:00 IST → due today, not overdue
    expect(
      deriveCreditStatus({ dueDate: new Date('2026-11-09T18:30:00Z') }, today),
    ).toBe(CreditStatus.PENDING);
    expect(
      deriveCreditStatus(
        { status: CreditStatus.PAID, dueDate: new Date('2020-01-01') },
        today,
      ),
    ).toBe(CreditStatus.PAID);
  });

  it('computes the start of a business day and day differences', () => {
    expect(
      startOfDayInTimezone('2026-11-10', 'Asia/Kolkata').toISOString(),
    ).toBe('2026-11-09T18:30:00.000Z');
    expect(
      startOfDayInTimezone('2026-03-08', 'America/New_York').toISOString(),
    ).toBe('2026-03-08T05:00:00.000Z');
    expect(diffDateKeys('2026-10-31', '2026-11-10')).toBe(10);
  });
});

describe('Legacy → v2 mapping', () => {
  const loanId = new Types.ObjectId();
  const lumpsumId = new Types.ObjectId();

  it('maps an old lumpsum order (finalFee is authoritative, references preserved)', () => {
    const legacy = {
      _id: new Types.ObjectId(),
      paymentMode: PaymentMode.LUMPSUM,
      finalFee: 40000,
      lumpsumDetails: {
        _id: lumpsumId,
        registrationDate: new Date('2026-04-03'),
        registrationAmount: 2000,
        totalReceived: 2000,
        pendingAmount: 38000,
        paymentType: 'UPI',
      },
    };
    const mapped = mapLegacyPaymentDetails(legacy, 'migration');
    expect(mapped.warnings).toEqual([]);
    expect(mapped.lumpsumPayments).toHaveLength(1);
    expect(mapped.lumpsumPayments[0]).toMatchObject({
      amount: 40000,
      amountReceived: 2000,
      paymentMode: 'UPI',
    });
    expect(mapped.lumpsumPayments[0]._id.toString()).toBe(lumpsumId.toString());
    expect(mapped.credits).toEqual([]);
  });

  it('maps an old loan order without inventing credits (flags under-coverage)', () => {
    const legacy: any = {
      _id: new Types.ObjectId(),
      paymentMode: PaymentMode.LOAN,
      finalFee: 30001,
      Approved: true,
      loanDetails: {
        loanPartner: new Types.ObjectId(partner),
        loanId,
        loanAmount: 28000,
        disbursementAmount: 0,
        firstEmiDate: new Date('2026-05-05'),
      },
    };
    const { order, warnings } = upgradeLegacyOrder({ ...legacy }, {}, NOW);
    expect(warnings).toEqual([]);
    expect(order.loans[0].loanId.toString()).toBe(loanId.toString());
    expect(order.credits).toEqual([]);
    expect(order.paymentSummary.coverageStatus).toBe(
      CoverageStatus.UNDER_COVERED,
    );
    expect(order.paymentSummary.unallocatedAmount).toBe(2001);
    expect(calculateActualRevenue(order).total).toBe(
      calculateActualRevenue(legacy).total,
    );
  });

  it('maps an old subscription order including successful payment history (deduplicated)', () => {
    const subRef = new Types.ObjectId();
    const legacy = {
      _id: new Types.ObjectId(),
      paymentMode: PaymentMode.SUBSCRIPTION,
      finalFee: 10000,
      subscriptionDetails: {
        cashfreeSubscriptionId: 'sub_session_x',
        gateway: 'Cashfree',
        installmentAmount: 1000,
        numberOfInstallments: 10,
        firstInstallmentDate: new Date('2026-05-15'),
        status: 'PENDING_AUTH',
      },
    };
    const mapped = mapLegacyPaymentDetails(legacy, 'migration', {
      subscriptionDocs: [
        { _id: subRef, subscriptionId: 'sub_1', status: 'ACTIVE' },
      ],
      subscriptionSuccessPayments: [
        { _id: new Types.ObjectId(), cfPaymentId: 'cf1', paymentAmount: 1000 },
        { _id: new Types.ObjectId(), cfPaymentId: 'cf1', paymentAmount: 1000 },
        { _id: new Types.ObjectId(), cfPaymentId: 'cf2', paymentAmount: 1000 },
      ],
    });
    const entry = mapped.subscriptions[0];
    expect(entry.gatewaySubscriptionId).toBe('sub_1');
    expect(entry.cashfreeSubscriptionId).toBe('sub_session_x');
    expect(entry.subscriptionRef.toString()).toBe(subRef.toString());
    expect(entry.paymentHistory.map((p: any) => p.gatewayPaymentId)).toEqual([
      'cf1',
      'cf2',
    ]);
  });

  it('reports incomplete legacy data instead of guessing', () => {
    const mapped = mapLegacyPaymentDetails(
      {
        paymentMode: PaymentMode.LUMPSUM,
        finalFee: 27100,
        subscriptionDetails: { installmentAmount: 0, numberOfInstallments: 1 },
      },
      'migration',
    );
    expect(mapped.subscriptions).toEqual([]);
    expect(mapped.warnings.join()).toContain(
      'subscriptionDetails present on a Lumpsum order',
    );
    expect(mapped.warnings.join()).toContain('no planned amount');
    expect(mapped.warnings.join()).toContain(
      'no legacy payment details could be mapped',
    );
  });

  it('flags over-received legacy lumpsum orders', () => {
    const mapped = mapLegacyPaymentDetails(
      {
        paymentMode: PaymentMode.LUMPSUM,
        finalFee: 10000,
        lumpsumDetails: { totalReceived: 12000, pendingAmount: -2000 },
      },
      'migration',
    );
    expect(mapped.lumpsumPayments[0].amount).toBe(12000);
    expect(mapped.warnings.join()).toContain('exceeds finalFee');
  });

  it('api mode: old clients only use the object that matches paymentMode', () => {
    const mapped = mapLegacyPaymentDetails(
      {
        paymentMode: PaymentMode.LOAN,
        finalFee: 50000,
        loanDetails: { loanPartner: partner, loanAmount: 50000 },
        lumpsumDetails: { totalReceived: 100 },
      },
      'api',
    );
    expect(mapped.loans).toHaveLength(1);
    expect(mapped.lumpsumPayments).toHaveLength(0);
  });
});
