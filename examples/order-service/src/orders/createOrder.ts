import { randomUUID } from "node:crypto";
import { authorizePayment } from "@payments/authorizePayment.js";
import { saveOrder } from "@storage/orderRepository.js";
import type { Order, OrderRequest } from "./types.js";

export async function createOrder(request: OrderRequest): Promise<Order> {
  // A literal dynamic import is a dependency fact; it does not prove this
  // function was invoked during a real request.
  const { reserveStock } = await import("@inventory");
  const reservations = reserveStock(request.items);
  const totalCents = request.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const payment = authorizePayment(totalCents);
  return saveOrder<Order>({
    id: randomUUID(),
    customerId: request.customerId,
    totalCents,
    reservationIds: reservations,
    paymentReference: payment.reference,
    status: "example-created",
  });
}
