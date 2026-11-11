/**
 * ============================================================================
 *  MIGRATION: legacy single-object order payments  →  multi-source (v2)
 * ============================================================================
 *
 *  Dry run (default – nothing is written):
 *    npm run migrate:order-payments
 *  Apply:
 *    npm run migrate:order-payments -- --apply
 *  Options:
 *    --apply              write changes (otherwise dry run)
 *    --order <id>         migrate a single order
 *    --limit <n>          stop after n candidate orders
 *    --report <file>      write the full JSON report to <file>
 *    --verify             check migrated orders (stored summary vs. recalculation)
 *    --rollback           restore legacy snapshot & remove v2 fields (only orders
 *                         without financial changes after the migration); combine
 *                         with --apply to execute
 *    --uri <mongodb-uri>  override DATABASE_URI (e.g. a copy of production)
 *    --db <name>          database name override. By default the database of
 *                         the URI is used – exactly like the application
 *                         (database.config.ts ignores DATABASE_NAME).
 *
 *  Production (compiled): node dist/scripts/migrations/migrate-order-payments.js [--apply]
 *
 *  Guarantees
 *  - Never overwrites an already migrated order (guarded update on
 *    paymentSchemaVersion), so it can be re-run safely.
 *  - Legacy fields (lumpsumDetails / loanDetails / subscriptionDetails /
 *    paymentMode / status) are NOT modified; a snapshot is kept in
 *    migrationInfo.legacySnapshot for rollback.
 *  - Payment ids, transaction references, subscription payment history,
 *    approval, counsellor and dates are preserved.
 *  - Credits are never invented: an order whose legacy payment sources do not
 *    cover finalFee is migrated as UNDER_COVERED and flagged needsReview.
 * ============================================================================
 */
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import {
  calculateActualRevenue,
  calculatePlannedCoverage,
  calculateReceivedAmounts,
  isV2Order,
  mapLegacyPaymentDetails,
  moneyEquals,
  recalculateOrderFinancials,
  validateOrderFinancials,
} from '../../api/order_management/financial/order-financial.util';
import {
  CoverageStatus,
  CURRENT_PAYMENT_SCHEMA_VERSION,
} from '../../schema/order_Management/order.schema';

export const MIGRATION_VERSION = 1;

export interface MigrationOptions {
  apply?: boolean;
  orderId?: string;
  limit?: number;
  now?: Date;
  log?: (message: string) => void;
}

export interface OrderMigrationRecord {
  orderId: string;
  action: 'MIGRATED' | 'WOULD_MIGRATE' | 'SKIPPED' | 'ERROR';
  reason?: string;
  approved?: boolean;
  paymentMode?: string;
  coverageStatus?: string;
  needsReview?: boolean;
  warnings?: string[];
  validationErrors?: string[];
  revenueBefore?: number;
  revenueAfter?: number;
  entries?: {
    lumpsum: number;
    loans: number;
    subscriptions: number;
    subscriptionPayments: number;
  };
}

export interface MigrationReport {
  mode: 'apply' | 'dry-run';
  startedAt: Date;
  finishedAt?: Date;
  totals: {
    candidates: number;
    migrated: number;
    wouldMigrate: number;
    skipped: number;
    errors: number;
    needsReview: number;
    alreadyMigrated: number;
    revenueBefore: number;
    revenueAfter: number;
    approvedRevenueBefore: number;
    approvedRevenueAfter: number;
    revenueChangedOrders: number;
    byCoverageStatus: Record<string, number>;
  };
  orders: OrderMigrationRecord[];
}

const LEGACY_FILTER = {
  $or: [
    { paymentSchemaVersion: { $exists: false } },
    { paymentSchemaVersion: null },
    { paymentSchemaVersion: { $lt: CURRENT_PAYMENT_SCHEMA_VERSION } },
  ],
};

