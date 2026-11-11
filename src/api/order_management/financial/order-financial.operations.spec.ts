import { Types } from 'mongoose';
import {
  CreditStatus,
  LumpsumPaymentStatus,
  PaymentSource,
} from 'src/schema/order_Management/order.schema';
import {
  allocateLumpsumPayment,
  applyCreditPayment,
  applyFinancialPatch,
  applySubscriptionGatewayPayment,
  FinancialOperationError,
  revertCreditPayment,
} from './order-financial.operations';
import {
  calculateActualRevenue,
  normalizeCreditInput,
  normalizeLoanInput,
  normalizeLumpsumInput,
  normalizeSubscriptionInput,
  recalculateOrderFinancials,
  validateOrderFinancials,
} from './order-financial.util';

const partner = new Types.ObjectId().toString();
const actor = new Types.ObjectId().toString();
const NOW = new Date('2026-11-10T06:00:00.000Z');

function sampleOrder() {
  const order: any = {
    _id: new Types.ObjectId(),
    finalFee: 100000,
    lumpsumPayments: [
      normalizeLumpsumInput({
        amount: 20000,
        amountReceived: 20000,
        transactionId: 'UTR-L1',
      }),
    ],
    loans: [normalizeLoanInput({ loanPartner: partner, loanAmount: 30000 })],
    subscriptions: [
      normalizeSubscriptionInput({
        installmentAmount: 5000,
        numberOfInstallments: 6,
        firstInstallmentDate: '2026-11-01',
      }),
    ],
    credits: [
      normalizeCreditInput({ amount: 10000, dueDate: '2026-11-10' }),
      normalizeCreditInput({ amount: 5000, dueDate: '2026-11-20' }),
      normalizeCreditInput({ amount: 5000, dueDate: '2026-11-30' }),
    ],
  };
  recalculateOrderFinancials(order, NOW);
  expect(validateOrderFinancials(order)).toEqual([]);
  return order;
}

const id = (entry: any) => entry._id.toString();

const expectErrors = (fn: () => unknown, ...fragments: string[]) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FinancialOperationError);
    const text = (error as FinancialOperationError).errors.join('\n');
    for (const fragment of fragments) expect(text).toContain(fragment);
    return;
  }
  throw new Error('expected FinancialOperationError');
};

