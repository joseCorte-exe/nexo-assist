import { apiError } from "@nexo/shared";
import type { z } from "zod";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

const NETWORK_MESSAGE = "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.";

/** Calls a web API route and reads the answer with the contract schema (z.undefined() for a 204). Never throws. */
export async function callApi<T>(
  method: "GET" | "POST",
  url: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: NETWORK_MESSAGE };
  }

  const json: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = apiError.safeParse(json);
    return error.success
      ? { ok: false, status: response.status, ...error.data.error }
      : { ok: false, status: response.status, code: "unexpected", message: "Algo deu errado. Tente de novo." };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: response.status, code: "invalid_response", message: "Algo deu errado. Tente de novo." };
}
