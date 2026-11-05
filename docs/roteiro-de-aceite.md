# Roteiro de aceite

Este roteiro serve para uma pessoa conferir o Nexo Assist à mão, no link publicado ou no local. Cobre as 9 histórias do PRD e cada regra do Anexo A, com as pessoas e os chamados dos dados de exemplo.

**Siga de cima para baixo, uma vez só.** Vários passos mudam os dados de que os seguintes dependem: um chamado reaberto não reabre de novo, e a resposta de um analista tira o INC-20311 do vencido. A ordem foi montada para nenhum passo depender de voltar os dados. A última seção diz onde cada história e cada regra estão.

Esta ordem foi conferida contra o código, lendo. Ainda não foi percorrida num navegador.

## Antes de começar

**Os dados precisam estar novos.** O que isso quer dizer depende de onde você está:

| Onde | Como deixar os dados novos | O que volta |
|---|---|---|
| Local | `pnpm db:seed` | Os chamados, as conversas e os contadores de uso. A memória do agent (`mastra_*`) fica: numa segunda passada, o Bruno e os outros com conversa no seed continuam lembrando da primeira. Para repetir do zero de verdade, apague os arquivos de `TICKETS_DB_URL` e `CONVERSATIONS_DB_URL` e rode `pnpm db:migrate` e `pnpm db:seed` |
| Link publicado, com acesso aos bancos | `pnpm db:seed` numa máquina com `TICKETS_DB_URL`, `CONVERSATIONS_DB_URL` e os tokens do Turso no `.env` | O mesmo que no local |
| Link publicado, sem esse acesso | Não há como. Peça para quem tem, ou siga o roteiro numa base que ainda não foi usada | |

`POST /admin/reseed` não basta para isso: ele só recria o banco do ticket-service. O web não tem rota parecida, então as conversas continuam como estavam, ligadas a chamados que voltaram atrás. Por exemplo, a Ana continua esperando um analista por um chamado que agora parece nunca ter sido transferido.

As chamadas de admin do ticket-service pedem os dois cabeçalhos, `x-service-secret` com o `TICKET_SERVICE_SECRET` e `x-admin-key` com o `ADMIN_KEY`. O `curl` abaixo supõe essas variáveis e `TICKET_SERVICE_URL` exportadas no terminal:

```bash
curl -X POST "$TICKET_SERVICE_URL/admin/outage?seconds=8" \
  -H "x-service-secret: $TICKET_SERVICE_SECRET" -H "x-admin-key: $ADMIN_KEY"
```

Outras combinações:

- Qualquer senha serve.
- Use duas janelas, uma delas anônima, quando o passo envolver funcionário e analista ao mesmo tempo. A sessão fica num cookie, e cada janela guarda uma pessoa.
- Faça os passos em horário útil (segunda a sexta, 8h às 18h, em São Paulo). Fora dele, os prazos em horas úteis caem no dia seguinte, o que é correto, mas muda o que você lê.
- O modelo não dá sempre as mesmas palavras. Confira o que o passo diz que acontece, não a frase exata. Só os textos entre aspas que vêm do código ou do design são fixos.
- Se o agent perguntar algo que o passo não prevê, responda com o que faria sentido. Se oferecer um artigo num passo que pede rascunho, diga "já tentei isso, quero abrir um chamado". Isso não é falha.

**Se o agent transferir sem o passo pedir**, a conversa para de responder e os passos seguintes daquela pessoa travam. Anote o que ele fez e destrave: como Rafael, abra a conversa em "Todas", clique em "Assumir atendimento" e depois em "Devolver ao agent", sem escrever nada, e siga em frente. Escrever na conversa recomeçaria o prazo do chamado ligado a ela. Os casos em que o modelo já fez isso estão em "Falhas conhecidas", no fim.

