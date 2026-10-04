# Photo Order Demo

A parent orders picture-day photos, pays with Stripe, and the paid order is queued for the print lab.

This is a small, working version of a photography studio's parent ordering flow. It is built on
**Bun, Hono, Drizzle, Postgres and Stripe**, and it is tested end to end.

## How an order moves

```
Parent picks a package ──▶ POST /orders ──▶ Stripe Checkout ──▶ parent pays
                                                                    │
            order: sent_to_lab ◀── print lab queue ◀── POST /webhooks/stripe
```

1. The parent chooses a photo package and enters their email, the student's name and the school.
2. The server looks up the package price in the database and opens a Stripe Checkout page for that amount.
3. The parent pays on Stripe's page.
4. Stripe notifies the server that the payment went through.
5. The server checks that the notice really came from Stripe and that the amount is right.
   Then it marks the order paid and queues it for the print lab.

## What it gets right

These are the places where payment code usually loses money or trust.

- **The price comes from the database, never from the browser.** A parent cannot change what they pay.
- **Every Stripe notice is verified.** The server checks Stripe's signature before it trusts anything.
  A forged notice is rejected.
- **A repeated notice changes nothing.** Stripe sometimes sends the same notice twice. Each one is recorded
  once, so an order is never sent to the lab twice.
- **Each payment is saved in one step, all or nothing.** Recording the notice and moving the order happen
  together. If anything fails halfway, nothing is saved, and Stripe's automatic retry starts clean.
- **A wrong amount is flagged for a person.** If the amount paid does not match the order, the order is
  marked `needs_review` instead of being sent to the lab. Stripe is still told the notice arrived, so it
  stops resending it.
- **Bad input is stopped early.** An order with a missing name or an invalid email is refused before
  anything reaches Stripe.

## The tests

`bun test` runs three tests against a real Postgres database and Stripe in test mode.

| Test | What it proves |
|---|---|
| Parent orders, pays, and the order goes to the print lab | The full path works, a forged notice is rejected, and a repeated notice is ignored |
| A payment for the wrong amount is flagged for review | A mismatched payment never reaches the lab |
| A bad order is refused before it reaches Stripe | Invalid input never creates a payment |

## Run it

You need Bun, Postgres and a Stripe **test** key.

```bash
bun install
```

Create a `.env` file:

```
DATABASE_URL=postgres://user:password@localhost:5432/photos
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Then set up the database, add two sample packages, and run the tests or the server:

```bash
bunx drizzle-kit push
bun src/db/seed.ts
bun test
bun run index.ts
```

## Where things live

| File | What it holds |
|---|---|
| `src/app.ts` | The routes: packages, orders, and the Stripe webhook |
| `src/db/schema.ts` | The tables: packages, orders, Stripe events, print lab jobs |
| `tests/order-flow.test.ts` | The three tests above |

## What a production version adds

This demo covers the money path. A live studio would also need:

- A real print lab connection where the demo writes to the `lab_jobs` table
- An order confirmation email to the parent
- The parent-facing screens, and a studio view of orders that need review
