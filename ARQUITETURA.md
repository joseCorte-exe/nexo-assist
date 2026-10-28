# Nexo Assist: estruturação

Documento da fase de estruturação do desafio técnico da Beyond the Bytes. As fontes são o PRD "Desafio Técnico Nexo Assist v5" e o protótipo no Pencil (nexo.pen, 6 telas). A regra vale até o fim do polimento: fazer o que o PRD e o design pedem, sem acrescentar nem tirar nada. As melhorias só entram depois disso (seção 12).

Revisado pelo PO (fidelidade ao PRD e ao design) e pelo engineer (arquitetura) em 27/10/2026.

## 1. Decisões tomadas

| Tema | Decisão |
|---|---|
| Login do analista | Mesma tela de login. Um e-mail de analista dos dados de exemplo vai para o console; um e-mail de funcionário vai para o chat. Qualquer senha é aceita. Um e-mail que não está nos dados de exemplo mostra o erro "E-mail não encontrado". |
| Tela "Meu perfil" | Entra, igual ao design. "Redefinir senha" só mostra o aviso de link enviado, sem mandar e-mail. |
| Números da tela de login | Vêm do banco. As fórmulas estão na seção 6. |
| Forma de desenvolver | Sem mock. Desenvolvemos uma feature por vez, back e tela juntos, seguindo os contratos da seção 7. No fim, testamos tudo de ponta a ponta (seção 10). |
| N1 ou N2 | Regra fixa. Caso crítico ou chamado vencido vai para o N2. Pedido do funcionário ou dúvida do agent vai para o N1. O filtro "Para você" mostra o que está esperando no nível do analista logado. |
| Limite de 30 mensagens | Conta por conversa. Ao bater o limite, o funcionário recebe um aviso. Se ainda houver algo pendente, a conversa vai para um analista; se não houver, ela é encerrada e a próxima mensagem abre uma nova. |
| Agent | Mastra, que é a preferência do PRD. |
| Modelo | Claude Haiku 5.5, um modelo só. Sonnet 5.5 fica de reserva se o Haiku falhar nos testes do agent. |
| Histórico da conversa | Fica em dois lugares, cada um com uma função. A nossa tabela `messages` é a fonte oficial: buscas exatas, console do analista e tudo o que acontece sem o agent. A memória do Mastra dá contexto ao agent com as últimas mensagens mais um resumo da conversa (a memória de trabalho), o que mantém o contexto e segura o custo. Tudo o que não passa pelo agent é copiado também para a memória do Mastra (seção 8). |
| Prioridade | O Haiku identifica na conversa o impacto e a urgência. O código aplica a tabela do Anexo A lendo de cima para baixo e fica com a primeira linha que bater (regra RN-01). |
| Prazo do chamado | Começa na abertura e recomeça a cada resposta da TI. O complemento do funcionário não reinicia o prazo (regra RN-02). |
| Espera na transferência | O "contato em 25 min" e o "até 12:05" usam o prazo da prioridade do caso. Sem chamado ligado, conta como Média. |
| Botão "Editar" do rascunho | Abre título, descrição e categoria como campos dentro do próprio card. A prioridade não pode ser editada, porque vem da regra. |
| Links sem tela própria | "Esqueci minha senha" mostra o mesmo aviso de "Redefinir senha". "Manter conectado" deixa a sessão valendo 30 dias; sem marcar, ela termina quando o navegador fecha. "Ramal 4000" é só texto. "Ver todos" abre a lista completa no painel. "Privacidade e uso de dados" abre um texto curto. |
| Banco | SQLite em arquivo no local e Turso no deploy, com Drizzle. São dois bancos: o das conversas e o dos chamados. |
| Deploy | Vercel (dois projetos) + Turso. |
| Fluxo de desenvolvimento | spec-flow enxuto, sem OpenSpec. Este documento continua a única fonte. Cada feature ganha uma pasta em `docs/features` com o plano, o link para a linha dela na seção 10 e uma lista do que fica de fora. Os testes curtos da seção 11 ficam fora desse fluxo: cada um vira uma nota em `docs/spikes`, e o código de teste é descartado. |

## 2. Premissas (confirmadas em 27/10/2026)

