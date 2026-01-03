import { t } from "elysia";

export const ProductDTO = t.Object({
  id: t.Number(),
  name: t.String(),
  priceCents: t.Number(),
  stock: t.Number(),
  createdAt: t.Union([t.String(), t.Null()]),
  updatedAt: t.Union([t.String(), t.Null()]),
});

export const ProductIdParams = t.Object({
  id: t.Numeric(), // string param -> numeric
});

export const CreateProductBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  priceCents: t.Number({ minimum: 0 }),
  stock: t.Number({ minimum: 0 }),
});

export const PatchProductBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  priceCents: t.Optional(t.Number({ minimum: 0 })),
  stock: t.Optional(t.Number({ minimum: 0 })),
});

export const ListProductsQuery = t.Object({
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Number({ minimum: 0 })),
});

export const CreateProductResponse = t.Object({ data: ProductDTO });
export const GetProductResponse = t.Object({ data: ProductDTO });
export const PatchProductResponse = t.Object({ data: ProductDTO });

export const DeleteProductResponse = t.Object({
  data: t.Object({ id: t.Number(), deleted: t.Boolean() }),
});

export const ListProductsResponse = t.Object({
  data: t.Array(ProductDTO),
  meta: t.Object({
    limit: t.Number(),
    offset: t.Number(),
    count: t.Number(),
  }),
});
