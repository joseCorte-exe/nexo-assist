# Nexo Assist

Agent de atendimento do service desk de TI da Nexo, feito para o desafio técnico da Beyond the Bytes. O funcionário descreve o problema no chat. O agent consulta os chamados dele, busca na central de ajuda, monta o rascunho de um chamado e chama um analista quando precisa. O analista atende pelo console.

As decisões completas estão em [ARQUITETURA.md](ARQUITETURA.md), e o que cada feature entregou, com testes e medições, está em [docs/features](docs/features).

## Como rodar

Precisa de Node 22.13 ou mais novo e pnpm 11.

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

O web sobe em http://localhost:3000 e o ticket-service em http://localhost:3001.

O agent usa o Claude Haiku 5.5 e precisa de `ANTHROPIC_API_KEY` no `.env`. Sem chave, `NEXO_AGENT_MODEL=simulated` troca o modelo por regras fixas, as mesmas dos testes no navegador. O resto do agent (ferramentas, memória, registro de decisão) roda igual.

Para entrar, qualquer senha serve. `ana.souza@nexo.com.br` entra como funcionária e `rafael.lima@nexo.com.br` como analista N2.

| Comando | O que faz |
|---|---|
| `pnpm db:seed` | Recria os dados de exemplo, com datas relativas a hoje |
| `pnpm test` | Roda os testes de unidade e de integração |
| `pnpm test:e2e` | Sobe o ticket-service e o web com bancos novos e roda os testes no navegador. Na primeira vez, rode `pnpm --filter @nexo/web exec playwright install chromium` |
| `pnpm typecheck` | Confere os tipos dos quatro pacotes |
| `pnpm eval` | Roda os casos do agent com o modelo real. Precisa de `ANTHROPIC_API_KEY` e custa centavos |

## Arquitetura

```
 Employee (chat)                          Analyst (console)
         |                                         |
         v                                         v
 +--------------------- apps/web (Next.js) ------------------------+
 | auth, 30-message limit, agent-paused check,                     |
 | draft confirmation, console routes                              |
 +--+-------+----------------------------------------+-------------+
    |       | import                                 | Drizzle
    |       v                                        v
    |  +--- packages/agent ---+           +--- conversations DB ------+
    |  | Mastra + Haiku 5.5   |---------->| conversations, messages,  |
    |  | tools,               |  memory   | decisions, drafts,        |
    |  | recordDecision       | (mastra_*)| mastra_*                  |
    |  +----------+-----------+           +---------------------------+
    |             |
    v             v  HTTP with service secret, retry, timeout, idempotency key
 +--- apps/ticket-service (Hono) ---+     +--- tickets DB -----------+
 | people, tickets, articles,       |---->| employees, analysts,     |
 | SLA, reopen, transfer,           |     | tickets, ticket_updates, |
 | simulated outages                |     | kb_articles, idempotency |
 +----------------------------------+     +--------------------------+
 packages/shared: Zod schemas, types, chat stream contract, SLA, HTTP client
```

- `apps/web` tem as telas e as rotas `/api`, e fala direto com o ticket-service no login, no perfil, na confirmação do rascunho, no limite e no console. A resposta do agent chega em partes. O console busca novidades a cada 3 segundos. O chat só busca enquanto a conversa está com um analista ou esperando um, a cada 3 segundos com a aba aberta e a cada 15 com ela escondida.
- `packages/agent` tem o agent do Mastra, as ferramentas e as instruções. Ele roda dentro do web.
- `apps/ticket-service` é o sistema de chamados simulado. Roda em outro processo, com banco próprio, e toda rota exige um segredo que só o web conhece.
- `packages/shared` guarda o que os dois lados precisam entender igual: os contratos em Zod, as regras de prioridade e prazo e o cliente HTTP.

