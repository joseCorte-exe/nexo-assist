export const WEB_PORT = 3100;
export const TICKETS_PORT = 3101;

/** Variables both servers get in the end-to-end run. */
export const e2eEnv = {
  TICKET_SERVICE_URL: `http://localhost:${TICKETS_PORT}`,
  TICKET_SERVICE_SECRET: "e2e-service-secret",
  ADMIN_KEY: "e2e-admin-key",
  SESSION_SECRET: "e2e-session-secret-0123456789",
  OUTAGE_RATE: "0",
  // The real agent with fixed rules instead of the LLM: no key, same reply every run.
  NEXO_AGENT_MODEL: "simulated",
};
