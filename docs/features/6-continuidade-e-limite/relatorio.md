# Feature 6: relatório de entrega

O plano está em [plano.md](plano.md). Aqui ficam o que foi pedido, a prova de cada item e as medições, feitas em 01/11/2026.

## O que foi pedido e a prova de cada item

| Pedido | Prova |
|---|---|
| Front e back | No back, `applyLimit`, o movimento `reachLimit`, a recusa do devolver depois do limite, a 31ª mensagem que aplica o limite antes, a nota de retomada para o agent e a leitura da última conversa encerrada. Na tela, o contador, a nota do limite, "Nova conversa", as pílulas de dia, o "Devolver ao agent" que some e o resumo do caso no console. |
| Fiel ao design | As 8 telas que o nexo.pen desenha (login, chat vazio, com o agent, esperando, com o analista, e o console na lista, esperando e assumido) ficaram iguais ao `main` pixel a pixel: 0 pixel de diferença, e o `main` já foi medido contra o nexo.pen nas features 3 a 5. Os estados novos, que o nexo.pen não desenha, saem das peças que já existem, decididas com o design-engineer, e as medidas batem com as peças originais. |
| Lógica do back | O que é pendente, o nível, a espera e o resumo saem do código e do que está salvo. O modelo não decide nada no limite. A mudança e a nota vão no mesmo batch, sobre a versão lida. Quem perde a corrida planeja de novo. |
| Desempenho | `applyLimit` lê tudo numa ida ao banco e escreve em outra. A última conversa da pessoa sai de um índice novo, `(employee_id, created_at)`. |
| Padrão do contrato | Tudo novo do contrato fica em `packages/shared`: `continuity.ts`, o motivo `message_limit`, a nota `limit_reached`, `limitReached` na conversa e no console e `messageMeta` com a hora de cada mensagem. Nenhuma rota nova. |
| Testes primeiro | Cada regra, movimento, rota e tela começou por um teste que falhou pelo motivo certo. |
| Ponta a ponta | Playwright com build de produção e o modelo simulado, com duas pessoas ao mesmo tempo, e a suíte antiga inteira rodando junto. |

## Regras, como ficaram

| Regra | Onde |
|---|---|
| A 30ª mensagem é respondida. O limite vale logo depois, no fim da resposta | `chat.ts`, no `onEnd` |
| Pendente é: rascunho esperando confirmação, a última mensagem dela sem resposta, ou o Nexo esperando a dela (respostas rápidas, lista de chamados ou pergunta no texto) | `pendingAtLimit`, `packages/shared/src/continuity.ts` |
| Com algo pendente, vai para o analista pela regra de sempre: crítico ou vencido no N2, o resto no N1 com o motivo "limite de mensagens". O chamado é o do rascunho ou o último que o Nexo consultou; o serviço confirma que é dela | `caseAtLimit`, `routeTransfer` e `applyLimit` |
| Sem nada pendente, a conversa fecha com `limit_reached` | `moves.reachLimit` |
| Com um analista, a conversa fica com ele, ela continua escrevendo sem o modelo, e o analista só pode encerrar | `moves.reachLimit` e `moves.release` |
| Uma nota só por conversa, no mesmo batch da mudança, copiada para a memória do agent | `conversation-moves.ts` |
| A 31ª numa conversa com o agent que bateu o limite sem aplicar (a 30ª ficou sem resposta) aplica o limite antes e segue para onde a conversa foi | `chat.ts`, motivo `limit_due` |
| Se a mensagem anterior é de outro dia em São Paulo, o agent lê antes uma nota "(retomada)" para consultar de novo o que pode ter mudado | `resumeNote` e `rememberResume` |
| Sem conversa ativa, o chat abre a última que terminou, até ela começar outra | `loadConversation` |

## Testes

| Suíte | Antes | Depois |
|---|---|---|
| Unidade e integração (Vitest) | 655 | 712 |
| Navegador (Playwright) | 52 | 56 |

Todas passam e os tipos fecham nos quatro pacotes. Por pacote: shared 217, ticket-service 89, agent 103, web 303.

