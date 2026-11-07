import { createOrder } from "@orders/index.js";
import type { OrderRequest } from "@orders/types.js";

// This adapter is a plain function, not a running HTTP server.
export async function submitOrder(body: OrderRequest) {
  if (!body.customerId || body.items.length === 0) {
    throw new Error("The example requires a customer and at least one item.");
  }
  return createOrder(body);
}
