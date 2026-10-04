import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const orderStatus = pgEnum("order_status", ["pending", "paid", "sent_to_lab"]);

// Photo packages a studio sells on picture day. Prices live here, never in the browser.
export const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  parentEmail: text("parent_email").notNull(),
  studentName: text("student_name").notNull(),
  school: text("school").notNull(),
  packageId: integer("package_id").notNull().references(() => packages.id),
  amountCents: integer("amount_cents").notNull(),
  status: orderStatus("status").notNull().default("pending"),
  stripeSessionId: text("stripe_session_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Every Stripe event id we have handled. Stripe can send the same event twice;
// the primary key makes the second one a no-op.
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

// What the print lab receives once an order is paid.
export const labJobs = pgTable("lab_jobs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().unique().references(() => orders.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
