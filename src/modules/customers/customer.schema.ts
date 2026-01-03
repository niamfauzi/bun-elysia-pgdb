import { t } from 'elysia';

export const CustomerDTO = t.Object({
  id: t.Number(),
  name: t.String(),
  email: t.String(),
  createdAt: t.Union([t.String(), t.Null()]),
});

export const CustomerIdParams = t.Object({
  id: t.Numeric(),
});

export const CreateCustomerBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  email: t.String({ format: 'email', maxLength: 255 }),
});

export const PatchCustomerBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  email: t.Optional(t.String({ format: 'email', maxLength: 255 })),
});

export const ListCustomersQuery = t.Object({
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Number({ minimum: 0 })),
});

export const CreateCustomerResponse = t.Object({ data: CustomerDTO });
export const GetCustomerResponse = t.Object({ data: CustomerDTO });
export const PatchCustomerResponse = t.Object({ data: CustomerDTO });

export const DeleteCustomerResponse = t.Object({
  data: t.Object({ id: t.Number(), deleted: t.Boolean() }),
});

export const ListCustomersResponse = t.Object({
  data: t.Array(CustomerDTO),
  meta: t.Object({
    limit: t.Number(),
    offset: t.Number(),
    count: t.Number(),
  }),
});
