export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError("BAD_REQUEST", 400, message, details);

export const notFound = (message: string, details?: unknown) =>
  new AppError("NOT_FOUND", 404, message, details);

export const conflict = (message: string, details?: unknown) =>
  new AppError("CONFLICT", 409, message, details);
