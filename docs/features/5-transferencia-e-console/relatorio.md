# Feature 5: relatório de entrega

O plano está em [plano.md](plano.md). Este arquivo junta o que foi pedido, a prova de cada item e as medições, feitas em 31/10/2026.

## O que foi pedido e a prova de cada item

| Pedido | Prova |
|---|---|
| Front e back | Ticket-service com `GET /employees?ids=` e `?q=`, `PATCH /analysts/:id`, `POST /tickets/:id/transfer` e `POST /tickets/:id/assign`; a ferramenta `transferToAnalyst` e a transferência forçada no agent; as rotas do console da seção 7 mais `POST .../read` e a presença do chat; a tela do console inteira e os estados do chat da funcionária depois da transferência. |
| Fiel ao design | As duas telas do console ("Atendente — Conversas" e "Atendimento assumido") medidas contra o nexo.pen com os mesmos dados. Números abaixo, imagens em [provas/](provas/). |
| Lógica do back | N1 ou N2, a espera e "crítico" ou "vencido" saem do código, do chamado ou do RN-01, nunca do modelo. Cada mudança de estado é um `UPDATE` condicional com a nota no mesmo batch, gravada só se o `UPDATE` mudou a linha. Assumir, devolver, encerrar e escrever são idempotentes. Funcionário nunca lê o console nem a conversa de outra pessoa. |
| Desempenho | A lista sai numa ida ao banco, com os números dos filtros, pelo índice da última atividade (um gatilho no banco a mantém). Nomes vêm do ticket-service em lote, com cache. Medições abaixo. |
| Padrão do contrato | Schemas Zod novos em `packages/shared` (`transfer.ts`, `console.ts`, a ferramenta e as partes `note` e `analyst` do chat) servem ao serviço, ao agent, às rotas e às telas. |
| Testes primeiro | Regras, rotas, ferramenta, banco, tela e cada correção da revisão começaram por um teste que falhou pelo motivo certo. |
| Ponta a ponta | Playwright com build de produção e o modelo simulado, com duas pessoas ao mesmo tempo (Ana e Rafael), e o Haiku 5.5 de verdade em rodadas medidas. |

## Regras, como ficaram

| Regra | Onde |
|---|---|
| Crítico ou vencido vai para o N2 (crítico vem antes); pedido do funcionário e dúvida do agent, para o N1. Sem chamado, a prioridade sai do impacto que o modelo leu (RN-01) e, sem ele, é Média | `routeTransfer`, `packages/shared/src/transfer.ts` |
| A espera é o prazo da prioridade contado da transferência | `routeTransfer` |
| Confiança abaixo de 0,6 obriga o passo seguinte a transferir, com o motivo "dúvida do agent" fixado pelo código; a confiança vai junto com a transferência, numa gravação só | `prepareStep` e `transferToAnalyst`, em `packages/agent/src` |
| Uma transferência por resposta: pedida duas vezes no mesmo passo, a segunda recebe a resposta da primeira; uma chamada recusada (chamado que não é dela) pode ser corrigida | `transferToAnalyst` |
| Com a conversa pausada, a mensagem dela é gravada, contada e copiada para a memória; o LLM não é chamado | `POST /api/chat` |
| Quem pode transferir, assumir, devolver e encerrar, e de onde: cada regra escrita uma vez, testada sem banco; o `UPDATE` só escreve sobre a versão que leu, e quem perde a corrida decide de novo sobre a linha que ganhou; uma mensagem do analista também só entra na versão em que foi decidida | `apps/web/lib/server/conversation-moves.ts` |
| Assumir pausa o agent e põe o chamado ligado em atendimento; o chamado lido é o que o `UPDATE` deixou, mesmo que o agent tenha transferido no meio | `assumeHandler` |
| Não lidas: as mensagens dela depois do mais recente entre a última leitura daquele analista e o momento em que a conversa passou a precisar de um analista desta vez (a mensagem dela que levou à transferência, gravada com ela) | `lib/server/console/rows.ts` |
| A resposta do agent fica logo depois da mensagem que ela respondeu; o que o turno fez (a nota da transferência) vem depois dela | `replyPlace` e `afterReplyPlace`, em `lib/server/messages.ts` |

## Testes

| Suíte | Antes | Depois |
|---|---|---|
| Unidade e integração (Vitest) | 484 | 654 |
| Navegador (Playwright) | 42 | 52 |