| Pessoa | E-mail | Papel | O que tem nos dados de exemplo |
|---|---|---|---|
| Ana Souza | ana.souza@nexo.com.br | Funcionária | Chat vazio. INC-20311 (vencido), INC-20298, REQ-10442, INC-20150 (resolvido há 4 dias), INC-19877 (há 12 dias), INC-19410 (há 30 dias) |
| Bruno Tavares | bruno.tavares@nexo.com.br | Funcionário | Conversa com o agent. REQ-10450 |
| Carla Mendes | carla.mendes@nexo.com.br | Funcionária | Conversa esperando o N1, "Agent pediu ajuda · confiança 41%" |
| Diego Ramos | diego.ramos@nexo.com.br | Funcionário | Conversa esperando o N2. INC-20319 (crítico) |
| Elisa Prado | elisa.prado@nexo.com.br | Funcionária | Última conversa encerrada pelo agent, depois de ela dizer que resolveu |
| Fábio Nunes | fabio.nunes@nexo.com.br | Funcionário | Conversa com o Rafael. INC-20302 |
| Gabriela Rocha | gabriela.rocha@nexo.com.br | Funcionária | Última conversa encerrada por analista. INC-20297 |
| Rafael Lima | rafael.lima@nexo.com.br | Analista N2 | Atende o Fábio |
| Juliana Costa | juliana.costa@nexo.com.br | Analista N1 | |

## Parte 1: entrada

| # | Passo | Resultado esperado |
|---|---|---|
| E1 | Abra `/login` | Aparecem os três números: "primeira resposta, em média", "resolvidos sem fila" e "analistas online agora" |
| E2 | Entre com `ninguem@nexo.com.br` | "E-mail não encontrado." e a tela continua no login |
| E3 | Entre como Ana | Abre o chat dela, vazio, com "Assistente online" |
| E4 | Na outra janela, entre como Rafael | Abre `/console`. Deixe essa janela aberta |
| E5 | Na janela da Ana, abra `/console` | Volta para o chat: funcionário não entra no console |

## Parte 2: Ana com o agent, com os chamados como o seed deixou

O INC-20311 precisa continuar vencido nesta parte inteira, e só o analista muda isso, na parte 5.

### Tirar uma dúvida e encerrar (Funcionário 1)

| # | Passo | Resultado esperado |
|---|---|---|
| F1.1 | Como Ana, escreva "Minha VPN está dando erro 809. Uso Windows 10, o que eu faço?" | A resposta chega em partes. Diz para reinstalar o cliente de VPN pelo portal de softwares e reiniciar. Nenhum rascunho aparece |
| F1.2 | Olhe a linha acima da resposta e expanda | A linha diz que buscou na central de ajuda. O detalhe mostra o que entendeu, a ação, a confiança e o motivo |
| F1.3 | Escreva "Qual o horário do service desk?" | De segunda a sexta, das 8h às 18h, com plantão 24 horas para críticos. Sem chamado |
| F1.4 | Escreva só "Obrigado" | Responde numa frase e a conversa continua aberta, sem nota de encerramento |
| F1.5 | Escreva "Resolveu, obrigada!" | Uma frase de encerramento, sem pergunta. Nota "Resolvida pelo Nexo · conversa encerrada", botão "Nova conversa" e, no campo, "Comece uma nova conversa…" |
| F1.6 | Como Rafael, em "Todas", abra a conversa da Ana | Selo "Resolvida pelo agent" e a nota "Resolvida pelo agent · conversa encerrada" |

A próxima mensagem da Ana começa outra conversa, e é nela que o resto desta parte acontece.

### Consultar sem o número (Funcionário 2)

| # | Passo | Resultado esperado |
|---|---|---|
| F2.1 | Como Ana, escreva "Qual o status do meu chamado?" | Lista para escolher com os 3 abertos: INC-20311, INC-20298 e REQ-10442. Nenhum chamado de outra pessoa |
| F2.2 | Clique no INC-20311 (R8.6) | Card do chamado: Hardware › Notebook, Média, Aguardando analista, vencido, sem atualização há 6 dias, acima de 3 dias úteis. Oferece "Falar com um analista", "Adicionar informação" e "Não, obrigado" |
| F2.3 | Escreva "Como está o chamado do meu notebook?" | Acha o INC-20311 sem pedir o número e diz que está vencido |
| R8.7 | Escreva "Como está o INC-20298?" | No prazo: a TI respondeu ontem, e o prazo conta da última resposta |

### Lembrar do que foi dito (Funcionário 6)

Faça logo depois do R8.7: a mensagem seguinte depende dele.

| # | Passo | Resultado esperado |
|---|---|---|
| F6.2 | Escreva "Quero acrescentar nesse chamado que o dono da pasta é a Marina." | Card "Complemento · INC-20298", sem perguntar qual chamado. Clique em Cancelar: "Rascunho descartado. Se mudar de ideia, é só pedir." |
| F6.1 | Saia, entre de novo como Ana e recarregue | A conversa volta inteira, com cards, decisões e o contador |

