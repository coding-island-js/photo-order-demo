import { test, expect, afterAll } from "bun:test";
import Stripe from "stripe";
import { app } from "../src/app";
import { sql } from "../src/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const secret = process.env.STRIPE_WEBHOOK_SECRET!;

async function signed(event: object) {
  const payload = JSON.stringify(event);
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return { method: "POST", body: payload, headers: { "stripe-signature": header } };
}

test("parent orders, pays, and the order goes to the print lab", async () => {
  const res = await app.request("/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentEmail: "parent@example.com", studentName: "Ava", school: "Pier Ave", packageId: 1 }),
  });
  expect(res.status).toBe(201);
  const { orderId, checkoutUrl } = await res.json();
  expect(checkoutUrl).toContain("checkout.stripe.com");

  const event = {
    id: `evt_test_${orderId}_${Date.now()}`, type: "checkout.session.completed",
    data: { object: { metadata: { orderId: String(orderId) }, payment_status: "paid", amount_total: 2900 } },
  };

  // A forged request without a valid signature is rejected.
  const forged = await app.request("/webhooks/stripe", { method: "POST", body: JSON.stringify(event),
    headers: { "stripe-signature": "t=1,v1=fake" } });
  expect(forged.status).toBe(400);

  expect((await app.request("/webhooks/stripe", await signed(event))).status).toBe(200);
  // Stripe retries happen. The same event a second time changes nothing.
  expect(await (await app.request("/webhooks/stripe", await signed(event))).json()).toMatchObject({ duplicate: true });

  const order = await (await app.request(`/orders/${orderId}`)).json();
  expect(order.status).toBe("sent_to_lab");
});

test("a payment for the wrong amount is flagged for review, not sent to the lab", async () => {
  const res = await app.request("/orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentEmail: "parent@example.com", studentName: "Ben", school: "Pier Ave", packageId: 1 }) });
  const { orderId } = await res.json();
  const event = { id: `evt_test_wrong_${orderId}_${Date.now()}`, type: "checkout.session.completed",
    data: { object: { metadata: { orderId: String(orderId) }, payment_status: "paid", amount_total: 100 } } };
  const hook = await app.request("/webhooks/stripe", await signed(event));
  expect(hook.status).toBe(200);
  const order = await (await app.request(`/orders/${orderId}`)).json();
  expect(order.status).toBe("needs_review");
});

test("a bad order is refused before it reaches Stripe", async () => {
  const res = await app.request("/orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentEmail: "not-an-email", studentName: "", school: "x", packageId: 1 }) });
  expect(res.status).toBe(400);
});

afterAll(() => sql.end());
