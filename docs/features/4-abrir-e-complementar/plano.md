# Feature 4: Abrir e complementar

Linha da feature: [ARQUITETURA.md, seção 10, feature 4](../../../ARQUITETURA.md#desenvolvimento-feature-por-feature). Histórias: Funcionário 3, complementar um chamado aberto com novas informações; Funcionário 4, abrir um chamado só conversando, conferindo os dados antes de ele ser criado; Analista 1, receber chamados com tipo, categoria e prioridade corretos e uma descrição que não exija perguntar tudo de novo.

Tela do design: "Chat — Novo chamado (desktop)", no nexo.pen. Desta feature saem a pergunta em negrito com as respostas rápidas, a linha de ações "classificou a prioridade · consultou o SLA · montou o rascunho" e o card do rascunho, com Confirmar (⌘↵), Editar e Cancelar. O design só desenha o rascunho esperando confirmação; os outros estados do card (editando, confirmado, cancelado, substituído, erro), o complemento e a reabertura foram definidos com o design-engineer.

## Regras

| Regra | Onde fica |
|---|---|
| O chamado só é criado, complementado ou reaberto depois do clique em Confirmar, pelo código, sem passar pelo modelo | rota `POST /api/drafts/:id/confirm` |
| A prioridade vem do RN-01 (impacto, urgência e afetados que o modelo identifica). O tipo também sai do impacto: pedido é REQ, o resto é INC | `draftTicket`, com `priorityFor` do `shared` |
| Antes de criar, o código busca os chamados abertos da mesma categoria. Havendo algum, o rascunho só sai se o modelo disser por que não é o mesmo problema; se for, ele monta o complemento desse chamado | `draftTicket` + `GET /employees/:id/tickets/candidates` |
| Complemento: só em chamado aberto do funcionário. Entra como atualização do funcionário e não reinicia o prazo nem muda a "última atualização", que é a da TI (RN-02) | `PATCH /tickets/:id` |
| Reabrir: só chamado resolvido há até 7 dias corridos, contando o sétimo dia, no horário de São Paulo. Volta para "Aguardando analista" e o prazo recomeça da reabertura, que conta como uma nova abertura | `canReopen` no `shared`, conferido na ferramenta e de novo no serviço |
| Uma conversa tem no máximo um rascunho pendente. Um rascunho novo substitui o anterior | índice único parcial em `drafts` |
| Confirmar duas vezes, ou de novo depois de uma queda, não cria dois chamados: a chave de idempotência é o id do rascunho, nas três escritas | ticket-service |
| Só o dono do rascunho o vê, edita, confirma ou cancela. O rascunho de outra pessoa responde o mesmo 404 de um que não existe | rotas do web |
| Editar: título, descrição e categoria num rascunho novo; só o texto num complemento ou reabertura. A prioridade nunca | `PATCH /api/drafts/:id` |
| O que acontece fora do agent (confirmar, cancelar, editar) é gravado numa mensagem `system` e copiado para a memória do Mastra, para o modelo saber no turno seguinte | rotas do web |

## Plano

1. Contratos em `packages/shared`:
   - `domain.ts`: o rascunho ganha o estado `superseded` (substituído por um mais novo);
   - `reopen.ts`: `REOPEN_WINDOW_DAYS` e `canReopen(resolvedAt, now)`, em dias corridos de São Paulo;
   - `deadline.ts`: o prazo em palavras para o modelo e para as notas ("hoje, até 13:43", "amanhã, até 10:00", "até 31 out, 13:43");
   - `tickets.ts`: o corpo do complemento e da reabertura (`employeeId`, `text`) e a consulta de candidatos (`category`);
   - `chat.ts`: a ferramenta `draftTicket` (operação, número do chamado, título, descrição, categoria, subcategoria, impacto, urgência, afetados e o motivo de não ser duplicado, com o que falta para cada operação dito pelo próprio schema), o rascunho como a tela o desenha (`draftView`) e as saídas da ferramenta: o rascunho, ou por que não saiu (duplicado possível com os candidatos, chamado não encontrado, resolvido, não resolvido, fora dos 7 dias, serviço fora do ar);
   - `web-api.ts`: a edição do rascunho e o `drafts` do `GET /api/conversation` (o estado atual de cada rascunho da conversa);
   - `chat-parts.ts`: uma ferramenta que o Mastra recusou por entrada inválida (`{ error: true }`) passa a ser gravada como `output-error`, para a resposta continuar válida ao recarregar;
   - o cliente ganha `listCandidates`, `addFollowUp` e `reopenTicket`, e o erro do serviço traz o código que ele respondeu.
2. Ticket-service:
   - `GET /employees/:id/tickets/candidates?category=`: os abertos do funcionário naquela categoria, do mais recente para o mais antigo, pelo índice de `(opened_by, created_at)`;
   - `PATCH /tickets/:id` e `POST /tickets/:id/reopen`, com `Idempotency-Key` obrigatória, numa transação que confere o dono e o estado do chamado;
   - a idempotência vira uma função só para as três escritas, e a chave guarda a rota em que foi usada: reusada em outra rota, responde 422;
   - a queda que grava e cai antes de responder passa a valer para as três escritas.
3. O agent:
   - `draftTicket` recebe do contexto o funcionário e a conversa, calcula tipo, prioridade e prazo, busca os candidatos, confere a janela de reabertura e grava o rascunho por uma porta (`DraftStore`) que o web implementa;
   - a resposta não termina no rascunho: o modelo vê a prioridade e o prazo calculados e escreve a frase que vai acima do card. A tela desenha o card no fim da resposta;
   - instruções: quando abrir, o que perguntar (uma coisa por vez, com respostas rápidas), o que a descrição precisa ter para o analista, duplicidade, complemento, reabertura, e nunca dizer que criou antes do Confirmar;
   - "Adicionar informação" deixa de receber a resposta franca da feature 3 e vira o complemento;
   - o modelo simulado ganha os mesmos fluxos.
4. Web:
   - banco: `drafts` ganha número (D-381 em diante), prazo, motivo de não duplicidade e o índice de um pendente por conversa; impacto e urgência ficam opcionais (o complemento e a reabertura usam a classificação do chamado);
   - `POST /api/chat` passa a conversa no contexto e grava as recusas de entrada como `output-error`. Uma nota de sistema não conta como resposta de uma mensagem;
   - `GET /api/conversation` lê mensagens e rascunhos numa ida ao banco;
   - `PATCH /api/drafts/:id`, `POST /api/drafts/:id/confirm` e `POST /api/drafts/:id/cancel`.
5. Tela de Atendimento, conferida lado a lado com o design: o card do rascunho em todos os estados, a linha de ações nova, o atalho ⌘↵ (Ctrl+Enter fora do Mac), o celular e os anúncios para leitor de tela.
6. Testes: regras e contratos (shared), rotas novas com privacidade, idempotência e queda (ticket-service), ferramenta e modelo simulado (agent), rotas do rascunho e do chat (web), a leitura das partes para a tela (web) e as histórias Funcionário 3 e 4 inteiras no navegador (Playwright).

## Fica de fora

- Transferir para um analista (feature 5). "Falar com um analista" continua com a resposta franca e o ramal 4000.
- O console mostrar o rascunho e as notas de sistema (feature 5).
- Reclassificar a prioridade de um chamado complementado ou reaberto: os dois mantêm a classificação que o chamado já tinha.
- Os testes do agent com o modelo real (`pnpm eval`), que entram nos testes de ponta a ponta da seção 10. Aqui o Haiku é medido em rodadas, como na feature 3.