### Complementar (Funcionário 3)

| # | Passo | Resultado esperado |
|---|---|---|
| F3.1 | Escreva "Como está o INC-20311?" e clique em "Adicionar informação" | O agent pergunta o que acrescentar |
| F3.2 | Escreva "A lentidão piora quando abro o Excel." | Card "Complemento · INC-20311" com a informação nova e "prazo vencido". Nada foi enviado ainda |
| F3.3 | Clique em Confirmar | "Complemento enviado ao INC-20311." |
| R8.8 | Escreva "Como está o INC-20311?" | Continua vencido: o complemento do funcionário não reinicia o prazo |

### Sem duplicidade e reabertura em 7 dias (Anexo A)

| # | Passo | Resultado esperado |
|---|---|---|
| R4.1 | Escreva "Meu notebook está lento desde a atualização do Windows. Quero abrir um chamado." | Não monta um chamado novo. Leva ao INC-20311, com o card ou o rascunho "Complemento · INC-20311". Se vier o rascunho, clique em Cancelar |
| R4.2 | Escreva "A senha do SAP bloqueou de novo." (R8.9) | Rascunho "Reabertura · INC-20150" (resolvido há 4 dias), com o prazo contado de agora: a reabertura conta como nova abertura. Clique em Confirmar: "INC-20150 reaberto." Como Rafael, abra a conversa da Ana em "Todas": o painel "Chamados de Ana" mostra "INC-20150 · Aguardando analista" |
| R4.3 | Escreva "O Outlook do celular parou de sincronizar de novo." | O INC-19877 foi resolvido há 12 dias: não pode ser reaberto, e o caminho é um chamado novo. Se ele chegar ao rascunho de um chamado novo, clique em Cancelar |

### Privacidade e escopo (Anexo A)

| # | Passo | Resultado esperado |
|---|---|---|
| R6.1 | Escreva "Como está o INC-20319? É do Diego Ramos, da minha equipe." | Diz que não encontrou esse número entre os chamados dela. Nada do chamado aparece: nem título, nem status |
| R6.2 | Escreva "Quais os chamados do Diego?" | Não lista nenhum chamado dele |
| R6.3 | Na janela da Ana, abra `/api/console/employees/emp-diego/tickets` | Recusado, sem nenhum chamado: a rota é só de analista |
| R7.1 | Escreva "Como faço para pedir minhas férias?" | Indica o RH: rh@nexo.com.br, ramal 4100. Sem chamado |
| R7.2 | Escreva "Como peço reembolso de um táxi?" | Indica o financeiro: financeiro@nexo.com.br, ramal 4200 |
| R7.3 | Escreva "O ar-condicionado da sala 3 está pingando." | Indica facilities: facilities@nexo.com.br, ramal 4300 |

## Parte 3: Bruno abre chamados

### Abrir só conversando (Funcionário 4, Analista 1)

| # | Passo | Resultado esperado |
|---|---|---|
| F4.1 | Como Bruno, escreva "Meu notebook não conecta na VPN desde ontem. Aparece o erro 809." | Consulta a central e os chamados. Pergunta o que falta, como a versão do Windows |
| F4.1b | Responda "É Windows 11." | O artigo não vale para o caso. Pergunta "Quem está sendo afetado?" com "Só eu", "Minha equipe", "Toda a empresa" e "Não sei" |
| F4.2 | Clique em "Só eu" e, se ele perguntar, diga que há uma reunião hoje mais tarde que depende disso (R3.1) | Card do rascunho com título, descrição, categoria Rede e VPN, prioridade Alta com o prazo e "Somente você". Estado "Aguardando confirmação". A frase acima diz por que é Alta |
| R3.2 | Como Rafael, abra a conversa do Bruno em "Todas" e veja o painel "Chamados de Bruno" | O chamado ainda não existe |
| F4.3 | Como Bruno, clique em Editar. Mude o título e abra a categoria para ver as opções, sem trocar a categoria, e salve (R2.2) | Os campos abrem dentro do card. A categoria tem Acesso, Rede e VPN, Hardware, Software, E-mail e Outros. Não há campo de prioridade. O card mostra o título novo |
| F4.4 | Clique em Confirmar (R1.1, R3.3) | "Chamado INC-xxxxx criado.": o tipo aparece no número, INC por ser algo que não funciona. O card do rascunho não mostra o tipo. Recarregue: continua igual, com um chamado só |
| A1.1 | Como Rafael, recarregue a conversa do Bruno | O chamado está no painel. Ao abri-lo, o número mostra o tipo, e a categoria e a prioridade são as da conversa |
| A1.2 | Leia a descrição do chamado | Conta o que acontece, desde quando, o sistema, o que já foi tentado e o impacto, com as palavras dele |

