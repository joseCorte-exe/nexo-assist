# Feature 5: Transferência e console

Linha da feature: [ARQUITETURA.md, seção 10, feature 5](../../../ARQUITETURA.md#desenvolvimento-feature-por-feature). Histórias: Funcionário 5, falar com um analista quando preferir ou quando o problema for grave; Analista 2, ver as conversas que precisam dele, inclusive quando o agent não teve segurança; Analista 3, assumir uma conversa com o agent pausado e devolvê-la ao agent ou encerrá-la.

Telas do design, no nexo.pen: "Atendente — Conversas (desktop)", com a conversa transferida esperando, e "Atendente — Atendimento assumido (desktop)", com o analista atendendo. Do lado do funcionário, o design só desenha a oferta de chamar um analista ("Chat — Consulta e transferência"); os estados do chat depois dela (aguardando atendente, analista respondendo, devolvida, encerrada) usam as peças do console: a linha de sistema centrada e a bolha do analista com o nível.

## Regras

| Regra | Onde fica |
|---|---|
| N1 ou N2: caso crítico ou chamado vencido vai para o N2; pedido do funcionário ou dúvida do agent vai para o N1. Crítico vem antes de vencido. Com um chamado ligado, a prioridade e o vencido saem dele, nunca do modelo; sem chamado, a prioridade sai do impacto e da urgência que o modelo leu (RN-01) e, sem eles, conta como Média | `routeTransfer` no `shared` |
| A espera é o prazo da prioridade do caso contado da transferência (ARQUITETURA.md, seção 1) | `routeTransfer` |
| Confiança abaixo de 0,6 no registro de decisão obriga o passo seguinte a transferir, com o motivo "dúvida do agent", que o código fixa | `prepareStep` do agent |
| A transferência só vale se a conversa ainda está com o agent: o estado muda com `WHERE state = 'with_agent'`, junto com a nota de sistema, num batch | `TransferStore` do web |
| O chamado ligado precisa ser do funcionário. A marca da transferência no serviço de chamados usa a nota como chave de idempotência; se o serviço cair, a conversa continua transferida e a falha fica no log | ferramenta `transferToAnalyst` |
| Fora de `with_agent`, a mensagem do funcionário é gravada, contada e copiada para a memória do Mastra, e o LLM não é chamado. A resposta do `POST /api/chat` traz só a parte da conversa | `POST /api/chat` |
| Qualquer analista assume uma conversa com o agent ou esperando. Uma conversa com outro analista não pode ser assumida, devolvida, encerrada nem respondida por ele | rotas do console |
| Assumir pausa o agent e marca o chamado ligado como Em atendimento, com o analista. Assumir de novo, pelo mesmo analista, responde o mesmo | `POST .../assume` + `POST /tickets/:id/assign` |
| Devolver vale para uma conversa esperando ou assumida por você; encerrar, só para uma assumida por você. Encerrar não muda o chamado | rotas do console |
| Toda ação do console grava uma nota de sistema (transferida, assumiu, devolveu, encerrou) e a copia para a memória; a mensagem do analista também vai para a memória, com o nome dele | rotas do console |
| A mensagem do analista usa o id que o console deu a ela: reenviada, não duplica | `POST .../messages` |
| "Para você" mostra o que espera no nível de quem está logado; "Minhas", o que está com ele; "Com o agent", o que o agent atende. Todas mostra tudo, da atividade mais recente para a mais antiga | `GET /api/console/conversations` |
| Não lidas: mensagens do funcionário depois da última leitura daquele analista naquela conversa. Abrir a conversa marca como lida | `POST .../read` |
| "Online" é o funcionário com o chat aberto nos últimos 45 s; "digitando…", alguém que digitou nos últimos 6 s. O chat avisa ao abrir, a cada 20 s com a aba visível e quando começa ou para de digitar | `POST /api/conversation/presence` |
| O console é só para analistas: um funcionário recebe 403 em toda rota dele | rotas do console |

## Plano

1. Contratos em `packages/shared`:
   - `transfer.ts`: `routeTransfer` (nível, motivo, prioridade e espera) e o rótulo do nível ("Suporte N2");
   - `chat.ts`: a ferramenta `transferToAnalyst` (motivo pedido, resumo para o analista, chamado ligado opcional e a classificação de impacto quando não há chamado) e as saídas dela; a conversa ganha as partes `note` (transferida, assumiu, devolveu, encerrou) e `analyst` (quem escreveu); `GET /api/conversation` ganha o estado da conversa mostrada, mesmo encerrada;
   - `console.ts`: filtros, busca, a linha da lista, o histórico, a mensagem do analista, o painel de chamados, o status Disponível e as frases da lista ("Transferida · contato em 25 min", "Agent pediu ajuda · confiança 41%", "agora", "ontem");
   - o cliente do serviço ganha `listEmployeesByIds`, `searchEmployees`, `setAvailability`, `transferTicket`, `assignTicket` e `getTicketForAnalyst`.
2. Ticket-service:
   - `GET /employees?ids=` e `GET /employees?q=` (nomes para a lista e a busca do console);
   - `PATCH /analysts/:id` (Disponível);
   - `POST /tickets/:id/transfer` (grava a atualização do agent com o nível e o resumo) e `POST /tickets/:id/assign` (Aguardando analista vira Em atendimento, com o analista), as duas idempotentes e conferindo o dono do chamado;
   - `GET /tickets/:id?employeeId=` continua o mesmo: o console pede com o funcionário da conversa.
3. O agent:
   - `transferToAnalyst` com a regra do `shared`, gravando por uma porta (`TransferStore`) que o web implementa;
   - transferência forçada quando a confiança vem abaixo de 0,6, e a resposta termina depois da frase que diz para quem foi e até quando;
   - instruções: quando transferir, o resumo para o analista não precisar perguntar de novo, as notas "(atendimento)" e o fim da resposta franca com o ramal 4000;
   - o modelo simulado transfere em "Falar com um analista", num pedido do funcionário e quando não sabe o que fazer.
4. Web:
   - banco: `conversations` ganha a última atividade (mantida por um gatilho), a confiança da transferência, quando foi transferida e assumida, e a presença; `messages` ganha quem escreveu e o evento da nota; `console_reads` guarda a última leitura de cada analista;
   - `POST /api/chat` grava a mensagem com a conversa pausada; `GET /api/conversation` traz as notas e as mensagens do analista;
   - as rotas do console da seção 7, mais `POST .../read` e a presença do chat.
5. Telas, conferidas lado a lado com o design: o console inteiro (trilho, lista, conversa, barra de assumir, composer, painel de chamados e "Ver todos") e os estados do chat do funcionário depois da transferência.
6. Testes: regras e contratos (shared), rotas novas (ticket-service), ferramenta, transferência forçada e simulado (agent), rotas do console e do chat com privacidade, corrida entre o agent e o analista e idas ao banco (web), e as histórias Funcionário 5, Analista 2 e Analista 3 inteiras no navegador (Playwright).

## Fica de fora

- O limite de 30 e a nova conversa depois de encerrar (feature 6). Encerrada, a conversa mostra a nota e a próxima mensagem já abre uma nova; a tela de "nova conversa" vem na 6.
- A resposta do analista no chat contar como resposta da TI no chamado (RN-02). O prazo do chamado continua contando das respostas registradas no serviço.
- Assumir uma conversa que já está com outro analista. O console mostra quem está atendendo.
- A busca e o menu ⋮ do cabeçalho da conversa, que o design desenha sem dizer o que fazem.