O arquivo [continuity-and-limit.spec.ts](../../../apps/web/e2e/continuity-and-limit.spec.ts) roda a história com duas pessoas. Gabriela volta a uma conversa de três dias atrás e vê os dois dias em pílulas. Depois, perto do limite, o contador conta o que falta; a 30ª é respondida e, sem nada pendente, a conversa fecha; ela recarrega, vê o fim, clica em "Nova conversa" e recomeça. Elisa abre e vê como a última conversa dela terminou. Escrevendo ali, a tela recomeça limpa. Depois ela bate o limite com uma pergunta aberta, a conversa vai para o N1, e o Rafael vê "Limite de mensagens" na lista, abre o resumo do caso pela nota, assume sem ter "Devolver ao agent", conversa com ela e encerra. O arquivo prepara as cenas de dias e de 29 mensagens direto no banco do teste e apaga o que escreveu ao terminar, para os números do login continuarem os mesmos.

Um teste antigo mudou por causa do comportamento novo: "pedir a conversa sem id" agora devolve a última encerrada em vez de nada.

O e2e achou um defeito antes da entrega: o resumo para o analista só abria pela nota de transferência comum. A nota do limite também abre, como "Resumo do caso".

## Fidelidade

### O que o nexo.pen desenha não mudou

As telas que o nexo.pen desenha foram fotografadas no `main` e nesta branch, com os mesmos dados de exemplo, a 1440 × 900, em builds de produção. Os dígitos viram 0 nas duas, para os horários de um seed rodado em outro minuto não contarem como diferença.

| Tela | Pixels diferentes |
|---|---|
| Login | 0 de 1.296.000 |
| Chat vazio (Ana) | 0 |
| Chat com o agent (Bruno) | 0 |
| Chat esperando o analista (Carla) | 0 |
| Chat com o analista (Fábio) | 0 |
| Console, Para você | 0 |
| Console, conversa esperando (Diego) | 0 |
| Console, conversa assumida (Fábio) | 0 |

A primeira medição achou 106 pixels no contador, em três letras. Eu tinha posto `tabular-nums` e uma transição de cor nele, e passado a desenhá-lo como um texto só; o chat sempre o desenhou em quatro pedaços ("12", "/", "30", " mensagens…"), e o navegador põe as letras de pedaços separados a uma fração de pixel das de um texto inteiro. Os três voltaram como eram. O texto também voltou a ser o do design, "nesta sessão", com "Restam 5 mensagens nesta sessão" nas últimas cinco. Imagens: [main-x-feature6-chat.png](provas/main-x-feature6-chat.png) e [main-x-feature6-console.png](provas/main-x-feature6-console.png).

### Os estados novos

Não existe quadro no nexo.pen para eles, então a medida é contra as peças reutilizadas, na tela real (1440 × 900):

| Peça nova | Peça de origem | Resultado |
|---|---|---|
| Botão "Nova conversa" | chip de sugestão da tela vazia | altura 31 px, raio 8 px, 13,5/17 px peso 500, mesma cor, mesmo contorno |
| Pílula de dia no chat | pílula de dia do console | altura 23 px, 12/15 px peso 500, mesma cor de texto. O fundo muda de propósito: o console a desenha branca sobre o cinza dele; o chat é branco, então ela usa o cinza das pílulas neutras (`bg-desk`) |
| Contador | contador da feature 2 | o mesmo, pixel a pixel, até 24; nas últimas cinco, o texto diz quanto falta no tom de aviso do sistema |
| Nota do limite | nota do console (`SystemNote`) | mesma peça. O ícone segue o que o limite fez: encerrou, transferiu ou ficou com o analista |

No celular, a nota quebra em duas linhas. O "·" fica no fim da linha de cima, nunca abrindo a de baixo; o leitor de tela lê o texto original.

## Desempenho

`applyLimit` chamado direto, num banco em arquivo com 1.000 outras conversas e 20.000 mensagens, 300 vezes cada caminho:

