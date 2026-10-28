"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/api-client";
import { LOGIN_PATH } from "@/lib/route-guard";

/** POST /api/auth/logout, then the login. A failed call still leaves: the cookie is HttpOnly, so the proxy decides. */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    await callApi("POST", "/api/auth/logout", null);
    router.replace(LOGIN_PATH);
    router.refresh();
  }

  return { signOut, pending };
}
