# Photo order demo

A parent picks a picture-day photo package, pays through Stripe Checkout, and a verified Stripe webhook
marks the order paid and hands it to the print lab.

Stack: Bun, Hono, Drizzle, Postgres, Stripe (test mode).

What it gets right:
- The price comes from the database, never from the browser.
- The webhook checks Stripe's signature on the raw body. A forged call gets a 400.
- Stripe can send the same event twice. Each event id is stored once, so a retry changes nothing.
- Recording the event and moving the order happen in one database transaction: all of it saves, or none of it does.
- The paid amount must match the order. A mismatch is flagged "needs_review" for a person, and Stripe still gets a 200 so it stops resending.
- Bad input is refused before anything reaches Stripe.

Run: `bun install`, set `DATABASE_URL`, `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`,
then `bunx drizzle-kit push`, `bun src/db/seed.ts`, `bun test`, `bun run index.ts`.
