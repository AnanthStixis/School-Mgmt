import { createHmac, timingSafeEqual } from 'node:crypto';

/** What a gateway tells us about an order, after its signature has been checked. */
export interface GatewayResult {
  orderId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  /** Gateway response code (0 success, 1072 declined, 1000 failed, 1006 waiting) */
  code: number;
  message: string;
  amount: number;
  mode: string | null;
  txnId: string | null;
}

/**
 * A payment gateway (Razorpay, PayU, CCAvenue, Atom…). The school hasn't chosen one yet, so only a
 * development gateway exists; a real one implements this interface and is bound to PAYMENT_GATEWAY.
 */
export interface PaymentGateway {
  readonly name: string;
  /** Where to send the parent to pay this order. */
  checkoutUrl(order: { orderId: string; amount: number }): string;
  /** Checks the webhook's signature and reads it; null if the signature is wrong. */
  parseWebhook(body: unknown, signature: string | undefined): GatewayResult | null;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Development gateway: a checkout page inside the web app lets you choose what the bank answers.
 * Its "webhook" is signed with HMAC-SHA256 like a real one, so the same verification path is exercised.
 * Refused in production (see app.module.ts).
 */
export class DevGateway implements PaymentGateway {
  readonly name = 'dev';

  constructor(
    private readonly secret: string,
    private readonly webOrigin: string,
  ) {}

  checkoutUrl(order: { orderId: string }): string {
    return `${this.webOrigin}/pay/dev/${encodeURIComponent(order.orderId)}`;
  }

  sign(result: GatewayResult): { body: GatewayResult; signature: string } {
    return { body: result, signature: this.hmac(JSON.stringify(result)) };
  }

  parseWebhook(body: unknown, signature: string | undefined): GatewayResult | null {
    if (!signature || typeof body !== 'object' || !body) return null;
    // A real gateway is verified over the raw request body; the dev gateway signs the JSON it sends.
    const expected = Buffer.from(this.hmac(JSON.stringify(body)));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const r = body as GatewayResult;
    if (typeof r.orderId !== 'string' || !['SUCCESS', 'FAILED', 'PENDING'].includes(r.status) || !Number.isInteger(r.amount)) return null;
    return r;
  }

  private hmac(s: string): string {
    return createHmac('sha256', `dev-gateway:${this.secret}`).update(s).digest('hex');
  }
}