Conversas, chamados e o estado de cada conversa ficam em banco (SQLite em arquivo no local), então sobrevivem a um reinício. Com `OUTAGE_RATE` acima de 0, ou pela rota `POST /admin/outage?seconds=`, o serviço de chamados cai por alguns segundos, como o legado do PRD. O `.env.example` vem com `OUTAGE_RATE=0`. O cliente tenta até 3 vezes, e as escritas só são repetidas com uma chave de idempotência, para uma nova tentativa não criar outro chamado.

## Como o agent decide

O modelo interpreta a conversa, e o código aplica as regras que não podem falhar.

O modelo decide o que o funcionário quer, classifica a categoria, identifica impacto, urgência e quem é afetado, julga se um chamado parecido é o mesmo problema e escreve a resposta. Quando falta informação, as instruções mandam perguntar em vez de transferir, e a confiança dele passa a ser sobre a pergunta. Para isso ele tem estas ferramentas:

| Ferramenta | O que faz |
|---|---|
| `recordDecision` | Grava o que entendeu, a ação, a confiança de 0 a 1 e o motivo. É obrigatória no primeiro passo de toda resposta |
| `searchArticles` | Procura na central de ajuda |
| `listMyTickets`, `getTicket` | Consultam os chamados de quem está conversando |
| `offerTicketChoice`, `offerReplies` | Mostram uma lista de chamados ou respostas rápidas e encerram a resposta |
| `draftTicket` | Monta o rascunho para criar, complementar ou reabrir |
| `transferToAnalyst` | Passa a conversa para um analista, com o resumo do caso |
| `redirectOutOfScope` | Indica o canal de RH, financeiro ou facilities |
| `markResolved` | Registra que o funcionário confirmou que o problema foi resolvido. A conversa encerra depois que a resposta é salva |

Estas regras ficam no código:

| Regra | Onde |
|---|---|
| O tipo sai do impacto. A prioridade sai do impacto, da urgência e de quem é afetado, lendo a tabela do Anexo A de cima para baixo, e vale a primeira linha que bater | `packages/shared/src/priority.ts`, `packages/agent/src/tools.ts` |
| O prazo conta da abertura ou da última resposta da TI, em horas úteis no fuso de São Paulo. O crítico conta 24 horas por dia. A reabertura conta como nova abertura, e o complemento do funcionário não reinicia o prazo. Passou sem estar resolvido, está vencido | `packages/shared/src/sla.ts`, `packages/shared/src/ticket-change.ts`, `apps/ticket-service/src/routes/tickets.ts` |
| Antes de criar um chamado, o código busca os que podem ser o mesmo problema. Se houver algum, exige que o rascunho diga por que não é duplicado | `packages/agent/src/tools.ts` |
| Nada é criado antes do clique em Confirmar, e a confirmação vai direto para o ticket-service, sem passar pelo modelo | `apps/web/lib/server/drafts.ts` |
| Só dá para reabrir até 7 dias depois da resolução | `packages/shared/src/ticket-change.ts` |
| O id do funcionário vem da sessão, nunca do modelo, e o ticket-service recusa chamado de outra pessoa | `packages/agent/src/agent.ts`, `apps/ticket-service/src/routes/tickets.ts` |
| Caso crítico ou chamado vencido vai para o N2. Pedido do funcionário ou dúvida do agent vai para o N1 | `packages/shared/src/transfer.ts` |
| Um rascunho novo que sai crítico transfere a conversa para o N2 na mesma gravação da resposta. O chamado confirmado depois fica ligado à conversa | `apps/web/lib/server/transfers.ts`, `apps/web/lib/server/conversation-moves.ts`, `apps/web/lib/server/chat.ts`, `apps/web/lib/server/drafts.ts` |
| Confiança abaixo de 0,6 obriga a transferência no passo seguinte | `packages/agent/src/agent.ts` |
| Com a conversa com um analista ou esperando um, a mensagem é gravada e o modelo não é chamado | `apps/web/lib/server/chat.ts` |
| A resposta do analista no console reinicia o prazo do chamado ligado à conversa, exceto se ele já estiver resolvido | `apps/web/lib/server/console/actions.ts`, `apps/ticket-service/src/routes/tickets.ts` |
| Cada mensagem que chama o modelo conta num teto por IP e num teto global por dia. Acima do teto, a mensagem fica gravada e o modelo não é chamado | `apps/web/lib/server/usage.ts`, `apps/web/lib/server/chat.ts` |
| O limite de 30 mensagens não passa pelo modelo. Com algo pendente, a conversa vai para um analista; sem nada pendente, ela encerra; se um analista já está com ela ou ela já espera um, nada muda. O limite conta as mensagens do funcionário por conversa: é essa a "sessão" do PRD | `apps/web/lib/server/limit.ts`, `apps/web/lib/server/chat.ts`, `packages/shared/src/continuity.ts` |

