import { t } from 'elysia';

export const OrderIdParams = t.Object({
  id: t.Numeric(),
});

export const OrderItemInput = t.Object({
  productId: t.Number({ minimum: 1 }),
  qty: t.Number({ minimum: 1 }),
});

export const CreateOrderBody = t.Object({
  customerId: t.Number({ minimum: 1 }),
  items: t.Array(OrderItemInput, { minItems: 1, maxItems: 50 }),
});

export const OrderItemDTO = t.Object({
  productId: t.Number(),
  qty: t.Number(),
  unitPriceCents: t.Number(),
  subtotalCents: t.Number(),
});

export const OrderDTO = t.Object({
  id: t.Number(),
  customerId: t.Number(),
  status: t.String(), // "PENDING" | "PAID" | "CANCELED" (biar simple dulu)
  totalAmountCents: t.Number(),
  createdAt: t.Union([t.String(), t.Null()]),
  items: t.Array(OrderItemDTO),
});

export const CreateOrderResponse = t.Object({
  data: OrderDTO,
});

// --- Pay Order ---
export const PayOrderBody = t.Object({
  paymentId: t.String({ minLength: 1, maxLength: 128 }),
});

export const PayOrderResponse = t.Object({
  data: t.Object({
    order: t.Object({
      id: t.Number(),
      status: t.String(),
      totalAmountCents: t.Number(),
    }),
    payment: t.Object({
      paymentId: t.String(),
      paidAt: t.Union([t.String(), t.Null()]),
    }),
  }),
});

export const PaymentDTO = t.Object({
  paymentId: t.String(),
  paidAt: t.Union([t.String(), t.Null()]),
});

// baru: detail DTO
export const OrderDetailDTO = t.Object({
  id: t.Number(),
  customerId: t.Number(),
  status: t.String(),
  totalAmountCents: t.Number(),
  createdAt: t.Union([t.String(), t.Null()]),
  items: t.Array(OrderItemDTO),

  // null kalau belum bayar
  payment: t.Union([PaymentDTO, t.Null()]),
});

export const GetOrderDetailResponse = t.Object({
  data: OrderDetailDTO,
});

// helper: query boolean yang toleran (query string bisa "true")
const QueryBool = t.Union([t.Boolean(), t.String()]);

export const ListOrdersQuery = t.Object({
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Number({ minimum: 0 })),

  customerId: t.Optional(t.Number({ minimum: 1 })),
  status: t.Optional(t.Union([t.Literal('PENDING'), t.Literal('PAID'), t.Literal('CANCELED')])),

  // date range (ISO string)
  createdAtFrom: t.Optional(t.String({ format: 'date-time' })),
  createdAtTo: t.Optional(t.String({ format: 'date-time' })),

  // default false
  includeItems: t.Optional(QueryBool),
});

export const OrderListItemDTO = t.Object({
  id: t.Number(),
  customerId: t.Number(),
  status: t.String(),
  totalAmountCents: t.Number(),
  createdAt: t.Union([t.String(), t.Null()]),
  itemsCount: t.Number(),
  payment: t.Union([PaymentDTO, t.Null()]),

  // hemat query: hanya ada kalau includeItems=true
  items: t.Optional(t.Array(OrderItemDTO)),
});

export const ListOrdersResponse = t.Object({
  data: t.Array(OrderListItemDTO),
  meta: t.Object({
    limit: t.Number(),
    offset: t.Number(),
    count: t.Number(),
  }),
});

// -------- Cursor endpoint (perbandingan) --------
export const ListOrdersCursorQuery = t.Object({
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  cursor: t.Optional(t.String()),

  customerId: t.Optional(t.Number({ minimum: 1 })),
  status: t.Optional(t.Union([t.Literal('PENDING'), t.Literal('PAID'), t.Literal('CANCELED')])),

  createdAtFrom: t.Optional(t.String({ format: 'date-time' })),
  createdAtTo: t.Optional(t.String({ format: 'date-time' })),

  includeItems: t.Optional(QueryBool),
});

export const ListOrdersCursorResponse = t.Object({
  data: t.Array(OrderListItemDTO),
  meta: t.Object({
    limit: t.Number(),
    nextCursor: t.Union([t.String(), t.Null()]),
    hasMore: t.Boolean(),
  }),
});

export const CancelOrderResponse = t.Object({
  data: t.Object({
    order: t.Object({
      id: t.Number(),
      status: t.String(), // "CANCELED"
    }),
    rolledBack: t.Boolean(),
  }),
});