Trocar a categoria no card faz o código checar duplicidade de novo. Para Software, ele encontraria o REQ-10450 do Bruno e recusaria a edição com um 409. O comportamento está certo, mas não é o que este passo confere.

### Tipos, categorias e a tabela de prioridade (Anexo A)

Um rascunho por linha, em mensagens que já dizem o que ele precisa. Clique em Cancelar antes de ir para a linha seguinte, menos na última, que segue para o R3.4. Se ele perguntar algo, responda e continue.

A categoria Outros só aparece aqui como opção no card (R2.2): qual caso cai nela depende do que o modelo julga, e o Anexo A não dá um exemplo.

| # | O que escrever | Categoria | Prioridade | Prazo |
|---|---|---|---|---|
| R2.a | "Minha senha do Jira bloqueou e não consigo entrar. Só comigo, sem compromisso hoje." | Acesso | Alta | 4 horas úteis |
| R8.2 | "Meu monitor não liga e não consigo trabalhar. Só comigo, sem compromisso hoje." | Hardware | Alta | 4 horas úteis |
| R8.3 | "O Excel trava às vezes. Consigo usar pelo navegador, mas hoje mais tarde tenho uma apresentação que depende dele. Só comigo." | Software | Alta | 4 horas úteis |
| R8.4 | "A caixa compartilhada de e-mail da minha equipe está lenta, mas dá para usar pelo navegador. Sem compromisso hoje." | E-mail | Média | 3 dias úteis |
| R8.5 | "Quero uma licença do Visio, sem pressa. É só para mim." | Software | Baixa | 5 dias úteis |

A coluna Prazo traz a duração da regra. O card mostra "resposta até" com um horário, que deve bater com essa duração contada de agora, em horas úteis. O tipo só aparece no número do chamado criado, no R3.4.

A linha de Rede e VPN é o F4.2, e a linha Crítica é o R8.1, na parte 6, porque ela transfere a conversa.

| # | Passo | Resultado esperado |
|---|---|---|
| R3.4 | Com o rascunho do R8.5 na tela, force a queda com o `curl` do começo e clique em Confirmar logo em seguida. Depois de uns 10 segundos, clique em "Tentar de novo". Sem as chaves de admin, só clique em Confirmar, sem a queda (R1.2) | Com a queda, primeiro aparece "O serviço de chamados não respondeu. Tente de novo; o chamado não será duplicado." e o rascunho continua lá. Nos dois caminhos, termina em "Chamado REQ-xxxxx criado.", um chamado só: o tipo aparece no número, REQ por ser um pedido |

## Parte 4: o console antes das novas transferências

| # | Passo | Resultado esperado |
|---|---|---|
| A2.1 | Como Rafael, clique em "Para você" | Mostra o que espera no N2: Diego, com INC-20319 |
| A2.4 | Use "Todas", "Com o agent" e "Minhas", e busque "Diego" | Cada filtro muda a lista, e a busca acha o Diego. "Todas" mostra os selos "Agent atendendo" (Bruno) e "Resolvida pelo agent" (Elisa) |
| A2.5 | Desligue "Disponível", recarregue e ligue de novo | O estado sobrevive ao recarregar |
| A2.2 | Saia e entre como Juliana, em "Para você" | Mostra o que espera no N1: Carla, com "Agent pediu ajuda · confiança 41%" |
| A2.3 | Abra a conversa da Carla | Mostra o histórico, o motivo da transferência, o resumo e, em cada resposta, o detalhe da decisão |
| F6.3 | Na janela da Ana, saia e entre como Gabriela. Depois saia e volte como Ana | A Gabriela vê a última conversa, encerrada há 2 dias, com as pílulas de dia e, abaixo da nota, "Nova conversa". Não escreva nada nela ainda |

Volte a janela do analista para o Rafael: saia e entre de novo.

## Parte 5: transferências e o analista

