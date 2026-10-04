import { Hono } from "hono";
import { z } from "zod";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { packages, orders, stripeEvents, labJobs } from "./db/schema";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

export const app = new Hono();

app.get("/packages", async (c) => c.json(await db.select().from(packages)));

const OrderInput = z.object({
  parentEmail: z.string().email(),
  studentName: z.string().min(1),
  school: z.string().min(1),
  packageId: z.number().int(),
});

// Parent places an order. The price comes from the database, never from the request.
app.post("/orders", async (c) => {
  const input = OrderInput.safeParse(await c.req.json());
  if (!input.success) return c.json({ error: input.error.flatten() }, 400);

  const [pkg] = await db.select().from(packages).where(eq(packages.id, input.data.packageId));
  if (!pkg) return c.json({ error: "unknown package" }, 404);

  const [order] = await db.insert(orders)
    .values({ ...input.data, amountCents: pkg.priceCents }).returning();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.parentEmail,
    line_items: [{ quantity: 1, price_data: {
      currency: "usd", unit_amount: pkg.priceCents,
      product_data: { name: `${pkg.name} for ${order.studentName}` },
    } }],
    metadata: { orderId: String(order.id) },
    success_url: `${BASE_URL}/orders/${order.id}`,
    cancel_url: `${BASE_URL}/packages`,
  });

  await db.update(orders).set({ stripeSessionId: session.id }).where(eq(orders.id, order.id));
  return c.json({ orderId: order.id, checkoutUrl: session.url }, 201);
});

app.get("/orders/:id", async (c) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, Number(c.req.param("id"))));
  return order ? c.json(order) : c.json({ error: "not found" }, 404);
});

// Stripe calls this after payment. Signature checked against the raw body,
// duplicate events ignored, amount compared before the order counts as paid.
app.post("/webhooks/stripe", async (c) => {
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await c.req.text(), c.req.header("stripe-signature") ?? "", process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return c.json({ error: "bad signature" }, 400);
  }

  // One all-or-nothing step: record the event and move the order together.
  // If anything fails, nothing is saved and Stripe's retry gets a clean second try.
  const result = await db.transaction(async (tx) => {
    const fresh = await tx.insert(stripeEvents).values({ id: event.id, type: event.type })
      .onConflictDoNothing().returning();
    if (fresh.length === 0) return "duplicate";
    if (event.type !== "checkout.session.completed") return "ignored";

    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = Number(session.metadata?.orderId);
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return "unknown order";

    // A wrong amount is flagged for a person, not bounced back to Stripe
    // (a 4xx here would make Stripe resend the same event for days).
    if (session.payment_status !== "paid" || session.amount_total !== order.amountCents) {
      await tx.update(orders).set({ status: "needs_review" }).where(eq(orders.id, orderId));
      return "needs review";
    }
    // Hand off to the print lab (a real lab API call would go here).
    await tx.insert(labJobs).values({ orderId }).onConflictDoNothing();
    await tx.update(orders).set({ status: "sent_to_lab" }).where(eq(orders.id, orderId));
    return "sent to lab";
  });
  return c.json({ received: true, duplicate: result === "duplicate", result });
});
