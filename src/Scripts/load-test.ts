import { db } from '../db/client.js';
import { reserveInventoryWithoutOrder } from '../modules/inventory/service.js';
import { ticketTypes } from '../db/schema/ticket-types.js';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

async function setupInventory(capacity: number) {
  const tenantId = randomUUID();
  const eventId = randomUUID();
  const ticketTypeId = randomUUID();

  const [inv] = await db.insert(ticketTypes).values({
    tenantId,
    eventId,
    name: 'Load Test Ticket',
    slug: 'load-test-' + ticketTypeId,
    price: '100.00',
    totalQuantity: capacity,
    soldQuantity: 0,
    reservedQuantity: 0,
  }).returning();

  return { tenantId, eventId, ticketTypeId, inventoryId: inv.id };
}

async function checkInventory(inventoryId: string) {
  const [inv] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, inventoryId));
  return inv;
}

async function runLoadTest(concurrentUsers: number, poolCapacity: number) {
  console.log(`\n=== Running test with ${concurrentUsers} concurrent buyers for ${poolCapacity} tickets ===`);
  const setup = await setupInventory(poolCapacity);
  let successCount = 0;
  let failCount = 0;

  const start = Date.now();

  const promises = Array.from({ length: concurrentUsers }).map(async () => {
    try {
      await db.transaction(async (tx) => {
        await reserveInventoryWithoutOrder(tx, { tenantId: setup.tenantId, eventId: setup.eventId, request: [{ ticketTypeId: setup.ticketTypeId, quantity: 1 }] });
      });
      successCount++;
    } catch (err) {
      failCount++;
    }
  });

  await Promise.allSettled(promises);
  const end = Date.now();

  const finalState = await checkInventory(setup.inventoryId);
  console.log(`Latency: ${end - start}ms`);
  console.log(`Successful Reservations: ${successCount}`);
  console.log(`Failed Reservations: ${failCount}`);
  const availableQuantity = finalState.totalQuantity - finalState.soldQuantity - finalState.reservedQuantity;
  console.log(`Final Available: ${availableQuantity}`);
  console.log(`Final Reserved: ${finalState.reservedQuantity}`);
  
  if (successCount > poolCapacity || availableQuantity < 0) {
    console.error('❌ FATAL OVERSELL DETECTED');
  } else {
    console.log('✅ PASS: No oversells occurred.');
  }

  return {
    concurrentUsers,
    latencyMs: end - start,
    successCount,
    failCount,
    oversell: successCount > poolCapacity
  };
}

async function main() {
  console.log('Starting Load Tests...');
  const results = [];
  
  results.push(await runLoadTest(50, 10));
  results.push(await runLoadTest(100, 20));
  results.push(await runLoadTest(500, 50));

  console.log('\n--- Load Test Summary ---');
  console.table(results);
  process.exit(0);
}

main().catch(console.error);
