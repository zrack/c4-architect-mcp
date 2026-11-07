export interface OrderItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderRequest {
  customerId: string;
  items: OrderItem[];
}

export interface Order {
  id: string;
  customerId: string;
  totalCents: number;
  reservationIds: string[];
  paymentReference: string;
  status: "example-created";
}
