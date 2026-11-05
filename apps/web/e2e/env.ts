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
  // Every browser here is one visitor: the spec about the ceilings sets its own scene.
  USAGE_LIMIT_PER_IP_PER_DAY: "1000000",
  USAGE_LIMIT_GLOBAL_PER_DAY: "1000000",
};