| Premissa | Por quê |
|---|---|
| Horário útil é de segunda a sexta, das 8h às 18h, no fuso de São Paulo, sem feriados. Um dia útil tem 10 horas úteis. | Vem do artigo de exemplo do Anexo B. A Vercel roda em UTC e não deixa mudar o fuso, então o código usa o fuso de São Paulo de forma explícita. |
| O prazo de chamado crítico conta 24 horas por dia. | A tabela diz "1 hora", sem "útil", e o artigo fala em plantão 24 horas. |
| Chamado vencido é o que não está resolvido e já passou do prazo da prioridade, contado da abertura ou da última resposta da TI. | O Anexo A diz que o prazo vale para a primeira resposta e para cada atualização. Com essa regra, o INC-20311 (Média, sem atualização há 6 dias) aparece vencido, como na tela 3. |
| Quando falta informação, o agent pergunta. Ele só transfere por insegurança quando, mesmo com a informação, não sabe o que fazer (confiança abaixo de 0,6, número a ajustar com os testes). | O PRD avalia "pergunta quando falta informação" e "resolução sem fila". O design mostra "Agent pediu ajuda · confiança 41%". |
| Chamado aberto é qualquer um que não está resolvido. | O design conta o REQ-10442, "Aprovado", entre os "3 chamados abertos". |
| Reabrir vale até 7 dias corridos após `resolved_at`, contando o sétimo dia. | O PRD diz "7 dias" sem "úteis", e ele escreve "úteis" quando é o caso. |
| O contador "x/30" conta só as mensagens do funcionário. | O contador fica na tela dele. |
| Cada funcionário tem uma conversa ativa por vez. | O chat do design não tem lista de conversas. |
| Todo analista vê todas as conversas no console, inclusive as que estão com o agent, e pode assumir qualquer uma, seja qual for o nível. "Para você" só filtra o que está esperando no nível de quem está logado, sem esconder o resto. | Evita uma regra de permissão que o PRD não pede. |
| Os canais de RH, financeiro e facilities usados no redirecionamento são fictícios e ficam nos dados de exemplo. | O PRD manda redirecionar, mas não diz para onde. |

## 3. Stack

| Camada | Escolha | Versão |
|---|---|---|
| Linguagem | TypeScript, `strict` + `noUncheckedIndexedAccess` | ~6.0.3 (o 7 ainda não tem suporte garantido em Next e drizzle-kit) |
| Telas e rotas | Next.js + React + Tailwind | 16.4 / 19.3 / 4.3 |
| Chat em tempo real | AI SDK (`ai`, `@ai-sdk/react`) + `@mastra/ai-sdk` com `handleChatStream({ version: 'v7' })` | 7.0 / 4.0 / 1.11 |
| Agent | `@mastra/core`, `@mastra/memory`, `@mastra/libsql` | 1.79 / 1.39 / 1.27 |
| Serviço de chamados | Hono | 4.13 |
| Banco | `@libsql/client` + Drizzle (com `tablesFilter` para não mexer nas tabelas `mastra_*`) | 0.18 / 0.45 |
| Validação e contratos | Zod | 4.6 |
| Testes | Vitest (fixo na 4, por causa do `@mastra/evals`), `@mastra/evals`, Playwright | 4.1 / 1.10 / 1.64 |
| Runtime | Node >= 22.13, pnpm workspaces (monorepo, sem Turborepo) | |

Por que essas escolhas:
- Next.js é a sugestão do PRD. Telas e rotas ficam num projeto só, a resposta do chat chega em partes e a Vercel sobe sem configuração.
- Mastra em vez de LangGraph: o PRD prefere Mastra. Ele já traz o agent com ferramentas, a memória da conversa, os testes do agent e as ações chegando na tela pelo stream. O ponto forte do LangGraph é fluxo com vários agents, e aqui só existe um.
- Turso: no local é um arquivo, então não precisa de Docker ("poucos comandos"). No ar é o mesmo banco, de graça, e a memória do Mastra fica no mesmo banco das conversas.
- Haiku 5.5: é o mais barato e o mais rápido. Custo e tempo de resposta por conversa vão ser medidos e anotados no README.

## 4. Desenho