Todas passam, e os tipos fecham nos quatro pacotes. Por pacote: shared 195, ticket-service 89, agent 102, web 268.

O arquivo [transfer-and-console.spec.ts](../../../apps/web/e2e/transfer-and-console.spec.ts) roda as histórias com dois navegadores, como duas pessoas: Ana pede um analista sobre o chamado vencido; Rafael a acha em "Para você", abre o histórico e os chamados dela, assume; os dois conversam sem o agent; ele devolve, o agent volta a responder; ele assume de novo e encerra; o Disponível liga e desliga e sobrevive a um recarregamento; um funcionário não entra no console; e, num celular, a conversa abre sobre a lista e os chamados só quando pedidos.

Dois testes antigos mudaram por causa do comportamento novo, não por defeito: o de quebra de linha da feature 4 usava a Carla, cuja conversa espera um analista nos dados de exemplo, e passou a usar o Bruno; e o do chat procurava o selo do topo como região viva, que agora não é (o chat anuncia as mudanças uma vez só).

### A revisão independente

Uma revisão de código separada achou seis defeitos. Cada um ganhou um teste que falhou antes da correção:

| Defeito | Correção |
|---|---|
| Com a conversa pausada, uma mensagem que falhou sumia na leitura seguinte, e "Não enviada" ia para a mensagem anterior | a leitura mantém no fim a mensagem que não chegou ao servidor (`withSaved`) |
| Assumir lia o chamado antes do `UPDATE`: se o agent transferisse no meio, o chamado não ia para "Em atendimento" | o assumir usa a linha que o `UPDATE` devolveu |
| A nota da transferência pulava para depois de um "assumiu" feito durante a resposta | só se move enquanto a conversa espera |
| A volta da aba podia abrir uma segunda leitura periódica, e outra a cada troca de aba | um agendador que nunca roda duas vezes ao mesmo tempo (`createPoller`) |
| Uma leitura antiga podia desenhar por cima do resultado de assumir ou de uma mensagem enviada | só vale a resposta mais nova (`latestOnly`) |
| Depois de uma segunda transferência, quem leu a primeira via as não lidas desde então | conta do mais recente entre a leitura e o novo começo |

Uma segunda revisão, de estrutura, reprovou o PR e foi atendida antes do merge. As regras de cada movimento da conversa estavam escritas duas vezes, uma em JS e outra no SQL, em três handlers e na transferência; agora ficam em `conversation-moves.ts`. A transferência era gravada em duas fases, com a nota redatada depois; agora vai numa gravação só. As notas viraram um tipo por evento, sem campos vazios. A leitura das mensagens ficou num lugar só, `messages.ts`. O chat recebe a conversa inteira no stream. E os hooks repetidos entre o chat e o console (relógio, leitura periódica e rolagem) ficaram em `lib/`. Uma terceira passada deu à conversa uma versão, que cada movimento avança, e guardou desde quando ela precisa de um analista; com isso o cálculo das não lidas perdeu duas subconsultas. A regra de quem pode escrever passou a ser a mesma de quem pode encerrar, e o chat ficou com uma leitura só da conversa.

## Fidelidade ao design

Referência: as duas telas do nexo.pen exportadas pelo próprio pen.dev, a 100%. O app foi fotografado no mesmo tamanho (1440 × 900 e, para o assumido, 1567 × 900, a largura do quadro), com os mesmos textos, horários, chamados e o relógio do navegador parado às 10:13 do dia do design.

| Medição | Resultado |
|---|---|
| Bordas de cima e de baixo de cada bolha, conversa esperando | 28 de 28 a até 0,2 px (mediana 0) |
| Bordas de cada bolha, conversa assumida (1567 px) | 18 de 18 a até 0,58 px |
| Fios entre os chamados do painel, nas duas telas | 6 de 6 a até 0,5 px |
| Linhas de texto da conversa, pelo centro da tinta | 20 de 21 e 26 de 27 a até 1 px (mediana 0,69) |
| Linhas de texto do painel | 17 de 18 e 18 de 19 a até 1,08 px |
| Botões da barra de assumir, borda a borda | idênticos ao design, à esquerda e à direita |
| Pixels diferentes depois de um desfoque de 1 px | conversa 1,73%, painel 1,90%, topo da lista 1,64%, trilho 0,65% |

