# Feature 3: relatório de entrega

O plano está em [plano.md](plano.md). Este arquivo junta o que foi pedido, a prova de cada item e as medições, todas feitas em 29/10/2026.

## O que foi pedido e a prova de cada item

| Pedido | Prova |
|---|---|
| Front e back | Ticket-service com `GET /employees/:id/tickets` e `GET /tickets/:id`, contratos em `packages/shared`, quatro ferramentas no agent (`listMyTickets`, `getTicket`, `offerTicketChoice`, `offerReplies`), lista selecionável, card do chamado e respostas rápidas no chat. |
| Fiel ao design | Medições abaixo, com a conversa do design gravada com os mesmos dados. Imagens em [provas/](provas/). |
| Lógica do back | O funcionário vem só da sessão e o Mastra confere o contexto antes de a ferramenta rodar. Chamado de outra pessoa responde o mesmo 404 de um que não existe, e as atualizações dele também nunca saem do banco. A lista mostra só chamados do funcionário, buscados de novo no serviço. Uma oferta que não aparece deixa o modelo explicar. |
| Desempenho | Índices em `tickets (opened_by, created_at)` e `ticket_updates (ticket_id, created_at)`, com um teste que confere o plano da consulta. O detalhe sai numa ida ao banco. As ofertas encerram a resposta, o que economiza uma chamada ao modelo. |
| Padrão do contrato | Os schemas Zod de `packages/shared` servem ao serviço, ao agent e à tela. As respostas salvas são conferidas contra eles quando a conversa é recarregada. |
| Testes primeiro | Cada camada começou por um teste que falhou pelo motivo certo. |
| Ponta a ponta | Playwright com build de produção e o modelo simulado, e o Haiku 5.5 de verdade em rodadas medidas. |

## Testes

| Suíte | Antes | Depois |
|---|---|---|
| Unidade e integração (Vitest) | 213 | 308 |
| Navegador (Playwright) | 22 | 28 |

Todas passam, e os tipos fecham nos quatro pacotes.

## Fidelidade ao design

Referência: o PNG que o Pencil exporta da tela "Chat — Consulta e transferência", 1440 × 900. O app foi fotografado no mesmo tamanho, com a mesma conversa do design (títulos, datas e o contador 16/30).

| Medição | Resultado |
|---|---|
| Bordas das caixas, em quatro colunas | 64 de 64 a até 1 px |
| Posição da tinta de cada linha de texto | 38 de 38 a até 1 px |
| Quantidade de tinta por linha, app contra design | +0,7% na mediana (a feature 2, que não mudou, dá +0,2%) |
| Pixels diferentes na área da feature 3 | 3,78% cru, 0,71% depois de um desfoque de 1 px |

Os pixels que sobram não somem: dois programas diferentes nunca desenham o mesmo texto com os mesmos tons nas bordas das letras. Para medir esse piso, foram usadas três peças que a feature 2 provou idênticas ao HTML do próprio design no Chrome (caminho da página, "Assistente online" e contador). Contra o PNG do Pencil, elas têm de 0,99 a 1,48 pixel diferente por pixel de texto. A lista, o card e a bolha com as respostas rápidas têm de 0,53 a 0,99, no piso ou abaixo dele.

O teste decisivo usa o próprio código do design. O HTML que o Pencil exporta para essas peças foi desenhado no mesmo Chrome, por cima das peças do app, com os dois defeitos conhecidos da exportação corrigidos (larguras fixas que estouram o padding e a altura de linha). Comparado com o PNG do design, o HTML do Pencil fica mais longe dele do que o app:

| Peça | App contra o PNG do design | HTML do Pencil no Chrome contra o PNG do design |
|---|---|---|
| Lista selecionável | 5,24% | 7,98% |
| Card do chamado | 3,46% | 4,38% |
| Bolha com as respostas rápidas | 5,21% | 5,78% |

Nenhum código desenhado no Chrome chega a zero contra o PNG do Pencil, nem o que o próprio Pencil gera. O app chega mais perto do que ele.

## Modelo real (Claude Haiku 5.5)

| Turno | Tempo | Custo |
|---|---|---|
| "Qual o status do meu chamado?" (lista) | 2,9 a 3,3 s | US$ 0,0005 |
| Escolher o chamado (card e oferta) | 4,0 a 4,5 s | US$ 0,0009 |

As instruções e as ferramentas somam 3,5 mil tokens em cache, lidos a 10% do preço. Em 12 rodadas, o modelo seguiu a regra em todas: lista com a pergunta, card com a oferta quando vencido, o chamado do notebook achado sem número e o chamado de outra pessoa recusado.

## Rotas novas do ticket-service

| Rota | p50 | p95 |
|---|---|---|
| `GET /employees/emp-ana/tickets?status=open` | 0,57 ms | 1,19 ms |
| `GET /tickets/INC-20311?employeeId=emp-ana` | 0,61 ms | 0,98 ms |

300 chamadas seguidas de cada, no local.

## Considerações

- A medição com o modelo real mudou o desenho: o Haiku às vezes chamava a oferta sem escrever a pergunta. A pergunta passou a ser um campo obrigatório das duas ofertas, e a tela a desenha.
- A revisão independente achou dois problemas, corrigidos com teste: uma oferta que falhava deixava a resposta vazia, e o modelo simulado mandava "INC-20298 · Acesso à pasta Financeiro…" para o canal do financeiro.
- Testando na tela, a resposta a "Falar com um analista" saiu duplicada: o Haiku escrevia a resposta e anotava o caso na memória no mesmo passo, e chamado de novo repetia o texto. Um passo com texto e só a memória anotada agora encerra a resposta.
- O chamado do SharePoint virou INC-20298, o número que o design mostra no chat e no console. O seed e a arquitetura diziam INC-20288.
- "Falar com um analista" e "Adicionar informação" respondem com franqueza que o chat ainda não faz isso e indicam o ramal 4000. As features 5 e 4 trocam essa resposta pela ação.
- A lista usa o título completo do chamado (Anexo B). O design mostra um título encurtado.

## Provas visuais

- [design-x-app-mesmos-dados.png](provas/design-x-app-mesmos-dados.png): design em cima, app embaixo, mesmos dados.
- [design-x-app.png](provas/design-x-app.png): o mesmo com os dados de exemplo do app.
- [zoom-card-opcoes.png](provas/zoom-card-opcoes.png): card e respostas rápidas ampliados 2×.
- [diferenca-pixel-a-pixel.png](provas/diferenca-pixel-a-pixel.png): onde os pixels diferem depois do desfoque.
- [no-prazo.png](provas/no-prazo.png), [chamado-de-outra-pessoa.png](provas/chamado-de-outra-pessoa.png) e [depois-de-recarregar.png](provas/depois-de-recarregar.png): estados que o design não desenha.
- [celular-lista.png](provas/celular-lista.png) e [celular-card.png](provas/celular-card.png): 375 px.
