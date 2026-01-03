import { Elysia } from "elysia";
import { db } from "../../db";
import { ProductRepository } from "./product.repository";
import { ProductService } from "./product.service";
import {
  CreateProductBody,
  CreateProductResponse,
  DeleteProductResponse,
  GetProductResponse,
  ListProductsQuery,
  ListProductsResponse,
  PatchProductBody,
  PatchProductResponse,
  ProductIdParams,
} from "./product.schema";

const repo = new ProductRepository(db);
const service = new ProductService(repo);

export const productsModule = new Elysia({ name: "products-module" })
  .post(
    "/products",
    async ({ body }) => ({ data: await service.create(body) }),
    { body: CreateProductBody, response: { 200: CreateProductResponse } }
  )
  .get(
    "/products",
    async ({ query }) => {
      const limit = query.limit ?? 20;
      const offset = query.offset ?? 0;
      return service.list({ limit, offset });
    },
    { query: ListProductsQuery, response: { 200: ListProductsResponse } }
  )
  .get(
    "/products/:id",
    async ({ params }) => ({ data: await service.getById(params.id) }),
    { params: ProductIdParams, response: { 200: GetProductResponse } }
  )
  .patch(
    "/products/:id",
    async ({ params, body }) => ({ data: await service.patchById(params.id, body) }),
    { params: ProductIdParams, body: PatchProductBody, response: { 200: PatchProductResponse } }
  )
  .delete(
    "/products/:id",
    async ({ params }) => ({ data: await service.deleteById(params.id) }),
    { params: ProductIdParams, response: { 200: DeleteProductResponse } }
  );