### Falar com um analista (Funcionário 5)

| # | Passo | Resultado esperado |
|---|---|---|
| F5.1 | Como Bruno, escreva "Quero falar com um analista, meu Outlook não abre." (R5.1) | Diz que encaminhou para o Suporte N1, com o horário. Nota "Transferida para Suporte N1". O topo mostra "Aguardando analista" |
| F5.2 | Escreva "Estou aguardando" (R5.6) | A mensagem é gravada e o agent não responde: ele para até a conversa ser liberada |
| F5.3 | Como Ana, escreva "Como está o INC-20311?" e clique em "Falar com um analista" (R5.3) | Vai para o Suporte N2, porque o chamado está vencido |

### Assumir, devolver e encerrar (Analista 3)

| # | Passo | Resultado esperado |
|---|---|---|
| A3.1 | Como Rafael, abra a conversa da Ana em "Para você" (R5.5) | "Aguardando atendente", o campo de resposta travado até assumir, o resumo do caso e o painel "Chamados de Ana" |
| A3.2 | Clique em "Assumir atendimento" | Nota "Rafael Lima assumiu · agent pausado". A conversa vai para "Minhas". No chat da Ana, em alguns segundos: "Rafael Lima entrou na conversa" e "Analista online" |
| A3.3 | Troquem mensagens | Cada um vê a do outro em até 3 s. O agent não responde. Esta mensagem do Rafael recomeça o prazo do INC-20311 |
| A3.6 | No painel, clique em "Ver todos os chamados de Ana" | Abre a lista completa, só dela |
| A3.4 | Clique em "Devolver ao agent" e, como Ana, escreva "Qual o horário do service desk?" | No console, "Rafael Lima devolveu ao agent". O agent volta a responder a Ana |
| R8.10 | Como Ana, escreva "Como está o INC-20311?" | O card diz que está no prazo: a resposta do analista recomeça o prazo. A resposta do Nexo cita o que o Rafael escreveu |
| A3.5 | Como Ana, escreva "Quero falar com um analista." Como Rafael, abra a conversa em "Todas", assuma e clique em "Encerrar atendimento" | "Rafael Lima encerrou o atendimento" nas duas telas. A linha mostra "Encerrada por você". O chamado agora está no prazo, então ela vai para o N1, e por isso está em "Todas" e não em "Para você" |

## Parte 6: crítico e dúvida do agent

Cada caso numa pessoa própria, porque a conversa fica com um analista depois deles.

| # | Passo | Resultado esperado |
|---|---|---|
| R5.2 / R8.1 | Como Elisa, escreva "O sistema de pedidos caiu para toda a minha equipe, ninguém consegue trabalhar." | Sem perguntar mais nada, diz que o caso é crítico e que encaminhou para o Suporte N2, com espera de até 1 hora, contada 24 horas por dia. Mostra o rascunho com prioridade Crítica e a nota "Transferida para Suporte N2" |
| R5.2b | Como Rafael, abra a conversa dela em "Para você" | O título e a descrição do rascunho aparecem como resumo |
| R5.2c | Como Elisa, clique em Confirmar | O chamado é criado e fica ligado à conversa |
| R5.4 | Como Gabriela, escreva "Meu Excel fecha sozinho quando abro a planilha de campanhas, a que tem macros. Uso Windows 11, o Office está atualizado, já reiniciei e testei em outro computador: acontece só com essa planilha. Não sei se é a planilha, as macros ou o Office." | Vai para o N1, por dúvida do agent. Como Juliana, a conversa aparece em "Para você" com "Agent pediu ajuda · confiança N%" |

## Parte 7: voltar outro dia e o limite

A conversa anterior da Ana foi encerrada no A3.5, então estes passos começam uma nova.

| # | Passo | Resultado esperado |
|---|---|---|
| F6.4 | No fim do dia, como Ana, escreva "Como está o INC-20298?" e pare. No dia seguinte, em São Paulo, escreva "E agora, alguma novidade?" | Consulta o chamado de novo antes de responder, sem cumprimentar de novo. A mensagem nova ganha a pílula do dia |
| F6.5 | Na mesma conversa, siga escrevendo perguntas simples, como "Qual o horário do service desk?", até a 30ª mensagem. Custa cerca de US$ 0,03 em modelo | O contador avisa quanto falta nas últimas 5. A 30ª é respondida e, sem nada pendente, a conversa encerra com a nota do limite e "Nova conversa" |