```
 Employee (chat)                          Analyst (console)
   streamed reply;                          polls every 3 s
   polls new messages every 3 s
   while the conversation is not with_agent
         |                                         |
         v                                         v
 +--------------------- apps/web (Next.js) ------------------------+
 | auth, 30-message limit, agent-paused check,                     |
 | draft confirmation, console routes, usage limits                |
 +----------+----------------------------------------+-------------+
            | import                                 | Drizzle
            v                                        v
 +--- packages/agent ---+                 +--- conversations DB ------+
 | Mastra + Haiku 5.5   |---------------->| conversations, messages,  |
 | tools,               |  memory         | decisions, drafts,        |
 | recordDecision       |  (mastra_*)     | usage_counters, mastra_*  |
 +----------+-----------+                 +---------------------------+
            | HTTP with service secret, retry, timeout, idempotency key
            v
 +--- apps/ticket-service (Hono) ---+     +--- tickets DB -----------+
 | people, tickets, articles,       |---->| employees, analysts,     |
 | SLA, reopen, transfer,           |     | tickets, ticket_updates, |
 | simulated outages                |     | kb_articles, idempotency |
 +----------------------------------+     +--------------------------+
 packages/shared: Zod schemas, types, chat stream contract, SLA, HTTP client
```

O PRD exige que o serviço de chamados seja separado do agent. Ele roda em outro processo, com banco próprio, e o agent só fala com ele por HTTP. O ticket-service fica numa URL pública na Vercel, então toda rota exige um segredo que só o web conhece. Sem isso, qualquer pessoa leria os chamados de qualquer funcionário. O agent fica como pacote dentro do web porque um terceiro processo só traria mais deploy e mais um segredo para cuidar, sem ganho para o desafio.

## 5. Estrutura do repositório

```
nexo-assist/
  apps/
    web/              Next.js: screens, /api routes, auth
    ticket-service/   Hono: people, tickets and articles API; seed; simulated outages
  packages/
    agent/            Mastra: agent, tools, instructions, evals
    shared/           Zod schemas, types, stream contract, SLA and business hours, HTTP client
  .env.example
  README.md
```

## 6. Dados

### Banco dos chamados (ticket-service)

| Tabela | Campos principais |
|---|---|
| employees | id, name, email, department, password_changed_at |
| analysts | id, name, email, level (N1, N2), available |
| tickets | id (INC-xxxxx ou REQ-xxxxx), type (INC, REQ), title, description, category, subcategory, priority, affected (only_me, my_team, company), status, opened_by, assigned_to, created_at, updated_at, last_it_response_at, due_at, resolved_at |
| ticket_updates | id, ticket_id, author (employee, agent, analyst), text, created_at |
| kb_articles | id, title, content, category, keywords |
| idempotency_keys | key, response, created_at (gravada na mesma transação do chamado) |
| service_state | unavailable_until (janela de queda atual) |

No código, os valores ficam em inglês e a tela mostra o rótulo do design:

| Campo | Código → rótulo na tela |
|---|---|
| category | access → Acesso, network_vpn → Rede e VPN, hardware → Hardware, software → Software, email → E-mail, other → Outros. O design mostra subcategoria ("Hardware › Notebook") |
| priority | critical → Crítica, high → Alta, medium → Média, low → Baixa |
| status | waiting_for_analyst → Aguardando analista, assigned → Em atendimento · Assumido por X, in_progress → Em andamento, approved → Aprovado, resolved → Resolvido |

Status do chamado e o que muda cada um (só o que o design mostra):

| Evento | status |
|---|---|
| Chamado criado pelo agent | `waiting_for_analyst` |
| Analista assume a conversa ligada ao chamado | `assigned` |
| Reaberto (até 7 dias) | `waiting_for_analyst` |
| "Encerrar atendimento" | Não muda o chamado, só fecha a conversa |
| `in_progress`, `approved` e `resolved` | Vêm dos dados de exemplo |

`due_at` é calculado a partir de `last_it_response_at` (ou de `created_at`, se a TI ainda não respondeu), somando o prazo da prioridade em horas úteis (RN-02).

### Banco das conversas (web + agent)