| Operação | p50 | p95 | Idas ao banco |
|---|---|---|---|
| Limite que encerra | 1,55 ms | 2,91 ms | 2 |
| Limite que transfere | 1,72 ms | 2,85 ms | 2 |
| Limite com o analista | 1,46 ms | 2,83 ms | 2 |
| Abrir o chat (última conversa da pessoa) | 0,52 ms | 1,06 ms | 2 |

O plano da consulta da última conversa é `SEARCH conversations USING INDEX conversations_employee_created (employee_id=?)`. A ordenação ativa primeiro usa uma árvore temporária sobre as poucas conversas daquela pessoa. A ativa é sempre a mais nova, mas a ordenação não depende disso.

JavaScript que cada tela pode carregar, lido dos dois builds de produção (os mesmos arquivos, comprimidos com gzip):

| Tela | main | feature 6 |
|---|---|---|
| Atendimento | 260,2 KB | 261,1 KB |
| Console | 199,9 KB | 200,4 KB |

A medida pela rede variava até 15 KB entre rodadas, por isso ficou a do build. A primeira versão puxava o código do console para o chat por causa do rótulo do dia; ele foi para `format.ts`.

## Considerações

- O modelo real (Haiku 5.5) não foi rodado nesta feature: não há `ANTHROPIC_API_KEY` nesta máquina. O limite não passa pelo modelo. A única coisa nova para ele é a nota "(retomada)", que tem instrução própria e foi testada com o modelo simulado.
- "Pergunta no texto" é a resposta que termina em "?". É uma regra simples e de propósito: na dúvida, a conversa vai para um analista, que é o lado seguro.
- O resumo do caso no limite usa a memória de trabalho do agent. Sem ela, diz por que veio e pede para ler a conversa.
- "Nova conversa" não cria nada no servidor. A conversa nova só nasce na primeira mensagem, então não ficam conversas vazias nos números do login.
- Depois do limite com um analista, ela continua escrevendo sem contar mais nada na tela, porque não há custo de modelo. O banco continua contando.
- A medição pela rede, a do banco e as fotos rodaram com a máquina carregada (outras sessões abertas). Uma rodada do e2e falhou uma vez porque o navegador marcou "Sem conexão" por um instante; repetida, passou.

## Fica de fora

- O teto por IP e o global por dia (seção 9), que são do deploy.
- O desfecho `resolved_by_agent` vindo de uma confirmação dela.

## Provas visuais

- [chat-1-voltou-outro-dia.png](provas/chat-1-voltou-outro-dia.png) e [chat-2-continua-hoje.png](provas/chat-2-continua-hoje.png): Gabriela volta três dias depois; as pílulas aparecem quando a conversa passa a ter dois dias.
- [chat-3-restam-2-mensagens.png](provas/chat-3-restam-2-mensagens.png) e [zoom-contador-restam-2.png](provas/zoom-contador-restam-2.png): o contador no fim.
- [chat-4-limite-encerrou.png](provas/chat-4-limite-encerrou.png) e [chat-5-nova-conversa.png](provas/chat-5-nova-conversa.png): o limite sem nada pendente e o recomeço.
- [chat-6-ultima-conversa-encerrada.png](provas/chat-6-ultima-conversa-encerrada.png): Elisa abre o chat e vê como terminou.
- [chat-7-limite-transferiu.png](provas/chat-7-limite-transferiu.png) e [chat-8-analista-continua.png](provas/chat-8-analista-continua.png): o limite com pergunta aberta, e o Rafael na conversa.
- [console-1-limite-esperando.png](provas/console-1-limite-esperando.png) e [console-2-assumido-so-encerrar.png](provas/console-2-assumido-so-encerrar.png): a lista, o resumo do caso e o assumido só com Encerrar.
- [celular-resta-1.png](provas/celular-resta-1.png) e [celular-limite-encerrou.png](provas/celular-limite-encerrou.png): 375 px.
- [main-x-feature6-chat.png](provas/main-x-feature6-chat.png) e [main-x-feature6-console.png](provas/main-x-feature6-console.png): main, feature 6 e a diferença, toda preta.