### Como ver o que ele fez

Acima de cada resposta aparece a linha de ações ("consultou seus chamados", "classificou a prioridade"). Ao expandir, aparecem o entendimento, a ação, a confiança e o motivo. O analista vê o mesmo detalhe no console, e a tela mostra o aviso quando a confiança está baixa.

## Como garanti a qualidade das decisões

Os 857 testes de unidade e de integração cobrem as regras do código: prioridade, prazo, reabertura, privacidade, idempotência, quedas do serviço e as ferramentas do agent. Como essas regras não dependem do modelo, os testes dão o mesmo resultado a cada execução.

Os 60 testes em Playwright rodam as histórias do PRD de ponta a ponta com o modelo simulado: login, consulta, rascunho, confirmação, analista assumindo, limite e volta em outro dia.

O que depende do modelo roda com o Haiku 5.5 de verdade em `pnpm eval`, com 16 casos ligados às histórias e regras do PRD, 3 rodadas cada, por cerca de US$ 0,07. Na última execução, 14 casos passaram 3 de 3, e o resultado está em [docs/evals/resultado.md](docs/evals/resultado.md). Um roteiro para testar à mão está em [docs/roteiro-de-aceite.md](docs/roteiro-de-aceite.md), mas ainda não foi percorrido num navegador. Antes disso, cada feature a partir da 3 rodou seus caminhos, em geral três vezes cada, e o resultado está no relatório dela. Os casos críticos e o encerramento como resolvida estão nos PRs [14](https://github.com/joseCorte-exe/nexo-assist/pull/14) e [12](https://github.com/joseCorte-exe/nexo-assist/pull/12). Exemplos:

| Caso | Resultado |
|---|---|
| Consultar um chamado (12 rodadas) | Seguiu a regra nas 12 |
| Abrir e complementar um chamado (9 rodadas) | Classificou certo nas 9 |
| Pedido de analista | N1, 3 de 3 |
| Chamado vencido | N2, 3 de 3 |
| Caso crítico ("o sistema de ponto caiu para toda a empresa") | N2 na primeira resposta, 4 de 4. Antes dessa regra no código e nas instruções, 0 de 4 |
| "Resolveu, obrigado" | Encerrou como resolvida, 3 de 3 |
| "Obrigado" com rascunho esperando ou nada pendente | A conversa continuou aberta, 3 de 3 em cada caso |
| "O Excel fecha sozinho com macros" | N1 por dúvida do agent em 2 de 3. Na terceira, ele perguntou de onde veio a planilha |
| Volta depois de três dias | Nas 3, consultou os chamados de novo antes de responder |

Essas rodadas mudaram o código. Na da feature 5, por exemplo, o Haiku às vezes pedia a transferência duas vezes no mesmo passo, e agora a segunda chamada recebe a resposta da primeira, sem repetir nada.

## O modelo e o custo

Usei o Claude Haiku 5.5, o mais barato e o mais rápido da família. O PRD avalia custo por conversa, e os testes acima mostraram que ele dá conta da decisão. O Sonnet 5.5 ficou como reserva caso o Haiku falhasse nesses testes.

Medido com preço de US$ 0,10 por milhão de tokens de entrada, US$ 0,01 de leitura de cache e US$ 0,50 de saída:

| Fluxo | Tempo de cada resposta | Custo |
|---|---|---|
| Consultar um chamado | 3 a 5 s | US$ 0,0005 a 0,0009 por resposta |
| Abrir um chamado do começo ao fim | 4 a 6 s | cerca de US$ 0,003 |
| Complementar um chamado | 3 a 4 s | cerca de US$ 0,002 |
| Transferir para um analista | 4 a 5 s | US$ 0,0008 a 0,0015 por resposta |

As instruções e as ferramentas ficam em cache por cerca de 5 minutos e são lidas a um décimo do preço. Os relatórios não separam as respostas com e sem cache, e uma resposta sem cache custa mais. Cada resposta tem limite de 5 passos, 2000 tokens de saída por passo e 45 segundos.

## Principais trade-offs

| Escolha | Ganho | Custo |
|---|---|---|
| Mastra em vez de LangGraph | É a preferência do PRD e já traz ferramentas, memória e stream. O forte do LangGraph é fluxo com vários agents, e aqui só existe um | Menos controle explícito do fluxo, compensado com `prepareStep` |
| Busca periódica em vez de conexão aberta | Funciona em serverless, sem infraestrutura a mais | A mensagem do analista pode levar até 3 s para aparecer com a aba aberta |
| Histórico em dois lugares | A tabela `messages` é a fonte oficial e atende buscas e console; a memória do Mastra dá contexto ao agent | Tudo o que acontece fora do agent precisa ser copiado para a memória |
| Agent como pacote dentro do web | Menos um deploy e menos um segredo | Agent e web sobem e caem juntos |
| Dois bancos | O serviço de chamados fica mesmo separado, como o PRD pede | Duas migrações e dois seeds |
| Um modelo só | Simples de medir e barato | Sem um modelo mais forte para os casos difíceis; a dúvida vai para o analista |
| Sessão em cookie assinado | Sem tabela de sessões | Não dá para derrubar uma sessão específica pelo servidor |

## Limitações conhecidas

- Numa queda do ticket-service com a lista de analistas ainda válida no cache do web, a mensagem do analista fica gravada, mas o prazo e a linha do histórico do chamado não são registrados. O prazo só recomeça na próxima mensagem que passar.
- Perguntar quando falta informação ainda depende do modelo. Se ele gravar confiança baixa sem marcar que falta informação, o código transfere. No caso do Teams isso aconteceu em 2 de 3 rodadas, e o resultado varia entre execuções.
- "Tentar de novo" depois de uma resposta que falhou não conta nos tetos de uso, até 3 chamadas por mensagem. O custo de um dia ruim pode passar da conta feita só com primeiras tentativas.
- O teto por IP pode ser contornado por quem troca de endereço, como no IPv6. O teto global por dia continua segurando o custo.
- Só um chamado novo crítico transfere sozinho. Um chamado crítico já existente segue pela consulta. Se o funcionário nunca confirmar o rascunho, o caso fica com o analista sem chamado aberto.
- O número de resolvidos sem fila na tela de login começa dos dados de exemplo (13 de 18 conversas encerradas). Um "obrigado" solto não encerra a conversa, então quem sai sem confirmar não entra nele. Uma conversa que passou por um analista e voltou ao agent entra.

## Deploy

O web e o ticket-service são dois projetos na Vercel, cada um com seu banco no Turso. As chaves ficam só no painel da Vercel, e o script `build` do ticket-service junta o serviço e o `packages/shared` num arquivo só, que o `apps/ticket-service/vercel.json` manda publicar, porque o Node da Vercel não abre TypeScript dentro de `node_modules`.

Link publicado: https://nexo-assist-ten.vercel.app

As migrações e o seed rodam contra o Turso antes de publicar. Os dois tetos de uso usam os valores padrão, 300 mensagens por IP e 1000 no total por dia.

## O que faria com mais tempo

- Deixar o agent buscar na central antes de registrar a decisão, para separar falta de informação de insegurança sem depender do modelo.
- Trocar a busca periódica por uma conexão aberta no chat e no console.
- Testar um modelo feito só para decisões para dar a nota de confiança, deixando o Haiku com a conversa.