| Tabela | Campos principais |
|---|---|
| conversations | id, employee_id, state, outcome, target_level (N1, N2), transfer_reason, transfer_summary, analyst_id, ticket_id, message_count, wait_until, created_at, first_response_at, closed_at |
| messages | id, conversation_id, author (employee, agent, analyst, system), text, parts (cards, opções, rascunho, com um resumo dos ids para o agent lembrar no turno seguinte), created_at |
| decisions | id, message_id, understanding, action, tools_used, confidence, reason |
| drafts | id, conversation_id, operation (create, update, reopen), title, description, type, category, subcategory, impact, urgency, priority, affected, ticket_id, status (pending, confirmed, cancelled) |
| usage_counters | key (ip + dia, ou global + dia), count (atualizada de forma atômica) |
| mastra_* | tabelas da memória do Mastra |

A sessão fica num cookie HttpOnly assinado, sem tabela.

### Estados da conversa

```
 with_agent --(transfer)--> waiting_for_analyst --(assume)--> with_analyst
     ^                              |                               |
     +----------(release)-----------+-------------------------------+
     |                                                              |
     +--> closed <------------------(close)-------------------------+
```

O agent só responde em `with_agent`. Nos outros estados, a mensagem do funcionário é gravada e o LLM não é chamado. A checagem fica no código da rota. Se o analista assumir enquanto o agent ainda responde, a resposta é gravada, mas os efeitos dela só valem se a conversa continuar `with_agent` (`UPDATE ... WHERE state = 'with_agent'`).

`outcome` registra como a conversa terminou: `resolved_by_agent` (o funcionário confirmou que resolveu), `closed_by_analyst` ou `limit_reached`. É daí que sai o selo "Resolvido pelo agent" do console.

Números da tela de login:
- Tempo médio da primeira resposta: média de `first_response_at - created_at`, nas conversas dos últimos 30 dias.
- % resolvidos sem fila: conversas com `outcome = resolved_by_agent` dividido pelo total de conversas encerradas nos últimos 30 dias.
- Analistas online agora: analistas com `available = true`.

### Dados de exemplo

As datas são relativas ao momento em que o seed roda ("há 6 dias" é sempre há 6 dias). Existe um `/admin/reseed` protegido, e o seed roda de novo no deploy antes de o link ser enviado. O seed inclui:

- Funcionários: Ana Souza (ana.souza@nexo.com.br) e os nomes do console (Carla Mendes, Bruno Tavares, Diego Ramos, Elisa Prado, Fábio Nunes, Gabriela Rocha).
- Analistas: Rafael Lima (N2) e pelo menos um analista N1.
- Artigos (de 5 a 10): o da VPN com erro 809 (só Windows 10), o do horário do service desk e os canais fictícios de RH, financeiro e facilities.
- Chamados do Anexo B com os dados exatos: INC-20311 (Notebook lento após atualização do Windows, Hardware › Notebook, Média, Aguardando analista, há 6 dias), REQ-10442 (Segundo monitor para home office, Hardware, Baixa, Aprovado, há 1 semana) e INC-20150 (Senha do SAP bloqueada, Acesso, Média, Resolvido há 4 dias).
- Chamados do design: INC-20288 (Acesso à pasta Financeiro no SharePoint, Em andamento), INC-19877 e INC-19410 (resolvidos há mais de 7 dias), além de chamados de outros funcionários.
- Conversas em cada estado e com cada selo do console: transferida com chamado, transferida com "contato em X min", "Agent pediu ajuda · confiança 41%", "Agent atendendo" e "Resolvido pelo agent".

## 7. Contratos

Os contratos ficam em `packages/shared` como schemas Zod, inclusive o formato das partes do stream do chat (`tool-recordDecision`, cards, opções, rascunho). A tela e o back usam os mesmos schemas.

### API do web (o que a tela consome)

