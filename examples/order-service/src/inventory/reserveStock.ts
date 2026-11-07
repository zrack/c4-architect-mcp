export function reserveStock(items: Array<{ sku: string; quantity: number }>): string[] {
  return items.map(item => {
    if (!item.sku || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Each example item needs a SKU and a positive whole quantity.");
    }
    // No warehouse is contacted and no real stock is changed.
    return `example-reservation:${item.sku}:${item.quantity}`;
  });
}
