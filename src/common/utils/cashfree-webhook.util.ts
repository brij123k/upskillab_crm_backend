import crypto from 'crypto';

export interface WebhookVerification {
  verified: boolean;
  reason?: string;
}

/** Raw request body as received (requires NestFactory.create(..., { rawBody: true })). */
export function getRawBody(req: any): string {
  if (typeof req?.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req?.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req?.body === 'string') return req.body;
  return JSON.stringify(req?.body || {});
}

/**
 * Cashfree webhook signature: base64(HMAC-SHA256(timestamp + rawBody, secret)).
 * Secret: CASHFREE_WEBHOOK_SECRET, falling back to CASHFREE_SECRET_KEY.
 */
export function verifyCashfreeWebhook(req: any): WebhookVerification {
  const timestamp = req?.headers?.['x-webhook-timestamp'];
  const signature = req?.headers?.['x-webhook-signature'];
  const secret =
    process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY;

  if (!timestamp || !signature)
    return { verified: false, reason: 'missing signature headers' };
  if (!secret)
    return { verified: false, reason: 'webhook secret not configured' };

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}${getRawBody(req)}`)
    .digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  const verified = a.length === b.length && crypto.timingSafeEqual(a, b);
  return verified ? { verified } : { verified, reason: 'signature mismatch' };
}

/** Money is only applied from verified webhooks unless explicitly disabled. */
export function isWebhookSignatureRequired(): boolean {
  return (
    String(
      process.env.CASHFREE_WEBHOOK_SIGNATURE_REQUIRED ?? 'true',
    ).toLowerCase() !== 'false'
  );
}
