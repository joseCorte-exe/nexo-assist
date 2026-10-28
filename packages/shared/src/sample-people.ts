import type { AnalystLevel } from "./domain";

// People in the sample data. Both seeds use these ids: the tickets DB owns the people,
// and the conversations DB points to them.
// TODO(design): departments and the N1 analyst are placeholders until checked against nexo.pen.
export const sampleEmployees = [
  { id: "emp-ana", name: "Ana Souza", email: "ana.souza@nexo.com.br", department: "Financeiro" },
  { id: "emp-carla", name: "Carla Mendes", email: "carla.mendes@nexo.com.br", department: "Marketing" },
  { id: "emp-bruno", name: "Bruno Tavares", email: "bruno.tavares@nexo.com.br", department: "Comercial" },
  { id: "emp-diego", name: "Diego Ramos", email: "diego.ramos@nexo.com.br", department: "Operações" },
  { id: "emp-elisa", name: "Elisa Prado", email: "elisa.prado@nexo.com.br", department: "Recursos Humanos" },
  { id: "emp-fabio", name: "Fábio Nunes", email: "fabio.nunes@nexo.com.br", department: "Jurídico" },
  { id: "emp-gabriela", name: "Gabriela Rocha", email: "gabriela.rocha@nexo.com.br", department: "Logística" },
] as const;

export const sampleAnalysts = [
  { id: "analyst-rafael", name: "Rafael Lima", email: "rafael.lima@nexo.com.br", level: "N2", available: true },
  { id: "analyst-juliana", name: "Juliana Costa", email: "juliana.costa@nexo.com.br", level: "N1", available: true },
  { id: "analyst-marcos", name: "Marcos Oliveira", email: "marcos.oliveira@nexo.com.br", level: "N1", available: false },
] as const satisfies ReadonlyArray<{ level: AnalystLevel; available: boolean } & Record<string, unknown>>;
