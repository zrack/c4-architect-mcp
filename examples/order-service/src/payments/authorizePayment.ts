import { randomUUID } from "node:crypto";

export function authorizePayment(totalCents: number) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error("The example total must be a positive integer number of cents.");
  }
  // A deterministic application boundary does not imply a remote payment API.
  // This example generates a local reference and never charges anyone.
  return { reference: `simulated-payment:${randomUUID()}`, simulated: true as const };
}