| Método e rota | Uso |
|---|---|
| POST /api/auth/login | e-mail, senha e "manter conectado"; devolve o papel e grava o cookie |
| POST /api/auth/logout | encerra a sessão |
| GET /api/me | dados do usuário logado (tela Meu perfil) |
| POST /api/me/reset-password | só devolve o aviso (também usado por "Esqueci minha senha") |
| GET /api/stats/login | os três números da tela de login |
| GET /api/conversation | conversa ativa do funcionário, com mensagens, decisões e estado. O chat consulta a cada 3 s enquanto a conversa não está com o agent, e também ao reabrir a página |
| POST /api/chat | mensagem do funcionário; responde em partes |
| PATCH /api/drafts/:id | salva o que foi editado no card (título, descrição, categoria) |
| POST /api/drafts/:id/confirm | cria, atualiza ou reabre o chamado no ticket-service, sem passar pelo LLM |
| POST /api/drafts/:id/cancel | descarta o rascunho |
| GET /api/console/conversations?filter=&search= | lista do console; `filter` = all, for_you, with_agent, mine (Todas, Para você, Com o agent, Minhas) |
| GET /api/console/conversations/:id | histórico com decisões |
| POST /api/console/conversations/:id/assume | analista assume; agent pausado |
| POST /api/console/conversations/:id/release | devolve ao agent |
| POST /api/console/conversations/:id/close | encerra |
| POST /api/console/conversations/:id/messages | mensagem do analista |
| GET /api/console/employees/:id/tickets | painel "Chamados da Ana" e "Ver todos" |
| PATCH /api/console/me | status Disponível do analista |

O polling (do chat e do console) não entra nos contadores de uso.

### API do ticket-service (o que o web e o agent consomem)

Toda rota exige o cabeçalho com o segredo compartilhado entre os dois projetos.

| Método e rota | Uso |
|---|---|
| GET /employees?email= | login e perfil |
| GET /analysts | login, console e "analistas online" |
| PATCH /analysts/:id | status Disponível |
| GET /employees/:id/tickets?status= | chamados do funcionário |
| GET /tickets/:id?employeeId= | detalhe; recusa se o chamado não for desse funcionário |
| GET /employees/:id/tickets/candidates?category= | chamados abertos parecidos, usados na checagem de duplicidade |
| POST /tickets | cria (exige `Idempotency-Key` = id do rascunho) |
| PATCH /tickets/:id | atualiza ou complementa |
| POST /tickets/:id/reopen | reabre se foi resolvido há até 7 dias |
| POST /tickets/:id/transfer | marca a transferência com nível e resumo |
| POST /tickets/:id/assign | analista assumiu (status Em atendimento) |
| GET /kb/search?q= | busca na central de ajuda |
| POST /admin/outage?seconds= | força uma janela de queda (protegida por chave de admin) |
| POST /admin/reseed | recria os dados de exemplo com datas de hoje (protegida por chave de admin) |

Quedas do legado: como o PRD descreve, o serviço fica indisponível por alguns segundos de vez em quando. De tempos em tempos abre uma janela de queda, gravada em `service_state` (assim funciona em serverless), e também dá para forçar uma pela rota de admin. A frequência fica numa variável (`OUTAGE_RATE`, que vale 0 nos testes). Uma das falhas simuladas grava o chamado e cai antes de responder. Por isso a nova tentativa com a mesma chave devolve a resposta já gravada, sem criar outro chamado.

O cliente em `packages/shared` tenta 3 vezes, com espera crescente e timeout curto. Escritas só são repetidas com a chave de idempotência. Se as tentativas acabarem, a ferramenta devolve um erro estruturado e o agent explica ao funcionário o que aconteceu.

## 8. O agent

Ferramentas:

| Ferramenta | O que faz |
|---|---|
| recordDecision | Obrigatória no primeiro passo de toda resposta. Grava o que o agent entendeu, a ação que vai tomar, a confiança (0 a 1) e o motivo |
| searchArticles | Procura na central de ajuda |
| listMyTickets | Chamados do funcionário logado. O id vem da sessão, nunca do modelo |
| getTicket | Detalhe e situação do prazo (vencido ou não) |
| draftTicket | Monta o rascunho para criar, atualizar ou reabrir. Antes de criar, o código busca os chamados abertos parecidos e exige que o rascunho diga por que não é duplicado |
| transferToAnalyst | Muda o estado da conversa, escolhe N1 ou N2 pela regra, calcula a espera e grava o resumo do caso |
| redirectOutOfScope | Responde a assuntos de RH, financeiro e facilities indicando o canal |

Como o registro de decisão aparece em toda resposta: no primeiro passo, o `prepareStep` obriga o modelo a chamar `recordDecision`; nos passos seguintes, ele escolhe à vontade. A tela recebe essa chamada pelo próprio stream, como a parte `tool-recordDecision`, e com ela monta o detalhe da decisão. A linha de ações acima da resposta ("consultou seus chamados", "classificou a prioridade") sai das partes `tool-*`, com um mapa de nome para rótulo. No fim da resposta, o código completa `tools_used` com os passos que rodaram. Se por algum motivo o registro não vier, o código grava um registro reduzido, sem confiança. Se a confiança vier abaixo de 0,6 e não for caso de pedir informação, o passo seguinte obriga `transferToAnalyst`. Ao recarregar a página, `GET /api/conversation` devolve as mesmas decisões, lidas da tabela.