A linha de texto que fica fora, nas duas conversas, é um pixel solto do "ç" de "atualização" que a medição separa da linha dele. Os fios que pareciam a 2 px estão a meio pixel: o nexo.pen os desenha em meio pixel, espalhados em duas fileiras com metade da cor, e o navegador os põe num pixel inteiro. Os pixels que ainda diferem são o contorno das letras, que o Pencil e o Chrome suavizam de jeitos diferentes, mais os dados que diferem de propósito (o filtro "Todas" marcado e a linha da Ana já lida). As linhas da lista, comparadas pessoa a pessoa, diferem de 0,03% a 1,06%; só a da Ana difere mais, porque no app ela já foi lida ao abrir e a prévia mostra a última resposta do Nexo.

Quatro acertos saíram dessa medição. O nexo.pen usa como altura "normal" 1,2 vez o tamanho, arredondada para cima; faltavam os tokens de 10, 11, 12 e 20 px. A etiqueta "IA", virando botão dentro de um `span` comum, dava 20 px à linha do remetente em vez de 16, e eram 4 px por resposta. O painel separa os chamados por 4 px. E o Pencil arredonda para cima a largura do que abraça o texto: os botões, as pílulas e os filtros do console passaram a ter largura em pixel inteiro, como os botões do rascunho da feature 4, e o "Assumir atendimento" deixou de ficar 1 px mais estreito.

A largura das bolhas segue os dois quadros: numa linha enquanto cabe em 520 px; mais longa, a bolha tem 420 px e a hora desce. Um teste no navegador confere as duas.

Ficam diferentes do design, de propósito:
- "Chamados de Ana" em vez de "da Ana": o app não sabe o gênero de ninguém, e "da Diego" seria pior.
- O filtro que abre é "Para você", como o design marca, mas a lista do design mistura conversas que não esperam ninguém; no app ela mostra só o que espera, e as outras ficam em "Todas", da atividade mais recente para a mais antiga.
- O "Hoje" aparece no quadro do assumido, porque toda mudança de dia ganha a pílula; o design a deixou de fora.

## Modelo real (Claude Haiku 5.5)

Três rodadas de cada caminho, contra o ticket-service local, depois dos ajustes. Preço por milhão de tokens: entrada US$ 0,10, leitura de cache US$ 0,01, saída US$ 0,50.

| Turno | Destino nas 3 rodadas | Tempo (mediana) | Custo (mediana) |
|---|---|---|---|
| "Quero falar com um analista, meu Outlook não abre" | N1, pedido, 3 de 3 | 4,1 s | US$ 0,0008 |
| "Como está o INC-20311?" (oferta do analista) | – | 3,7 s | US$ 0,0009 |
| "Falar com um analista" (chamado vencido) | N2, vencido, 3 de 3 | 5,3 s | US$ 0,0015 |
| "O Excel fecha sozinho com macros" | N1, dúvida do agent, 2 de 3; na terceira ele perguntou de onde veio a planilha | 4,6 s | US$ 0,0009 |

O resumo que o analista recebe saiu útil em todas, como "Notebook lento desde a atualização do Windows. Reiniciar e rodar o diagnóstico da central não resolveu. Chamado INC-20311 (prioridade média), sem atualização da TI há 14 dias e vencido. O funcionário pede um analista para dar andamento."

A primeira rodada mudou o código duas vezes. O Haiku às vezes pedia a transferência duas vezes no mesmo passo; agora a segunda recebe a resposta da primeira e nada se repete. E ele dizia à funcionária que "vai ficar em silêncio"; as instruções agora pedem para dizer que ela pode continuar escrevendo, e nenhuma das rodadas seguintes falou em silêncio.

## Desempenho

### Rotas do console no web

Os handlers chamados direto, sem rede, num banco em arquivo com 1.000 conversas e 20.000 mensagens, 300 chamadas de cada:

| Operação | p50 | p95 | Idas ao banco |
|---|---|---|---|
| Lista, Todas (50 de 1.000) | 1,40 ms | 1,74 ms | 1 |
| Lista, Para você | 1,46 ms | 1,69 ms | 1 |
| Lista com busca por nome | 1,35 ms | 1,59 ms | 1 |
| Histórico (20 mensagens) | 0,86 ms | 1,21 ms | 1 |
| Marcar como lida | 0,12 ms | 0,16 ms | 1 |
| Mensagem do analista | 0,79 ms | 1,15 ms | 2 |
| Assumir e devolver, cada um com o histórico de volta | 6,06 ms o par | 7,27 ms | 3 cada |

