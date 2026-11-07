const orders = new Map<string, unknown>();

export function saveOrder<T extends { id: string }>(order: T): T {
  orders.set(order.id, order);
  return order;
}

export function storedOrderCount(): number {
  return orders.size;
}