/** Builds the v2 fields for one legacy order (pure – used by tests too). */
export function buildMigrationUpdate(order: any, extras: any, now: Date) {
  const mapped = mapLegacyPaymentDetails(order, 'migration', extras);

  // Work on a copy so the legacy fields of `order` are not touched.
  const v2: any = {
    ...order,
    lumpsumDetails: order.lumpsumDetails
      ? { ...order.lumpsumDetails }
      : undefined,
    loanDetails: order.loanDetails ? { ...order.loanDetails } : undefined,
    subscriptionDetails: order.subscriptionDetails
      ? { ...order.subscriptionDetails }
      : undefined,
    lumpsumPayments: mapped.lumpsumPayments,
    loans: mapped.loans,
    subscriptions: mapped.subscriptions,
    credits: Array.isArray(order.credits) ? order.credits : [],
  };
  recalculateOrderFinancials(v2, now);

  const validationErrors = validateOrderFinancials(v2, {
    requireBalanced: true,
  });
  const coverageStatus = v2.paymentSummary.coverageStatus;
  const needsReview =
    mapped.warnings.length > 0 ||
    validationErrors.length > 0 ||
    coverageStatus !== CoverageStatus.BALANCED;

  const $set = {
    paymentSchemaVersion: CURRENT_PAYMENT_SCHEMA_VERSION,
    lumpsumPayments: v2.lumpsumPayments,
    loans: v2.loans,
    subscriptions: v2.subscriptions,
    credits: v2.credits,
    paymentSummary: v2.paymentSummary,
    paymentModes: v2.paymentModes,
    migrationInfo: {
      migratedAt: now,
      migrationVersion: MIGRATION_VERSION,
      warnings: mapped.warnings,
      validationErrors,
      needsReview,
      derivedStatus: v2.status,
      legacySnapshot: {
        paymentMode: order.paymentMode ?? null,
        status: order.status ?? null,
        lumpsumDetails: order.lumpsumDetails ?? null,
        loanDetails: order.loanDetails ?? null,
        subscriptionDetails: order.subscriptionDetails ?? null,
      },
    },
  };

  return {
    $set,
    v2,
    warnings: mapped.warnings,
    validationErrors,
    needsReview,
    coverageStatus,
  };
}

async function loadExtras(db: any, orderId: any) {
  const [subscriptionDocs, subscriptionSuccessPayments] = await Promise.all([
    db.collection('subscriptions').find({ orderId }).toArray(),
    db
      .collection('subscriptionpayments')
      .find({ orderId, eventType: 'SUBSCRIPTION_PAYMENT_SUCCESS' })
      .toArray(),
  ]);
  return { subscriptionDocs, subscriptionSuccessPayments };
}