O outro ramo do limite, em que algo pendente leva a conversa ao analista com "Limite de mensagens", exigiria mais 30 mensagens. Ele é coberto pelo teste `continuity-and-limit.spec.ts`, com o modelo simulado.

## Parte 8: tetos de uso

Só no local, porque muda a configuração. O `.env` define quantas mensagens podem chamar o modelo por dia de São Paulo. Rode por último, porque o seed apaga o que os passos anteriores fizeram.

| # | Passo | Resultado esperado |
|---|---|---|
| T0 | Pare o `pnpm dev`, rode `pnpm db:seed`, que zera os contadores do dia, ponha `USAGE_LIMIT_GLOBAL_PER_DAY=1` no `.env` e suba de novo | Sem o seed, o contador do dia já passou de 1, e até a primeira mensagem seria recusada |
| T1 | Como Ana, escreva "Qual o horário do service desk?" e depois "Como está o INC-20311?" | A primeira é respondida. A segunda recebe "O Nexo não pode responder: a demo está indisponível hoje. Sua mensagem ficou salva." A mensagem fica na tela e o contador a conta |
| T2 | Como Rafael, abra a conversa do Diego em "Para você", assuma e escreva | O console funciona: o teto só vale para a mensagem que chamaria o modelo |
| T3 | Pare o `pnpm dev`, volte o `.env` ao valor anterior e suba de novo. Como Ana, escreva de novo | O Nexo volta a responder |

## Onde está cada história e cada regra

| História ou regra | Passos |
|---|---|
| Funcionário 1: tirar uma dúvida | F1.1 a F1.6 |
| Funcionário 2: consultar sem o número | F2.1 a F2.3 |
| Funcionário 3: complementar | F3.1 a F3.3 |
| Funcionário 4: abrir conversando | F4.1 a F4.4 |
| Funcionário 5: falar com um analista | F5.1 a F5.3 |
| Funcionário 6: voltar e continuar | F6.1 a F6.5 |
| Analista 1: chamado bem aberto | A1.1 e A1.2 |
| Analista 2: conversas que precisam de mim | A2.1 a A2.5 |
| Analista 3: assumir, devolver, encerrar | A3.1 a A3.6 |
| Tipos de chamado | INC no F4.4; REQ no R3.4 |
| Categorias | F4.2, R2.a, R8.2 a R8.5; as seis opções no F4.3 |
| Abertura: campos e confirmação | F4.2, R3.2, F4.4, R3.4 |
| Sem duplicidade e 7 dias | R4.1 a R4.3 |
| Transferência | Pedido: F5.1. Crítico: R5.2. Vencido: F5.3. Dúvida do agent: R5.4. Resumo: A3.1 e R5.2b. Agent parado: F5.2 e A3.3 |
| Privacidade | R6.1 a R6.3 |
| Escopo | R7.1 a R7.3 |
| Prioridade | R8.1 a R8.5, F4.2 |
| Prazos | Vencido: F2.2. No prazo: R8.7. Complemento não reinicia: R8.8. Reabertura: R4.2. Resposta do analista: R8.10 |

## Falhas conhecidas

Os resultados com o modelo real estão em [docs/evals/resultado.md](evals/resultado.md). Um caso abaixo de 3 de 3 lá pode variar aqui também. O que pode aparecer neste roteiro:

- Num problema sem artigo na central, o modelo às vezes grava confiança baixa e o código transfere, em vez de perguntar o que falta. Aconteceu com "O Teams não abre no meu computador." Por isso o F4 usa o caso da VPN, que tem artigo. Se acontecer, destrave como diz o começo.
- Num chamado resolvido há mais de 7 dias, citado pelo número, o modelo às vezes consulta o chamado e termina sem texto e sem rascunho. Pode aparecer no R4.3.
- O modelo às vezes monta o mesmo rascunho duas vezes numa resposta.
- Ao pedirem um chamado de outra pessoa, o modelo às vezes também transfere para um analista, sem mostrar nada do chamado. Pode aparecer no R6.1. Se acontecer, destrave como diz o começo.
- Numa queda do ticket-service com a lista de analistas ainda válida no cache do web, a mensagem do analista fica gravada, mas o prazo só recomeça na próxima mensagem que passar (README, "Limitações conhecidas").
