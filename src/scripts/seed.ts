import { db } from "../db";
import { products } from "../db/schema";

async function main() {
  await db.delete(products);

  await db.insert(products).values([
    { name: "Kopi Susu", priceCents: 18000, stock: 100 },
    { name: "Matcha Latte", priceCents: 25000, stock: 80 },
    { name: "Roti Bakar", priceCents: 22000, stock: 60 },
  ]);

  const all = await db.select().from(products);
  console.log(all);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