describe('applyFinancialPatch', () => {
  it('adds a payment entry and credits, keeping untouched sources', () => {
    const order = sampleOrder();
    const result = applyFinancialPatch(
      order,
      {
        lumpsumPayments: [
          { _id: id(order.lumpsumPayments[0]) },
          { amount: 5000 },
        ],
        credits: [{ _id: id(order.credits[0]) }, { _id: id(order.credits[1]) }],
      },
      { actorId: actor, now: NOW },
    );
    recalculateOrderFinancials(order, NOW);
    expect(order.lumpsumPayments).toHaveLength(2);
    expect(order.credits).toHaveLength(2);
    expect(order.loans).toHaveLength(1);
    expect(validateOrderFinancials(order)).toEqual([]);
    expect(result.audit.map((a) => a.action)).toEqual(['ADD', 'REMOVE']);
  });

  it('updates credit due dates and records an audit entry', () => {
    const order = sampleOrder();
    const result = applyFinancialPatch(order, {
      credits: order.credits.map((c: any, i: number) =>
        i === 1 ? { _id: id(c), dueDate: '2026-11-25' } : { _id: id(c) },
      ),
    });
    expect(order.credits[1].dueDate.toISOString()).toBe(
      '2026-11-25T00:00:00.000Z',
    );
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]).toMatchObject({
      action: 'UPDATE',
      entryType: 'credit',
    });
  });

  it('records an increase of a received amount as a new receipt (history preserved)', () => {
    const order = sampleOrder();
    order.lumpsumPayments[0].amount = 30000;
    applyFinancialPatch(order, {
      lumpsumPayments: [
        { _id: id(order.lumpsumPayments[0]), amountReceived: 25000 },
      ],
    });
    expect(order.lumpsumPayments[0].receipts.map((r: any) => r.amount)).toEqual(
      [20000, 5000],
    );
  });

  it('prevents reducing an already received amount', () => {
    const order = sampleOrder();
    expectErrors(
      () =>
        applyFinancialPatch(order, {
          lumpsumPayments: [
            { _id: id(order.lumpsumPayments[0]), amountReceived: 1000 },
          ],
        }),
      'amountReceived cannot be reduced',
    );
  });

  it('prevents changing the reference of a received payment', () => {
    const order = sampleOrder();
    expectErrors(
      () =>
        applyFinancialPatch(order, {
          lumpsumPayments: [
            { _id: id(order.lumpsumPayments[0]), transactionId: 'OTHER' },
          ],
        }),
      'transactionId of a received payment cannot be modified',
    );
  });

  it('prevents removing entries with received money', () => {
    const order = sampleOrder();
    expectErrors(
      () => applyFinancialPatch(order, { lumpsumPayments: [] }),
      'Cannot remove lumpsum entry',
    );
  });

  it('requires the revert permission and a reason to reduce a disbursement', () => {
    const order = sampleOrder();
    order.loans[0].disbursementAmount = 30000;
    recalculateOrderFinancials(order, NOW);
    const patch = {
      loans: [{ _id: id(order.loans[0]), disbursementAmount: 10000 }],
    };
    expectErrors(
      () => applyFinancialPatch(order, patch),
      'without the revert permission',
    );
    expectErrors(
      () => applyFinancialPatch(order, patch, { canRevertPayments: true }),
      'a reason is required',
    );
    applyFinancialPatch(order, patch, {
      canRevertPayments: true,
      reason: 'partner clawback',
    });
    expect(order.loans[0].disbursementAmount).toBe(10000);
  });

  it('blocks modification of a Paid credit and marking credits Paid through the patch', () => {
    const order = sampleOrder();
    applyCreditPayment(order, id(order.credits[0]), {
      amount: 10000,
      paymentReferenceId: 'UTR-C1',
      source: PaymentSource.MANUAL,
    });
    expectErrors(
      () =>
        applyFinancialPatch(order, {
          credits: [
            { _id: id(order.credits[0]), amount: 9000 },
            { _id: id(order.credits[1]), status: CreditStatus.PAID },
            { _id: id(order.credits[2]) },
          ],
        }),
      'a Paid credit cannot be modified',
      'use the credit payment API',
    );
    expectErrors(
      () => applyFinancialPatch(order, { credits: [] }),
      'the credit has been paid',
    );
  });

  it('locks the plan of a subscription linked to the gateway', () => {
    const order = sampleOrder();
    order.subscriptions[0].gatewaySubscriptionId = 'sub_1';
    expectErrors(
      () =>
        applyFinancialPatch(order, {
          subscriptions: [
            { _id: id(order.subscriptions[0]), installmentAmount: 6000 },
          ],
        }),
      'cannot be changed after the subscription is linked',
    );
  });

  it('rejects unknown entry ids', () => {
    const order = sampleOrder();
    expectErrors(
      () =>
        applyFinancialPatch(order, {
          credits: [{ _id: new Types.ObjectId().toString() }],
        }),
      'not found on this order',
    );
  });
});

