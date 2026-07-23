export const ORDER_STATUSES = [
  'received',
  'in_production',
  'shipped',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Legal forward transitions. `shipped` and `cancelled` are terminal — an order
 * that reached either one is never moved again, including back to itself.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  received: ['in_production', 'cancelled'],
  in_production: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === 'string' &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function allowedTransitionsFrom(
  status: OrderStatus,
): readonly OrderStatus[] {
  return TRANSITIONS[status];
}

/**
 * A transition is legal only if it appears in the source status' allowed list.
 * Same-status "transitions" are rejected too: a no-op PATCH is more likely a
 * double-submit or a stale UI than an intent, and silently accepting it would
 * write a misleading audit row.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
