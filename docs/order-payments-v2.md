# Order payments v2: multiple sources, credits, revenue and migration

This document is for frontend developers who call the Order APIs and for whoever runs the data migration.

## 1. Payment structure

An order can combine any number of payment sources. Every payment source is an array on the order:

| Field | Planned coverage | Received on the order | Revenue in reports |
|---|---|---|---|
| `lumpsumPayments[]` | `amountReceived` | `amountReceived` | `amountReceived` |
| `loans[]` | `loanAmount` | `loanAmount` | `disbursementAmount` |
| `subscriptions[]` | `installmentAmount × numberOfInstallments` | sum of `paymentHistory` entries with status `SUCCESS` | same |
| `credits[]` | `amount` | `amount` when status is `Paid` | same |

- **Lumpsum:** `registrationAmount` is what was paid at registration and is kept as a record. `amountReceived` is the money received on the entry (registration plus later payments) and is what counts. On a new entry `amountReceived` defaults to `registrationAmount`; it can never be lower. `amount` follows `amountReceived` (older entries planned for more keep their plan until more than that is received). `amount` and `transactionId` are deprecated.
- **Loans:** `disbursementStatus` is derived from the amounts (Pending, Partially Disbursed, Disbursed). Only `Cancelled` can be sent; other values are ignored.
- `paymentSummary.actualReceivedRevenue` is the amount received on the order (loans with their loan amount). `paymentSummary.reportedRevenue` is the report revenue (loans with their disbursed amount). `loanReceived` and `loanDisbursed` give the loan part of each. `GET /order/:id/financials` returns both as `received` and `revenue`.

**Rule:** `plannedLumpsum + plannedLoan + plannedSubscription + Σcredits = finalFee`.

- If the payment sources already cover `finalFee`, `credits` must be empty.
- Planned coverage greater than `finalFee` is rejected. There is no overpayment workflow.
- Amounts are never adjusted automatically. The API returns `400` with an `errors[]` list that explains the difference.

`paymentSummary` on each order is recalculated on every write. It holds planned, received, outstanding, pending-credit and `coverageStatus` values. `paymentModes` lists every source on the order. `paymentMode` is the single source, `Mixed` when there are several, or `Credit` when the order is covered by credits only.

The legacy objects `lumpsumDetails`, `loanDetails` and `subscriptionDetails` are still returned as a read-only mirror. `lumpsumDetails.totalReceived` is the total received through lumpsum payments.

All revenue calculations live in `src/api/order_management/financial/order-financial.util.ts`. Every report uses it.

## 2. API

### Create an order: `POST /order`

New payload:

```json
{
  "...student and course fields": "unchanged",
  "finalFee": 100000,
  "lumpsumPayments": [{ "registrationAmount": 2000, "amountReceived": 20000, "paymentMode": "UPI", "paymentDate": "2026-11-01" }],
  "loans": [{ "loanPartner": "<id>", "loanAmount": 30000, "disbursementAmount": 0, "loanDate": "2026-11-02", "firstEmiDate": "2026-12-05", "partnerLoanReference": "APP-77" }],
  "subscriptions": [{ "installmentAmount": 5000, "numberOfInstallments": 6, "firstInstallmentDate": "2026-11-15" }],
  "credits": [
    { "amount": 10000, "dueDate": "2026-11-10" },
    { "amount": 5000, "dueDate": "2026-11-20" },
    { "amount": 5000, "dueDate": "2026-11-30" }
  ]
}
```

- `paymentMode` is optional. It is derived from the sources.
- The old payload (`paymentMode` plus one `lumpsumDetails`, `loanDetails` or `subscriptionDetails` object) is still accepted and mapped to the new arrays. It must also balance. For example, a loan that does not cover `finalFee` needs `credits`.
- A LoanEmi tracker is created for every loan, in the same transaction as the order.

### Update payment sources: `PATCH /order/:id/financials`

Permission `orders:update`. For an approved order, `orders:approve` is also required.

Body: any of `lumpsumPayments`, `loans`, `subscriptions`, `credits`, plus optional `finalFee` and `reason`.