Memória: cada conversa é uma thread do Mastra (`thread` = id da conversa, `resource` = id do funcionário), configurada com as últimas mensagens e com a memória de trabalho. Cinco coisas acontecem fora do agent e precisam ser copiadas para a thread pela API de memória: mensagem do analista, mensagem do funcionário enquanto o agent está pausado, confirmação de rascunho (com id e prazo do chamado criado), aviso de limite e notas de sistema (transferido, assumido, devolvido). Elas são gravadas primeiro na nossa tabela, depois na memória. A mensagem do agent é gravada no fim da resposta, mesmo que a aba seja fechada.

Regras que ficam em código e não no prompt:
- a prioridade a partir do impacto e da urgência (RN-01);
- o prazo e o vencido (RN-02);
- a busca de candidatos a duplicado;
- a janela de 7 dias para reabrir;
- a privacidade (o id do funcionário vem da sessão);
- a criação do chamado só depois do clique em Confirmar;
- a escolha entre N1 e N2 e a espera da transferência;
- o limite de 30 mensagens e a pausa do agent.

O modelo decide o que o funcionário quer, classifica o tipo e a categoria, identifica impacto e urgência, julga se um chamado parecido é o mesmo problema, pergunta o que falta e escreve a resposta.

RN-01, prioridade (Anexo A, lida de cima para baixo, vale a primeira que bater):
1. Algo parado para uma equipe ou para a empresa: Crítica (1 hora, 24h por dia).
2. Uma pessoa impedida de trabalhar, ou compromisso no mesmo dia: Alta (4 horas úteis).
3. Atrapalha, mas há alternativa (mesmo que afete a equipe): Média (3 dias úteis).
4. Pedido ou melhoria sem urgência: Baixa (5 dias úteis).

RN-02, prazo: conta da abertura ou da última resposta da TI, o que for mais recente. O complemento do funcionário não reinicia. Passou do prazo sem estar resolvido, o chamado está vencido.

## 9. Segurança e custo

- A chave do LLM só existe no servidor, em variável de ambiente. Nada fica em `NEXT_PUBLIC_*`.
- Sessão em cookie HttpOnly assinado. Toda rota confere o papel e, no caso do funcionário, só devolve os dados dele.
- O ticket-service exige um segredo em toda rota, e as rotas de admin exigem outra chave.
- Contra abuso no deploy: o limite de 30 mensagens por conversa, um teto por IP por dia e um teto global por dia em `usage_counters` (ao estourar, aparece "demo indisponível"), além de `maxSteps`, `maxDuration` e limite de tokens explícitos, e um limite de gasto mensal num workspace da Anthropic separado para o projeto.

## 10. Fases e critérios de pronto

Regras que valem desde o primeiro commit: uma mudança por commit, com mensagem que conte a história; e os testes de uma regra são escritos junto com ela, na mesma feature.

### Estruturação (esta fase)
Pronta quando este documento estiver aprovado e as premissas da seção 2 estiverem confirmadas. Concluída em 27/10/2026: documento aprovado e premissas confirmadas.

### Desenvolvimento, feature por feature
Cada feature entrega o back e a tela juntos, seguindo os contratos da seção 7. Uma feature está pronta quando:
- as telas dela batem com o design, conferidas lado a lado com um checklist dos elementos de cada tela;
- cada tela tem estado de carregando, de erro e de vazio;
- as regras dela têm teste unitário;
- os passos dela no roteiro de aceite (abaixo) passam no local.

