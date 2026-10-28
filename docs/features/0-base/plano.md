# Feature 0: Base

Linha da feature: [ARQUITETURA.md, seção 10, feature 0](../../../ARQUITETURA.md#desenvolvimento-feature-por-feature).

## Plano

1. `packages/shared`: valores de domínio (categoria, prioridade, status, tipo, afetados, impacto, urgência), o schema do chamado e da criação de chamado, as regras de prazo e o cliente HTTP do ticket-service.
2. RN-01 em `shared/src/priority.ts`. O modelo entrega três coisas e o código aplica a tabela do Anexo A de cima para baixo:
   - `impact`: `stopped` (algo parado, alguém impedido de trabalhar), `degraded` (atrapalha, mas há alternativa) ou `request` (pedido ou melhoria);
   - `urgency`: `same_day` (compromisso no mesmo dia) ou `none`;
   - `affected`: `only_me`, `my_team` ou `company`.

   | Ordem | Condição | Prioridade |
   |---|---|---|
   | 1 | `stopped` e afeta equipe ou empresa | Crítica |
   | 2 | `stopped`, ou `same_day` | Alta |
   | 3 | `degraded` | Média |
   | 4 | o resto | Baixa |
3. RN-02 e horas úteis em `shared/src/sla.ts`: segunda a sexta, 8h às 18h, fuso de São Paulo (UTC-3 fixo, o Brasil não tem horário de verão desde 2019). Crítica soma 1 hora corrida; Alta 4 horas úteis; Média 30 (3 dias de 10 horas); Baixa 50. O prazo conta de `last_it_response_at` ou, sem resposta da TI, de `created_at`. Vencido é não resolvido e com `now > due_at`.
4. Banco dos chamados (ticket-service) e banco das conversas (web) com Drizzle e migrações geradas pelo drizzle-kit. O `drizzle.config.ts` do web usa `tablesFilter` para não tocar nas tabelas `mastra_*`.
5. Seed com datas relativas ao momento em que roda: ticket-service (`pnpm --filter @nexo/ticket-service db:seed` e `POST /admin/reseed`) e web (`pnpm --filter @nexo/web db:seed`), com os dados do Anexo B e do design.
6. Ticket-service:
   - toda rota exige o cabeçalho `x-service-secret`; as rotas `/admin/*` exigem também `x-admin-key`;
   - quedas: se `service_state.unavailable_until` ainda não passou, a resposta é 503. A cada requisição, com chance `OUTAGE_RATE`, abre uma janela de 1 a 4 segundos. Quando isso cai num `POST /tickets`, metade das vezes o chamado é gravado e a resposta é 503 mesmo assim;
   - `POST /admin/outage?seconds=` força uma janela; as rotas de admin não caem;
   - `POST /tickets` exige `Idempotency-Key`. O chamado e a chave são gravados na mesma transação, e a mesma chave devolve a resposta já gravada.
7. Cliente em `shared/src/ticket-service-client.ts`: até 3 tentativas, espera crescente (300 ms, 900 ms) e timeout de 3 s por tentativa. Repete em erro de rede, timeout e 5xx. Escrita só é repetida com chave de idempotência. No fim devolve `{ ok: false, error }` com `code` = `unavailable`, `timeout`, `http_error` ou `invalid_response`.
8. Testes (Vitest): horas úteis, prazo e vencido, RN-01, idempotência e quedas do ticket-service com banco em memória, e o retry do cliente.

## Fica de fora

- As outras rotas do ticket-service (pessoas, listagem, detalhe, candidatos, atualizar, reabrir, transferir, assumir, central de ajuda). Cada uma entra com a feature que a usa.
- Os contratos da API do web e do stream do chat.
- Os rótulos em português dos valores (entram com as telas).
- O agent e qualquer tela.
- Deploy na Vercel e no Turso.
