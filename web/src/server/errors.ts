export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const notFound = (msg: string) => new AppError(404, "not_found", msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, "conflict", msg, details);
export const forbidden = (msg: string) => new AppError(403, "forbidden", msg);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, "invalid", msg, details);
