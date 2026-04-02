import { Cashfree, CFEnvironment } from 'cashfree-pg';

export const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === 'PRODUCTION'
    ? CFEnvironment.PRODUCTION
    : CFEnvironment.api,
  process.env.CASHFREE_APP_ID,
  process.env.CASHFREE_SECRET_KEY,
);