How each array in the body is applied:

- An item with `_id` updates that entry. Send only the fields you want to change.
- An item without `_id` adds a new entry.
- An existing entry missing from the array is removed. This is refused if money was received on it.
- A source whose array is omitted is left unchanged.

Protections:

- Increasing `amountReceived` records a new receipt and needs `orders:record_payment`. Changing `registrationAmount` moves no money.
- Reducing `amountReceived`, removing a lumpsum entry with money on it, or changing the date or mode of such an entry needs `orders:revert_payment`. Reducing and removing also need a `reason`.
- Reducing a disbursement, or marking a payment `Refunded`, needs `orders:revert_payment` and a `reason`.
- The plan of a subscription cannot be changed once it is linked to Cashfree or has payments.
- A credit that is `Paid` cannot be edited. Credit `status` is never set through this endpoint.

Every change is written to `financialAuditLog` on the order.

`PATCH /order/:id` (the generic update) still works for unapproved orders. Payment fields sent there go through the same validation.

### Credits

| Endpoint | Permission | Body |
|---|---|---|
| `POST /order/:id/credits/:creditId/pay` | `orders:record_payment` | `paymentReferenceId`, `amount` (must equal the credit amount), optional `paymentDate`, `paymentMode`, `remarks` |
| `POST /order/:id/credits/:creditId/revert` | `orders:revert_payment` | `reason` |

- A payment reference can be used only once across all orders.
- Revert keeps the status history. After a revert, the same reference can be used again.
- To collect a credit by payment link, call `POST /payment/create-link` with `creditId`. The amount must equal the credit amount. The webhook marks the credit Paid.
- `lumpsumEntryId` targets a specific lumpsum entry. Without a target, the payment link amount must not exceed the outstanding lumpsum balance.

### Approval: `PATCH /order/approve/:id`

Unchanged, except that an order whose coverage plus credits does not equal `finalFee` cannot be approved. The response lists the errors. Legacy orders are converted to v2 when they are approved.

### Reading an order: `GET /order/:id/financials`

Returns:

- the coverage and revenue breakdowns
- the validation errors
- all payment entries
- the audit log

Users who are not admins can read only their own orders and their team's orders.

### Subscriptions: `POST /subscription/create`

Accepts an optional `subscriptionEntryId` to choose which subscription plan to link. It is required when the order has more than one plan.

### Pending credits

- `GET /order/report/pending-credits` needs `orders:read_pending_credits`.
  - Query parameters: `category` (`pending` (default), `pastDue`, `dueToday`, `upcoming`, `paid`, `all`), `counsellorId`, `courseVertical`, `courseName`, `fromDate`, `toDate` (due dates), `search` (name, email or mobile), `page`, `limit`.
  - Only approved orders are included. Admins see every order; other users see their own and their team's.
  - The response has `data[]`, a `summary` with totals for pending, overdue, due today, upcoming and paid, and the pagination fields.
- `GET /order/report/pending-credits/notifications` returns the history of notification runs. Admin only.
- `POST /order/report/pending-credits/notifications/run` runs the notification immediately. Admin only.

New permission actions in the `orders` module: `record_payment`, `revert_payment`, `read_pending_credits`. Roles with `*` already have them. Assign them to other roles as needed.

## 3. Daily notification

A cron job finds credits that are past due or due today on approved orders, persists the `Overdue` status, and sends one summary to admins. The summary uses the existing `NotificationEngineService` with the event `PENDING_CREDITS_DUE`. In-app delivery happens by default. Email and WhatsApp can be enabled through notification preferences.

Recipients are active users whose role is `Admin`, is super-admin, or has `*:*` permissions, plus any user ids listed in `PENDING_CREDIT_NOTIFY_USER_IDS`.

A credit is notified at most once per date. This is enforced by a unique index on `credit_notification_logs`. Every run is stored in `credit_notification_runs`.

