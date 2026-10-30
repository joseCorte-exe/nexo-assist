# Feature 4: relatório de entrega

O plano está em [plano.md](plano.md). Este arquivo junta o que foi pedido, a prova de cada item e as medições, feitas entre 29 e 30/10/2026.

## O que foi pedido e a prova de cada item

| Pedido | Prova |
|---|---|
| Front e back | Ticket-service com `GET /employees/:id/tickets/candidates`, `PATCH /tickets/:id` e `POST /tickets/:id/reopen`; contratos do rascunho em `packages/shared`; a ferramenta `draftTicket` no agent; as rotas `PATCH /api/drafts/:id`, `POST /api/drafts/:id/confirm` e `POST /api/drafts/:id/cancel` no web; o card do rascunho em todos os estados. |
| Fiel ao design | Medições abaixo, com a conversa do design gravada com os mesmos dados. Imagens em [provas/](provas/). |
| Lógica do back | Nada é criado sem o clique em Confirmar, e a confirmação não passa pelo modelo. Tipo e prioridade (RN-01), prazo (RN-02), duplicidade e a janela de 7 dias ficam no código. As três escritas são idempotentes, com a chave amarrada à rota, ao chamado e ao funcionário. O rascunho de outra pessoa responde o mesmo 404 de um que não existe. |
| Desempenho | A conversa e os rascunhos saem numa ida ao banco; um rascunho novo substitui o anterior e ganha número num batch só; um teste fixa quantas idas ao banco cada ação faz (salvar uma, editar e cancelar duas, confirmar três). As rotas novas usam o índice de `(opened_by, created_at)`, com teste do plano da consulta. A lista de chamados traz abertos e reabríveis numa chamada. Medições abaixo. |
| Padrão do contrato | Os schemas Zod de `packages/shared` servem ao serviço, ao agent, às rotas e à tela. Uma entrada que o Mastra recusa é gravada como erro da ferramenta, e a resposta continua válida ao recarregar. |
| Testes primeiro | Regras, rotas, ferramenta, banco e cada correção da revisão começaram por um teste que falhou pelo motivo certo. Algumas correções do simulado e do card vieram antes do teste, no meio da medição. Para essas, cada correção foi tirada do código e o teste dela falhou pelo motivo certo (tabela abaixo); quatro ajustes do card não tinham teste e ganharam um. |
| Ponta a ponta | Playwright com build de produção e o modelo simulado, conferindo no ticket-service o que foi gravado, e o Haiku 5.5 de verdade em rodadas medidas. |

## Testes

| Suíte | Antes | Depois |
|---|---|---|
| Unidade e integração (Vitest) | 310 | 460 |
| Navegador (Playwright) | 28 | 42 |

Todas passam, e os tipos fecham nos quatro pacotes. Por pacote: shared 133, ticket-service 72, agent 82, web 173.

### Cada teste pega a sua correção

Para as correções feitas antes do teste, a correção foi tirada do código e o teste rodou sem ela. Todos falharam pelo motivo que a correção resolve, e passaram com ela de volta.

| Correção | Sem ela, o teste diz |
|---|---|
| O simulado não oferece abrir chamado quando os serviços não responderam | 2 testes do simulado falham: oferece o chamado; e trata como afetados uma mensagem que é outro assunto |
| O simulado explica a prioridade pelo que foi respondido | "something stopped for the team is critical" falha |
| A resposta perde as respostas rápidas depois do rascunho | "takes the offers away once the draft is shown" falha |
| A lista e os candidatos trazem os resolvidos há até 7 dias | 1 teste do ticket-service e 4 do agent falham |
| O contrato da lista guarda os resolvidos (teste novo) | o Zod descartava o campo em silêncio: `recentlyResolved` some da resposta |
| A barra do card tem 52 px, com a linha centrada na borda (teste novo) | a barra mede 53 px |
| O estado do card ocupa pixels inteiros (teste novo) | "Aguardando confirmação" mede 161,125 px |
| O erro da confirmação fica acima da barra (teste novo) | o erro termina em 799 px, abaixo do botão, que começa em 710 px |
| A bolha quebra palavra por palavra, como o Pencil (teste novo) | as linhas começam em "da" e "reiniciei" em vez de "empresa" e "tudo." |
| O chip ⌘↵ desenhado com os contornos da Noto | o chip mede 32,25 px de largura em vez de 28 |

## Fidelidade ao design

Referência: a tela "Chat — Novo chamado (desktop)" do nexo.pen, renderizada pelo próprio pen.dev num Chromium local a 100%, 1440 × 900. O app foi fotografado no mesmo tamanho, com a mesma conversa do design (textos, rascunho D-381, prazo 13:43 e o contador 18/30).

