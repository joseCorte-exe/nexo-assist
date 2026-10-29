/**
 * The words of the action line above each reply ("✓ buscou na central de ajuda"), by tool, in each state.
 * Tools without a label here (recordDecision, the memory tool) are not actions the employee needs to see.
 */
export const ACTION_LABELS = {
  searchArticles: {
    running: "buscando na central de ajuda",
    done: "buscou na central de ajuda",
    failed: "não acessou a central de ajuda",
  },
  redirectOutOfScope: {
    running: "procurando o canal certo",
    done: "indicou o canal certo",
    failed: "não encontrou o canal",
  },
} as const;

export type ActionTool = keyof typeof ACTION_LABELS;

export const isActionTool = (tool: string): tool is ActionTool => Object.hasOwn(ACTION_LABELS, tool);

/** Shown while the agent records its decision, before any tool runs. */
export const THINKING_LABEL = "entendendo o pedido";
