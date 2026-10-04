import { db, sql } from "./index";
import { packages } from "./schema";
await db.insert(packages).values([
  { name: "Basic: 1 8x10 + 2 5x7", priceCents: 2900 },
  { name: "Family: 2 8x10 + 8 wallets + digital", priceCents: 5900 },
]);
console.log("seeded");
await sql.end();
