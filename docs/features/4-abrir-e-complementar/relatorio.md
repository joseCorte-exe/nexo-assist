# Feature 4: relatório de entrega

O plano está em [plano.md](plano.md). Este arquivo junta o que foi pedido, a prova de cada item e as medições, feitas entre 29 e 30/10/2026.

## O que foi pedido e a prova de cada item

| Pedido | Prova |
|---|---|
| Front e back | Ticket-service com `GET /employees/:id/tickets/candidates`, `PATCH /tickets/:id` e `POST /tickets/:id/reopen`; contratos do rascunho em `packages/shared`; a ferramenta `draftTicket` no agent; as rotas `PATCH /api/drafts/:id`, `POST /api/drafts/:id/confirm` e `POST /api/drafts/:id/cancel` no web; o card do rascunho em todos os estados. |
| Fiel ao design | Medições abaixo, com a conversa do design gravada com os mesmos dados. Imagens em [provas/](provas/). |
| Lógica do back | Nada é criado sem o clique em Confirmar, e a confirmação não passa pelo modelo. Tipo e prioridade (RN-01), prazo (RN-02), duplicidade e a janela de 7 dias ficam no código. As três escritas são idempotentes, com a chave amarrada à rota, ao chamado e ao funcionário. O rascunho de outra pessoa responde o mesmo 404 de um que não existe. |
| Desempenho | A conversa e os rascunhos saem numa ida ao banco; um rascunho novo substitui o anterior e ganha número num batch só; as rotas novas usam o índice de `(opened_by, created_at)`, com teste do plano da consulta. A lista de chamados traz abertos e reabríveis numa chamada. |
| Padrão do contrato | Os schemas Zod de `packages/shared` servem ao serviço, ao agent, às rotas e à tela. Uma entrada que o Mastra recusa é gravada como erro da ferramenta, e a resposta continua válida ao recarregar. |
| Testes primeiro | Cada camada começou por um teste que falhou pelo motivo certo, inclusive cada correção da revisão. |
| Ponta a ponta | Playwright com build de produção e o modelo simulado, conferindo no ticket-service o que foi gravado, e o Haiku 5.5 de verdade em rodadas medidas. |

## Testes

| Suíte | Antes | Depois |
|---|---|---|
| Unidade e integração (Vitest) | 310 | 451 |
| Navegador (Playwright) | 28 | 39 |

Todas passam, e os tipos fecham nos quatro pacotes. Por pacote: shared 130, ticket-service 71, agent 82, web 168.

## Fidelidade ao design

Referência: a tela "Chat — Novo chamado (desktop)" do nexo.pen, renderizada pelo próprio pen.dev num Chromium local a 100%, 1440 × 900. O app foi fotografado no mesmo tamanho, com a mesma conversa do design (textos, rascunho D-381, prazo 13:43 e o contador 18/30).

| Medição | Resultado |
|---|---|
| Linhas horizontais das caixas (bolhas, card, divisórias), pelo centro de cada linha | 19 de 19 a até 0,55 px |
| Posição de cada linha de texto, pelo centro da tinta | 17 de 17 a até 0,47 px (mediana 0,03 px) |
| Bordas verticais das bolhas, das respostas rápidas e do card | 21 de 21 a até 0,5 px |
| Pixels diferentes na área da feature 4 | 3,04% cru, 0,75% depois de um desfoque de 1 px |

Os 0,5 px que sobram vêm do design: o Pencil põe as caixas em meio pixel (as bolhas têm 1,5 × 14,5 px por linha), e o navegador as alinha ao pixel inteiro.

A única diferença real é o chip "⌘↵" do Confirmar: o Pencil desenha esses dois símbolos com uma fonte Noto que ele carrega, e o Chrome usa a do sistema. O chip fica 5,5 px mais largo e Editar e Cancelar andam 4 px. Carregar a fonte Noto inteira por dois símbolos pesaria mais do que vale, e fora do Mac o chip mostra "Ctrl ↵" de qualquer jeito.

Dois ajustes saíram dessa medição. A linha entre os campos e a barra do card ficava dentro da barra; o Pencil a centra na borda, e o app passou a fazer o mesmo, o que acertou 1 px de toda a conversa acima dela. As bolhas usavam a quebra de linha que evita palavra sozinha na última linha; o Pencil quebra palavra por palavra, e a bolha da Ana descia "VPN" para a segunda linha.

## Modelo real (Claude Haiku 5.5)

Três rodadas de cada fluxo, contra o ticket-service local. Preço por milhão de tokens: entrada US$ 0,10, leitura de cache US$ 0,01, saída US$ 0,50.