export async function migrateOrderPayments(
  db: any,
  options: MigrationOptions = {},
): Promise<MigrationReport> {
  const log = options.log || (() => undefined);
  const now = options.now || new Date();
  const orders = db.collection('orders');
  const report: MigrationReport = {
    mode: options.apply ? 'apply' : 'dry-run',
    startedAt: new Date(),
    totals: {
      candidates: 0,
      migrated: 0,
      wouldMigrate: 0,
      skipped: 0,
      errors: 0,
      needsReview: 0,
      alreadyMigrated: 0,
      revenueBefore: 0,
      revenueAfter: 0,
      approvedRevenueBefore: 0,
      approvedRevenueAfter: 0,
      revenueChangedOrders: 0,
      byCoverageStatus: {},
    },
    orders: [],
  };

  const baseFilter: any = options.orderId
    ? { _id: new mongoose.Types.ObjectId(options.orderId) }
    : {};
  report.totals.alreadyMigrated = await orders.countDocuments({
    ...baseFilter,
    paymentSchemaVersion: { $gte: CURRENT_PAYMENT_SCHEMA_VERSION },
  });

  const cursor = orders
    .find({ ...baseFilter, ...LEGACY_FILTER })
    .sort({ _id: 1 });

  for await (const order of cursor) {
    if (options.limit && report.totals.candidates >= options.limit) break;
    report.totals.candidates++;
    const record: OrderMigrationRecord = {
      orderId: order._id.toString(),
      action: 'SKIPPED',
      approved: !!order.Approved,
      paymentMode: order.paymentMode,
    };

    try {
      if (isV2Order(order)) {
        record.reason = 'already migrated';
        report.totals.skipped++;
        report.orders.push(record);
        continue;
      }

      const extras = await loadExtras(db, order._id);
      const result = buildMigrationUpdate(order, extras, now);
      const revenueBefore = calculateActualRevenue(order).total;
      const revenueAfter = calculateActualRevenue(result.v2).total;

      Object.assign(record, {
        coverageStatus: result.coverageStatus,
        needsReview: result.needsReview,
        warnings: result.warnings,
        validationErrors: result.validationErrors,
        revenueBefore,
        revenueAfter,
        entries: {
          lumpsum: result.v2.lumpsumPayments.length,
          loans: result.v2.loans.length,
          subscriptions: result.v2.subscriptions.length,
          subscriptionPayments: result.v2.subscriptions.reduce(
            (n: number, s: any) => n + (s.paymentHistory || []).length,
            0,
          ),
        },
      });

      if (options.apply) {
        const update = await orders.updateOne(
          { _id: order._id, ...LEGACY_FILTER },
          { $set: result.$set },
        );
        if (update.modifiedCount !== 1) {
          record.action = 'SKIPPED';
          record.reason = 'modified concurrently or already migrated';
          report.totals.skipped++;
          report.orders.push(record);
          continue;
        }
        // Link the single legacy subscription document to its order entry.
        const entry = result.v2.subscriptions[0];
        if (entry?.subscriptionRef && result.v2.subscriptions.length === 1) {
          await db.collection('subscriptions').updateOne(
            {
              _id: entry.subscriptionRef,
              orderSubscriptionEntryId: { $exists: false },
            },
            { $set: { orderSubscriptionEntryId: entry._id } },
          );
        }
        record.action = 'MIGRATED';
        report.totals.migrated++;
      } else {
        record.action = 'WOULD_MIGRATE';
        report.totals.wouldMigrate++;
      }

      report.totals.revenueBefore += revenueBefore;
      report.totals.revenueAfter += revenueAfter;
      if (order.Approved) {
        report.totals.approvedRevenueBefore += revenueBefore;
        report.totals.approvedRevenueAfter += revenueAfter;
      }
      if (!moneyEquals(revenueBefore, revenueAfter))
        report.totals.revenueChangedOrders++;
      if (result.needsReview) report.totals.needsReview++;
      report.totals.byCoverageStatus[result.coverageStatus] =
        (report.totals.byCoverageStatus[result.coverageStatus] || 0) + 1;

      log(
        `${record.action} ${record.orderId} ${order.paymentMode} coverage=${result.coverageStatus}` +
          (result.needsReview
            ? ` REVIEW: ${[...result.warnings, ...result.validationErrors].join(' | ')}`
            : ''),
      );
    } catch (error: any) {
      record.action = 'ERROR';
      record.reason = error?.message || String(error);
      report.totals.errors++;
      log(`ERROR ${record.orderId}: ${record.reason}`);
    }
    report.orders.push(record);
  }

  report.finishedAt = new Date();
  return report;
}

/** Recalculates migrated orders and reports drift between stored and computed values. */
export async function verifyMigratedOrders(db: any, now = new Date()) {
  const cursor = db
    .collection('orders')
    .find({ paymentSchemaVersion: { $gte: CURRENT_PAYMENT_SCHEMA_VERSION } });
  const issues: any[] = [];
  let checked = 0;
  for await (const order of cursor) {
    checked++;
    // actualReceivedRevenue is the amount received on the order (loans count
    // with their loan amount), not the report revenue.
    const revenue = calculateReceivedAmounts(order).total;
    const coverage = calculatePlannedCoverage(order);
    const stored = order.paymentSummary || {};
    const problems: string[] = [];
    if (!moneyEquals(stored.actualReceivedRevenue, revenue)) {
      problems.push(
        `stored actualReceivedRevenue ${stored.actualReceivedRevenue} != computed ${revenue}`,
      );
    }
    if (
      !moneyEquals(
        stored.plannedPaymentCoverage,
        coverage.plannedPaymentCoverage,
      )
    ) {
      problems.push(
        `stored plannedPaymentCoverage ${stored.plannedPaymentCoverage} != computed ${coverage.plannedPaymentCoverage}`,
      );
    }
    const copy = JSON.parse(JSON.stringify(order));
    recalculateOrderFinancials(copy, now);
    problems.push(...validateOrderFinancials(copy, { requireBalanced: true }));
    if (problems.length)
      issues.push({
        orderId: order._id.toString(),
        approved: !!order.Approved,
        problems,
      });
  }
  return { checked, ordersWithIssues: issues.length, issues };
}

