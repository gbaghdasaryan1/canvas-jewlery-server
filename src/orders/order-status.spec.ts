import {
  ORDER_STATUSES,
  OrderStatus,
  allowedTransitionsFrom,
  canTransition,
  isOrderStatus,
} from './order-status';

/** Every legal edge, stated independently of the implementation's table. */
const LEGAL: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  ['received', 'in_production'],
  ['received', 'cancelled'],
  ['in_production', 'shipped'],
  ['in_production', 'cancelled'],
];

function isLegal(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL.some(([f, t]) => f === from && t === to);
}

describe('order status state machine', () => {
  describe('canTransition', () => {
    it.each(LEGAL)('allows %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });

    // Exhaustive: every ordered pair not in LEGAL must be refused, which covers
    // backwards moves, self-transitions, and both terminal states.
    const illegal = ORDER_STATUSES.flatMap((from) =>
      ORDER_STATUSES.filter((to) => !isLegal(from, to)).map(
        (to) => [from, to] as const,
      ),
    );

    it.each(illegal)('rejects %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });

    it('covers every ordered pair between the two cases', () => {
      expect(LEGAL.length + illegal.length).toBe(
        ORDER_STATUSES.length * ORDER_STATUSES.length,
      );
    });
  });

  describe('terminal states', () => {
    it.each(['shipped', 'cancelled'] as const)(
      'offers no transitions out of %s',
      (status) => {
        expect(allowedTransitionsFrom(status)).toEqual([]);
      },
    );
  });

  describe('allowedTransitionsFrom', () => {
    it('offers production and cancellation from received', () => {
      expect(allowedTransitionsFrom('received')).toEqual([
        'in_production',
        'cancelled',
      ]);
    });

    it('offers shipping and cancellation from in_production', () => {
      expect(allowedTransitionsFrom('in_production')).toEqual([
        'shipped',
        'cancelled',
      ]);
    });
  });

  describe('isOrderStatus', () => {
    it.each(ORDER_STATUSES)('accepts %s', (status) => {
      expect(isOrderStatus(status)).toBe(true);
    });

    it.each([
      'RECEIVED',
      'in production',
      'refunded',
      '',
      null,
      undefined,
      42,
      {},
    ])('rejects %p', (value) => {
      expect(isOrderStatus(value)).toBe(false);
    });
  });
});
