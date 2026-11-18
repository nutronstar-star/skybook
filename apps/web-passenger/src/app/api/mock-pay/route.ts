import { createHmac, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      razorpayOrderId?: string;
      method?: string;
    };

    if (!body.razorpayOrderId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'razorpayOrderId is required' } },
        { status: 400 }
      );
    }

    const apiBase =
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || (process.env.NODE_ENV === 'production' ? 'https://skybook-api-zde1.onrender.com' : 'http://localhost:4000');
    const webhookSecret =
      process.env.RAZORPAY_WEBHOOK_SECRET || 'skybook_dev_razorpay_webhook_secret_2026';

    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: `pay_demo_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
            order_id: body.razorpayOrderId,
            method: body.method || 'upi'
          }
        }
      }
    });

    const signature = createHmac('sha256', webhookSecret)
      .update(webhookPayload)
      .digest('hex');

    const upstream = await fetch(`${apiBase}/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signature,
        'X-Razorpay-Event-Id': `evt_web_${randomUUID()}`
      },
      body: webhookPayload
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'MOCK_PAY_BRIDGE_ERROR',
          message: err instanceof Error ? err.message : 'Failed to dispatch signed webhook'
        }
      },
      { status: 500 }
    );
  }
}