/** Restores the legacy snapshot of migrated orders that were not changed afterwards. */
export async function rollbackOrderPayments(
  db: any,
  options: MigrationOptions = {},
) {
  const orders = db.collection('orders');
  const filter: any = {
    'migrationInfo.migrationVersion': MIGRATION_VERSION,
    ...(options.orderId
      ? { _id: new mongoose.Types.ObjectId(options.orderId) }
      : {}),
  };
  const result = { candidates: 0, rolledBack: 0, skipped: [] as any[] };
  for await (const order of orders.find(filter)) {
    result.candidates++;
    if ((order.financialAuditLog || []).length > 0) {
      result.skipped.push({
        orderId: order._id.toString(),
        reason: 'financial changes after migration',
      });
      continue;
    }
    if (!options.apply) continue;
    const snapshot = order.migrationInfo?.legacySnapshot || {};
    const $set: any = {};
    const $unset: any = {
      paymentSchemaVersion: '',
      lumpsumPayments: '',
      loans: '',
      subscriptions: '',
      credits: '',
      paymentSummary: '',
      paymentModes: '',
      migrationInfo: '',
    };
    for (const key of [
      'paymentMode',
      'status',
      'lumpsumDetails',
      'loanDetails',
      'subscriptionDetails',
    ]) {
      if (snapshot[key] === null || snapshot[key] === undefined)
        $unset[key] = '';
      else $set[key] = snapshot[key];
    }
    const update: any = { $unset };
    if (Object.keys($set).length) update.$set = $set;
    const res = await orders.updateOne(
      { _id: order._id, 'migrationInfo.migrationVersion': MIGRATION_VERSION },
      update,
    );
    if (res.modifiedCount === 1) result.rolledBack++;
  }
  return result;
}

/* ---------------------------------------------------------------------------
   CLI
   --------------------------------------------------------------------------- */

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key.slice(2)] = next;
      i++;
    } else {
      args[key.slice(2)] = true;
    }
  }
  return args;
}

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = (args.uri as string) || process.env.DATABASE_URI;
  if (!uri) throw new Error('DATABASE_URI is not set (or pass --uri)');

  const options: MigrationOptions = {
    apply: args.apply === true,
    orderId: typeof args.order === 'string' ? args.order : undefined,
    limit: args.limit ? Number(args.limit) : undefined,
    log: (message) => console.log(message),
  };

  await mongoose.connect(uri, {
    // Same database as the app: the one in the URI unless --db is given.
    dbName: typeof args.db === 'string' ? args.db : undefined,
  });
  const db = mongoose.connection.db;
  console.log(
    `Connected to database "${db?.databaseName}" – mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`,
  );

  try {
    if (args.verify) {
      const verification = await verifyMigratedOrders(db);
      console.log(
        JSON.stringify(
          {
            checked: verification.checked,
            ordersWithIssues: verification.ordersWithIssues,
          },
          null,
          2,
        ),
      );
      if (args.report)
        fs.writeFileSync(
          String(args.report),
          JSON.stringify(verification, null, 2),
        );
      return;
    }

    if (args.rollback) {
      const rollback = await rollbackOrderPayments(db, options);
      console.log(JSON.stringify(rollback, null, 2));
      return;
    }

    const report = await migrateOrderPayments(db, options);
    console.log('\n================ SUMMARY ================');
    console.log(JSON.stringify(report.totals, null, 2));
    if (args.report) {
      fs.writeFileSync(String(args.report), JSON.stringify(report, null, 2));
      console.log(`Full report written to ${args.report}`);
    }
    if (!options.apply) {
      console.log('\nDry run only – re-run with --apply to write the changes.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}