| Turno | Tempo (mediana) | Custo (mediana) |
|---|---|---|
| Problema da VPN (central de ajuda, pergunta a versão do Windows) | 4,5 s | US$ 0,0007 |
| "É Windows 11." (consulta os chamados, pergunta quem é afetado) | 4,8 s | US$ 0,0009 |
| "Só eu, reunião às 14h" (rascunho INC, Rede e VPN, Alta) | 6,0 s | US$ 0,0015 |
| Consulta do INC-20311 | 4,0 s | US$ 0,0006 |
| "Adicionar informação" | 3,1 s | US$ 0,0008 |
| A informação nova (complemento do INC-20311) | 3,5 s | US$ 0,0010 |
| "A senha do SAP bloqueou de novo" (reabertura do INC-20150) | 5,7 s | US$ 0,0017 |

Abrir um chamado do começo ao fim custa cerca de US$ 0,003; complementar, US$ 0,002. Nas 9 rodadas de abrir e complementar, o Haiku classificou certo todas as vezes, consultou os chamados antes de abrir e escreveu descrições que o analista pode usar sem perguntar de novo, como "Notebook com Windows 11 não conecta na VPN desde ontem. Aparece o erro 809. O artigo de reinstalação do cliente de VPN (kb-vpn-809) vale só para Windows 10, então não foi aplicado. Afeta só o usuário. Há reunião com cliente hoje às 14h que depende da VPN."

## Rotas novas do ticket-service

| Rota | p50 | p95 |
|---|---|---|
| `GET /employees/emp-ana/tickets/candidates?category=access` | 0,52 ms | 0,81 ms |
| `PATCH /tickets/INC-20311` (complemento) | 1,13 ms | 1,44 ms |
| `PATCH /tickets/INC-20311` (repetição com a mesma chave) | 0,39 ms | 0,51 ms |
| `POST /tickets/INC-20150/reopen` (repetição com a mesma chave) | 0,33 ms | 0,51 ms |

300 chamadas seguidas de cada, no local.

## Considerações

- A medição com o modelo real mudou o desenho duas vezes. "A senha do SAP bloqueou de novo" virava um chamado novo, porque o Haiku só via os abertos; a lista de chamados passou a trazer à parte os resolvidos há até 7 dias, e a checagem de duplicidade passou a considerar esses também. Nas três rodadas seguintes, a reabertura saiu no primeiro turno. Numa rodada, o Haiku mostrou "Confirmar / Cancelar" como respostas rápidas abaixo do rascunho; agora a resposta perde as ofertas depois que um rascunho aparece.
- A revisão independente achou casos em que o chamado existia e o card dizia o contrário: o serviço grava e cai antes de responder, e o funcionário cancela; ou um cancelamento chega enquanto a confirmação espera o serviço. O rascunho agora passa a "confirmando" antes de chamar o serviço e só aceita confirmar de novo, o que não duplica nada. A revisão também achou uma repetição de reabertura que virava recusa; a chave passou a ser conferida dentro da transação. As outras correções: a nota de sistema sai no mesmo batch do novo estado, mudar a categoria no card passa pela checagem de duplicidade, e os rascunhos de uma resposta que falhou são descartados. Cada uma tem teste.
- Na revisão de segurança automática, a chave de idempotência reusada por outro funcionário devolveria o chamado de quem a usou primeiro. O escopo da chave passou a nomear o funcionário.
- Os estados que o design não desenha (editando, confirmando, criado, descartado, substituído, recusado) foram decididos com o design-engineer. Todos mantêm o card do design e trocam só o estado do topo e a barra de baixo.
- O complemento entra como atualização do funcionário e não muda o prazo nem a "última atualização", que contam as respostas da TI. A reabertura recomeça o prazo, como uma nova abertura; ARQUITETURA.md registra que um recálculo futuro precisa partir dela.
- Ficam de fora: transferir para um analista (feature 5, "Falar com um analista" continua com a resposta franca) e reclassificar a prioridade de um chamado complementado ou reaberto.

## Provas visuais

- [design-x-app-mesmos-dados.png](provas/design-x-app-mesmos-dados.png): design em cima, app embaixo, mesmos dados.
- [zoom-card-design-x-app.png](provas/zoom-card-design-x-app.png): o card ampliado 2×, design e app.
- [diferenca-pixel-a-pixel.png](provas/diferenca-pixel-a-pixel.png): onde os pixels diferem depois do desfoque.
- [rascunho-aguardando.png](provas/rascunho-aguardando.png), [rascunho-editando.png](provas/rascunho-editando.png) e [rascunho-criado.png](provas/rascunho-criado.png): abrir um chamado.
- [complemento-aguardando.png](provas/complemento-aguardando.png) e [complemento-descartado.png](provas/complemento-descartado.png): complementar e descartar.
- [reabertura-aguardando.png](provas/reabertura-aguardando.png), [reabertura-servico-fora.png](provas/reabertura-servico-fora.png) e [reabertura-confirmada.png](provas/reabertura-confirmada.png): reabrir com o serviço fora do ar e de volta.
- [rascunho-substituido.png](provas/rascunho-substituido.png) e [rascunho-novo-depois-do-substituido.png](provas/rascunho-novo-depois-do-substituido.png): dois rascunhos seguidos.
- [celular-rascunho.png](provas/celular-rascunho.png): 375 px.