O plano da consulta da lista é `SCAN conversations USING INDEX conversations_last_activity`: ela lê as 50 primeiras em ordem e para.

### Rotas novas do ticket-service

| Rota | p50 | p95 |
|---|---|---|
| `GET /employees?ids=` (7 pessoas) | 0,48 ms | 0,76 ms |
| `GET /employees?q=ana` | 0,37 ms | 0,46 ms |
| `PATCH /analysts/:id` | 0,67 ms | 1,02 ms |
| `POST /tickets/:id/transfer` | 1,03 ms | 1,30 ms |
| `POST /tickets/:id/transfer` (mesma chave) | 0,34 ms | 0,48 ms |
| `POST /tickets/:id/assign` | 0,88 ms | 1,04 ms |

Com 20 chamadas simultâneas, sem nenhum erro: `GET /employees?ids=` 5.013 req/s (p95 7,2 ms), `transfer` 1.163 req/s (p95 30,5 ms), `assign` 1.455 req/s (p95 24,9 ms).

### Peso no navegador

| Tela | main | feature 5 |
|---|---|---|
| Atendimento (Ana), JS baixado ao entrar | 76,4 KB comprimido | 86,8 KB |
| Console (Rafael), JS baixado ao entrar | 6,6 KB (a tela vazia) | 25,4 KB |

O console inteiro custa 19 KB comprimidos; o chat ganhou 10 KB com a mensagem do analista, a espera e a leitura periódica. Os ícones do console são os contornos do nexo.pen em SVG, como os da feature 4.

## Considerações

- A transferência não espera o ticket-service: se ele cair, a conversa vai para o analista do mesmo jeito e a marca no chamado fica no log. Uma falha na leitura do chamado faz a transferência seguir sem ele, pelo motivo pedido; a funcionária não fica presa a uma queda do legado.
- O console lê a cada 3 s, como a arquitetura pede; o chat dela também, enquanto um analista tem a conversa, e a cada 15 s com a aba escondida, para o título da aba contar o que o analista escreveu. Com o agent, o chat não lê: ele avisa a cada 20 s que está aberto, e a resposta já diz se um analista pegou a conversa.
- "Online" e "digitando…" são reais: o chat avisa quando abre, a cada 20 s e quando ela começa ou para de digitar.
- Os estados do chat que o design não desenha (esperando, analista na conversa, devolvida, encerrada) foram decididos com o design-engineer: a nota centrada do console, o selo do topo dizendo quem responde agora, a linha de espera acima do campo com a hora prometida (e o ramal 4000 quando ela passa) e a bolha verde do analista com o nível.
- Ficam de fora, como o plano diz: a tela de nova conversa depois de encerrar e o limite de 30 (feature 6); a resposta do analista contar como resposta da TI no prazo do chamado; e a busca e o menu ⋮ do cabeçalho, que no app levam à busca da lista e a mostrar ou esconder os chamados.

## Provas visuais

- [design-x-app-esperando.png](provas/design-x-app-esperando.png) e [design-x-app-assumido.png](provas/design-x-app-assumido.png): design em cima, app embaixo, mesmos dados.
- [conversa-design-x-app.png](provas/conversa-design-x-app.png), [painel-design-x-app.png](provas/painel-design-x-app.png) e [lista-linhas-design-x-app.png](provas/lista-linhas-design-x-app.png): lado a lado por região, e cada linha da lista pela pessoa.
- [diferenca-pixel-a-pixel-conversa.png](provas/diferenca-pixel-a-pixel-conversa.png): onde os pixels diferem depois do desfoque.
- [chat-1-aguardando-analista.png](provas/chat-1-aguardando-analista.png), [chat-2-analista-respondendo.png](provas/chat-2-analista-respondendo.png) e [chat-3-atendimento-encerrado.png](provas/chat-3-atendimento-encerrado.png): a Ana no fluxo real.
- [console-1-para-voce.png](provas/console-1-para-voce.png) a [console-6-ver-todos.png](provas/console-6-ver-todos.png): o Rafael no mesmo fluxo, incluindo a decisão do agent aberta pela etiqueta "IA".
- [celular-chat-aguardando.png](provas/celular-chat-aguardando.png), [celular-console-lista.png](provas/celular-console-lista.png) e [celular-console-conversa.png](provas/celular-console-conversa.png): 375 px.