| Medição | Resultado |
|---|---|
| Linhas horizontais das caixas (bolhas, card, divisórias), pelo centro de cada linha | 19 de 19 a até 0,55 px |
| Posição de cada linha de texto, pelo centro da tinta | 17 de 17 a até 0,47 px (mediana 0,03 px) |
| Bordas verticais das bolhas, das respostas rápidas e do card | 21 de 21 a até 0,5 px |
| Botões Confirmar (442 a 563 px) e Editar (575 a 634 px) | idênticos ao design, borda a borda |
| Pixels diferentes na área da feature 4 | 0,56% depois de um desfoque de 1 px |

Os 0,5 px que sobram vêm do design: o Pencil põe as caixas em meio pixel (as bolhas têm 1,5 × 14,5 px por linha), e o navegador as alinha ao pixel inteiro.

O chip "⌘↵" do Confirmar ficava 5,5 px mais largo: o Pencil desenha os dois símbolos com a Noto, e o Chrome usava a fonte do sistema. Em vez de carregar a fonte inteira (431 KB) por dois símbolos, o app desenha os dois contornos da Noto em SVG, com o mesmo avanço. O chip ficou com 28 × 16 px, como no design, e um teste no navegador confere esse tamanho no Mac. Fora do Mac ele mostra "Ctrl ↵".

Outros dois ajustes saíram dessa medição. A linha entre os campos e a barra do card ficava dentro da barra; o Pencil a centra na borda, e o app passou a fazer o mesmo, o que acertou 1 px de toda a conversa acima dela. As bolhas usavam a quebra de linha que evita palavra sozinha na última linha; o Pencil quebra palavra por palavra, e a bolha da Ana descia "VPN" para a segunda linha.

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

Com carga, 20 chamadas simultâneas contra o banco em arquivo, sem nenhum erro:

| Rota | Vazão | p95 |
|---|---|---|
| `GET .../tickets/candidates` | 2.933 req/s | 11,9 ms |
| `PATCH /tickets/:id` (complemento) | 1.121 req/s | 30,9 ms |
| `POST /tickets` (criar) | 978 req/s | 34,4 ms |

## Rotas do rascunho no web

Os handlers chamados direto, sem rede, com o banco em arquivo (p50 / p95):

| Operação | p50 | p95 |
|---|---|---|
| Gravar um rascunho (substitui o anterior e numera) | 0,26 ms | 0,41 ms |
| Carregar a conversa (30 mensagens, 320 rascunhos) | 4,03 ms | 4,57 ms |
| Editar | 0,86 ms | 1,24 ms |
| Cancelar | 0,86 ms | 1,32 ms |
| Confirmar (sem contar o ticket-service) | 1,04 ms | 1,78 ms |

## Peso no navegador

O JavaScript que a tela de Atendimento baixa, medido na build de produção da main e na desta branch, logada como a Ana:

| Build | Comprimido | Descomprimido |
|---|---|---|
| main | 72,0 KB | 847,4 KB |
| feature 4 | 76,7 KB | 868,3 KB |

O card, o editor e os dois símbolos do chip somam 4,7 KB comprimidos.

## Considerações

- A medição com o modelo real mudou o desenho duas vezes. "A senha do SAP bloqueou de novo" virava um chamado novo, porque o Haiku só via os abertos; a lista de chamados passou a trazer à parte os resolvidos há até 7 dias, e a checagem de duplicidade passou a considerar esses também. Nas três rodadas seguintes, a reabertura saiu no primeiro turno. Numa rodada, o Haiku mostrou "Confirmar / Cancelar" como respostas rápidas abaixo do rascunho; agora a resposta perde as ofertas depois que um rascunho aparece.
- A revisão independente achou casos em que o chamado existia e o card dizia o contrário: o serviço grava e cai antes de responder, e o funcionário cancela; ou um cancelamento chega enquanto a confirmação espera o serviço. O rascunho agora passa a "confirmando" antes de chamar o serviço e só aceita confirmar de novo, o que não duplica nada. A revisão também achou uma repetição de reabertura que virava recusa; a chave passou a ser conferida dentro da transação. As outras correções: a nota de sistema sai no mesmo batch do novo estado, mudar a categoria no card passa pela checagem de duplicidade, e os rascunhos de uma resposta que falhou são descartados. A reabertura também passou a gravar quando aconteceu (`reopened_at`), e o prazo de um chamado reaberto conta a partir dela. Os nove achados estão corrigidos no código, cada um com teste.
- Na revisão de segurança automática, a chave de idempotência reusada por outro funcionário devolveria o chamado de quem a usou primeiro. O escopo da chave passou a nomear o funcionário.
- Os estados que o design não desenha (editando, confirmando, criado, descartado, substituído, recusado) foram decididos com o design-engineer. Todos mantêm o card do design e trocam só o estado do topo e a barra de baixo.
- O complemento entra como atualização do funcionário e não muda o prazo nem a "última atualização", que contam as respostas da TI. A reabertura recomeça o prazo, como uma nova abertura, a partir da coluna `reopened_at`.
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