| Environment variable | Default |
|---|---|
| `PENDING_CREDIT_NOTIFICATION_CRON` | `0 9 * * *` |
| `PENDING_CREDIT_TIMEZONE` | `Asia/Kolkata` (also defines "today" and "overdue") |
| `PENDING_CREDIT_NOTIFICATIONS_ENABLED` | `true` |
| `PENDING_CREDIT_NOTIFY_USER_IDS` | (empty) |

## 4. Webhooks and idempotency

- Every payment applied to an order first claims a unique key in `processed_payment_events`, in the same transaction that updates the order.
  - Payment links use `link_id:transaction_id`.
  - Subscriptions use `cf_payment_id`.
  - Manual credit payments use the payment reference.
- Retried webhooks therefore return `DUPLICATE` and are not counted again.
- `/payment/webhook` now verifies the Cashfree signature.
  - The secret is `CASHFREE_WEBHOOK_SECRET`, falling back to `CASHFREE_SECRET_KEY`.
  - Unsigned or invalid events are stored but money is not applied: `financialApplication.status = SKIPPED_UNVERIFIED`.
  - To restore the old behaviour, set `CASHFREE_WEBHOOK_SIGNATURE_REQUIRED=false`.
- Successful subscription payments are counted once, whether they arrive at `/subscription/webhook/cashfree` or at the legacy branch of `/payment/webhook`.

## 5. Migration runbook

The script is `src/scripts/migrations/migrate-order-payments.ts`. It is compiled to `dist/scripts/migrations/migrate-order-payments.js`.

1. Take a backup or snapshot of the `orders` and `subscriptions` collections. Ideally, run step 2 against a copy of production first using `--uri`.
2. Run a dry run, which writes nothing:

   ```
   npm run migrate:order-payments -- --report dry-run.json
   ```

   On the server: `node dist/scripts/migrations/migrate-order-payments.js --report dry-run.json`.
3. Review the orders with `needsReview` in the report. These are explained below.
4. Apply:

   ```
   npm run migrate:order-payments -- --apply --report applied.json
   ```

   This is safe to re-run. Orders that are already migrated are skipped through a guarded update.
5. Verify, which compares the stored summary with a fresh recalculation:

   ```
   npm run migrate:order-payments -- --verify --report verify.json
   ```

6. If needed, roll back with `--rollback --apply`. This restores the legacy snapshot only for orders that have had no financial change since the migration.

The script uses the database named in `DATABASE_URI`, the same database the application uses. `DATABASE_NAME` is ignored, just as it is by the application. Pass `--db <name>` to target a different database.

What the migration does and does not do:

- Legacy fields, `paymentMode` and `status` are not modified. A snapshot is stored in `migrationInfo.legacySnapshot`.
- `_id`s, payment references, approval, counsellor and dates are preserved.
- Successful SubscriptionPayment records are imported into `paymentHistory`, with duplicates removed.
- Credits are never invented. Orders whose legacy data does not cover `finalFee` are migrated as `UNDER_COVERED` with `needsReview = true`. Add credits through `PATCH /order/:id/financials` before approving such orders.

## 6. Behaviour changes to note

- Approved revenue in reports now includes successful subscription payments and paid credits. Before this change, subscriptions counted as 0.
- The state-wise report used `countedRevenue` (booked value) and included unapproved orders. It now uses actual received revenue from approved orders only.
- Revenue is attributed to months by `orderDate`, as before. Month grouping now uses the server timezone so that it matches the date-range boundaries; previously it used UTC.
- In the pool revenue reports, `loanDisbursementAmount` and `lumpsumTotalReceived` are now numbers (`0` instead of `null`). The new fields `subscriptionRevenue` and `creditRevenue` were added.
- The user activity report gains `receivedRevenue`. `acceptedRevenue` (booked `finalFee`) is unchanged.
- Order `status` is derived from the amount received on the order. A loan counts with its loan amount, so a loan that covers the fee makes the order `Fully Paid` before it is disbursed; reports still count only the disbursed amount.
- The dashboard revenue card (`leadStats`) and the BD scope of the monthly revenue graph matched `counsellorId` as a string inside `aggregate()`. Fixed: both string and ObjectId values now match.