describe('credit payment & revert', () => {
  it('marks a credit paid only with a reference and the exact amount', () => {
    const order = sampleOrder();
    const creditId = id(order.credits[0]);
    expectErrors(
      () =>
        applyCreditPayment(order, creditId, {
          amount: 10000,
          paymentReferenceId: '',
          source: PaymentSource.MANUAL,
        }),
      'paymentReferenceId is required',
    );
    expectErrors(
      () =>
        applyCreditPayment(order, creditId, {
          amount: 9000,
          paymentReferenceId: 'UTR',
          source: PaymentSource.MANUAL,
        }),
      'must equal the credit amount',
    );
    applyCreditPayment(
      order,
      creditId,
      {
        amount: 10000,
        paymentReferenceId: 'UTR',
        source: PaymentSource.MANUAL,
      },
      { actorId: actor, now: NOW },
    );
    recalculateOrderFinancials(order, NOW);
    expect(order.credits[0].status).toBe(CreditStatus.PAID);
    expect(order.credits[0].verifiedBy.toString()).toBe(actor);
    expect(calculateActualRevenue(order).credit).toBe(10000);
    expectErrors(
      () =>
        applyCreditPayment(order, creditId, {
          amount: 10000,
          paymentReferenceId: 'UTR2',
          source: PaymentSource.MANUAL,
        }),
      'already Paid',
    );
  });

  it('reverts a paid credit only with permission and reason, keeping history', () => {
    const order = sampleOrder();
    const creditId = id(order.credits[0]);
    applyCreditPayment(order, creditId, {
      amount: 10000,
      paymentReferenceId: 'UTR',
      source: PaymentSource.MANUAL,
    });
    expectErrors(
      () => revertCreditPayment(order, creditId, { reason: 'x' }),
      'requires the revert permission',
    );
    expectErrors(
      () =>
        revertCreditPayment(order, creditId, {
          canRevertPayments: true,
          reason: ' ',
        }),
      'A reason is required',
    );
    const audit = revertCreditPayment(order, creditId, {
      canRevertPayments: true,
      reason: 'cheque bounced',
      now: new Date('2026-11-12T06:00:00Z'),
    });
    expect(order.credits[0].status).toBe(CreditStatus.OVERDUE);
    expect(order.credits[0].paymentReferenceId).toBeUndefined();
    expect(order.credits[0].statusHistory.map((h: any) => h.to)).toEqual([
      CreditStatus.PAID,
      CreditStatus.OVERDUE,
    ]);
    expect(audit.action).toBe('CREDIT_PAYMENT_REVERTED');
  });
});

describe('gateway payments', () => {
  it('allocates a lumpsum payment FIFO and records excess as an explicit unplanned entry', () => {
    const order: any = {
      finalFee: 50000,
      lumpsumPayments: [
        normalizeLumpsumInput({ amount: 20000, amountReceived: 15000 }),
        normalizeLumpsumInput({ amount: 30000 }),
      ],
      loans: [],
      subscriptions: [],
      credits: [],
    };
    const result = allocateLumpsumPayment(order, {
      amount: 40000,
      referenceId: 'cf-1',
      idempotencyKey: 'k1',
    });
    recalculateOrderFinancials(order, NOW);
    expect(result.allocations.map((a) => a.amount)).toEqual([
      5000, 30000, 5000,
    ]);
    expect(order.lumpsumPayments[2].origin).toBe('UNPLANNED_GATEWAY_EXCESS');
    expect(calculateActualRevenue(order).lumpsum).toBe(55000);
    expect(order.paymentSummary.coverageStatus).toBe('OVER_COVERED');
    expect(result.audit.map((a) => a.action)).toEqual([
      'LUMPSUM_PAYMENT_RECEIVED',
      'UNPLANNED_PAYMENT',
    ]);
  });

  it('ignores a subscription payment already present in the history', () => {
    const order = sampleOrder();
    const payment = {
      gatewayPaymentId: 'cf-9',
      amount: 5000,
      idempotencyKey: 'cashfree-subscription:cf-9',
    };
    expect(applySubscriptionGatewayPayment(order, payment).applied).toBe(true);
    expect(applySubscriptionGatewayPayment(order, payment).applied).toBe(false);
    recalculateOrderFinancials(order, NOW);
    expect(calculateActualRevenue(order).subscription).toBe(5000);
  });

  it('lumpsum status follows receipts', () => {
    const order: any = {
      finalFee: 1000,
      lumpsumPayments: [normalizeLumpsumInput({ amount: 1000 })],
    };
    allocateLumpsumPayment(order, { amount: 1000, idempotencyKey: 'k' });
    recalculateOrderFinancials(order, NOW);
    expect(order.lumpsumPayments[0].status).toBe(LumpsumPaymentStatus.RECEIVED);
  });
});

