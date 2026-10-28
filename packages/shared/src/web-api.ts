import { z } from "zod";
import { person } from "./people";

// Contracts of the web API (ARQUITETURA.md, section 7). The screens and the route handlers use the same schemas.

/** Error body of every route, the same shape the ticket-service uses. */
export const apiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof apiError>;

export const role = z.enum(["employee", "analyst"]);
export type Role = z.infer<typeof role>;

/** E-mails are compared trimmed and lowercased everywhere. The message for an empty field depends on the form. */
export const corporateEmail = (emptyMessage = "Digite seu e-mail corporativo.") =>
  z.string({ error: emptyMessage }).trim().toLowerCase().min(1, emptyMessage).pipe(z.email("Digite um e-mail válido."));

// POST /api/auth/login
export const loginInput = z.object({
  email: corporateEmail(),
  // Any password works: the challenge has no real accounts.
  password: z.string().min(1, "Digite sua senha."),
  remember: z.boolean(),
});
export type LoginInput = z.infer<typeof loginInput>;

export const loginResponse = z.object({ role });
export type LoginResponse = z.infer<typeof loginResponse>;

// GET /api/me
export const meResponse = person;
export type MeResponse = z.infer<typeof meResponse>;

// POST /api/me/reset-password. Only answers the notice, for any e-mail, so it does not reveal who exists.
export const resetPasswordInput = z.object({
  email: corporateEmail("Digite seu e-mail corporativo para receber o link."),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const resetPasswordResponse = z.object({ notice: z.string() });
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponse>;

// GET /api/stats/login. Each number is null when it cannot be computed (no data, or the ticket-service is down).
export const loginStats = z.object({
  firstResponseSeconds: z.number().nonnegative().nullable(),
  resolvedWithoutQueuePercent: z.number().min(0).max(100).nullable(),
  analystsOnline: z.number().int().nonnegative().nullable(),
});
export type LoginStats = z.infer<typeof loginStats>;