| # | Feature | O que entrega | Histórias |
|---|---|---|---|
| 0 | Base | Monorepo, contratos em `shared`, os dois bancos, seed com datas relativas, ticket-service com segredo, quedas simuladas, idempotência e cliente com retry. Testes de SLA, horas úteis e RN-01 | |
| 1 | Login e perfil | Login com papéis e erro de e-mail desconhecido, "Manter conectado", "Esqueci minha senha", números do login, Meu perfil, Sair | |
| 2 | Conversa com o agent | Chat com resposta em partes, registro de decisão, linha de ações e detalhe, memória, contador x/30, central de ajuda, fora de escopo, "Assistente online" | Funcionário 1 |
| 3 | Consulta de chamado | Lista selecionável, card do chamado, vencido, oferta de chamar analista | Funcionário 2 |
| 4 | Abrir e complementar | Perguntas com opções rápidas, rascunho com Confirmar, Editar (campos no card) e Cancelar, duplicidade, complementar, reabrir em 7 dias | Funcionário 3 e 4; Analista 1 |
| 5 | Transferência e console | Transferência (N1/N2, resumo, espera), console com filtros, busca, selos, Disponível, assumir, devolver, encerrar, mensagens do analista chegando no chat, painel de chamados e "Ver todos" | Funcionário 5; Analista 2 e 3 |
| 6 | Continuidade e limite | Voltar outro dia e continuar, limite de 30 (aviso, transferência ou encerramento), nova conversa após encerrar | Funcionário 6 |

Estados de tela que precisam existir no chat: com o agent, aguardando atendente, analista respondendo, encerrada, limite atingido e serviço de chamados fora do ar.

### Testes de ponta a ponta
- Roteiro de aceite escrito, com passo e resultado esperado para as 9 histórias e para cada regra do Anexo A. Ele passa inteiro no local.
- Testes do agent com o modelo real (`pnpm eval`), cada um ligado a uma história ou regra: dúvida resolvida pela central sem abrir chamado; consulta sem número que encontra chamado vencido; complemento; falta informação e o agent pergunta; referência a algo dito antes; crítico vai para N2; vencido vai para N2; pedido do funcionário vai para N1; agent inseguro vai para N1; fora de escopo; tentativa de ver chamado alheio; duplicado; reabrir com 6 dias e com 8 dias. Esses testes também decidem se o Haiku fica.
- Testes de integração: ticket-service com banco em memória; rota do chat com o LLM simulado (com o agent pausado, o LLM não é chamado).
- Playwright com o LLM simulado: login, mensagem, rascunho, confirmar e analista assumindo.

### Deploy e testes em produção
- O web e o ticket-service estão no ar na Vercel, com os bancos no Turso e as migrações rodadas no deploy.
- As chaves estão só no painel da Vercel. Os limites de abuso, o segredo entre serviços e as rotas de admin protegidas estão ativos.
- O seed rodou com as datas do dia.
- O roteiro de aceite passa no link público, incluindo uma queda forçada do serviço de chamados.
- O tempo de resposta, o custo por conversa e o tempo da primeira mensagem (servidor frio) estão medidos e anotados.

### Polimento
- O roteiro de aceite passa no local e no link, e as falhas conhecidas estão listadas no README.
- Num clone limpo, numa pasta nova, poucos comandos sobem tudo já com os dados de exemplo.
- O README tem: como rodar, visão da arquitetura, como o agent decide, como a qualidade das decisões foi garantida, trade-offs, o que faria com mais tempo, escolha do modelo, como foi o deploy e o significado de "sessão" no contador (é a conversa).
- Checklist de entrega: repositório público ou com acesso liberado, README e link do deploy.

## 11. Testes curtos antes de começar

1. O Mastra aceita `anthropic/claude-haiku-5-5` direto? Como pedir resposta rápida (pouco raciocínio)? Obrigar `recordDecision` no primeiro passo funciona com o Haiku 5.5 e o raciocínio ligado? Se não, desligar o raciocínio nesse passo.
2. Mastra dentro do Next 16 na Vercel, com Turso, e com as partes `tool-*` chegando na tela.
3. Copiar para a thread do Mastra uma mensagem que não passou pelo agent, pela API de memória, e confirmar que o agent enxerga essa mensagem no turno seguinte.
4. Rodar 5 casos em português com o Haiku. Se ele errar, trocar pelo Sonnet 5.5.

## 12. Depois do polimento (melhorias anotadas)

Nada daqui entra antes do fim do polimento.

- Usar o Jev, um modelo feito só para decisões, apenas para dar a nota de confiança, se o acesso pelo OpenRouter funcionar. O custo estimado é de mais uns US$ 0,0004 por conversa.