describe('registration amount and loan status', () => {
  it('keeps the registration amount and raises the received amount separately', () => {
    const order = sampleOrder();
    const entry = order.lumpsumPayments[0];
    entry.registrationAmount = 20000;
    applyFinancialPatch(
      order,
      {
        lumpsumPayments: [{ _id: id(entry), amountReceived: 25000 }],
        credits: order.credits.map((c: any, i: number) => ({
          _id: id(c),
          amount: i === 0 ? 5000 : c.amount,
        })),
      },
      { actorId: actor, now: NOW },
    );
    recalculateOrderFinancials(order, NOW);
    expect(entry).toMatchObject({
      amount: 25000,
      amountReceived: 25000,
      registrationAmount: 20000,
    });
    expect(entry.receipts).toHaveLength(2);
    expect(validateOrderFinancials(order)).toEqual([]);
  });

  it('rejects a received amount below the registration amount', () => {
    const order = sampleOrder();
    const entry = order.lumpsumPayments[0];
    applyFinancialPatch(
      order,
      { lumpsumPayments: [{ _id: id(entry), registrationAmount: 30000 }] },
      { actorId: actor, now: NOW },
    );
    recalculateOrderFinancials(order, NOW);
    expect(validateOrderFinancials(order).join(' | ')).toContain(
      'cannot be less than the registrationAmount',
    );
  });

  it('reduces a received amount only with the revert permission and a reason', () => {
    const order = sampleOrder();
    const entry = order.lumpsumPayments[0];
    expectErrors(
      () =>
        applyFinancialPatch(
          order,
          { lumpsumPayments: [{ _id: id(entry), amountReceived: 15000 }] },
          { actorId: actor },
        ),
      'without the revert permission',
    );
    const noReason = sampleOrder();
    expectErrors(
      () =>
        applyFinancialPatch(
          noReason,
          {
            lumpsumPayments: [
              { _id: id(noReason.lumpsumPayments[0]), amountReceived: 1 },
            ],
          },
          { actorId: actor, canRevertPayments: true },
        ),
      'a reason is required',
    );
    const allowed = sampleOrder();
    const target = allowed.lumpsumPayments[0];
    applyFinancialPatch(
      allowed,
      { lumpsumPayments: [{ _id: id(target), amountReceived: 15000 }] },
      { actorId: actor, canRevertPayments: true, reason: 'typo', now: NOW },
    );
    recalculateOrderFinancials(allowed, NOW);
    expect(target.amountReceived).toBe(15000);
    expect(target.amount).toBe(15000);
    expect(target.receipts.at(-1).amount).toBe(-5000);
  });

  it('removes a received lumpsum only with the revert permission and a reason', () => {
    const order = sampleOrder();
    expectErrors(
      () =>
        applyFinancialPatch(order, { lumpsumPayments: [] }, { actorId: actor }),
      'requires the revert permission',
    );
    const allowed = sampleOrder();
    applyFinancialPatch(
      allowed,
      { lumpsumPayments: [] },
      { actorId: actor, canRevertPayments: true, reason: 'entered twice' },
    );
    expect(allowed.lumpsumPayments).toHaveLength(0);
  });

  it('ignores a loan status sent by the client and derives it from the disbursement', () => {
    const order = sampleOrder();
    const loan = order.loans[0];
    applyFinancialPatch(
      order,
      {
        loans: [
          {
            _id: id(loan),
            disbursementAmount: 10000,
            disbursementStatus: 'Disbursed',
          },
        ],
      },
      { actorId: actor, now: NOW },
    );
    recalculateOrderFinancials(order, NOW);
    expect(loan.disbursementStatus).toBe('Partially Disbursed');
    expect(order.paymentSummary.loanReceived).toBe(30000);
    expect(order.paymentSummary.loanDisbursed).toBe(10000);
    expect(calculateActualRevenue(order).loan).toBe(10000);
  });
});
