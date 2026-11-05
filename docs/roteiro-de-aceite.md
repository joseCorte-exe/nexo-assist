# Roteiro de aceite

Este roteiro serve para uma pessoa conferir o Nexo Assist à mão, no link publicado ou no local. Cobre as 9 histórias do PRD e cada regra do Anexo A, com as pessoas e os chamados dos dados de exemplo.

## Antes de começar

- Rode o seed para as datas ficarem relativas a hoje: `pnpm db:seed` no local, ou `POST /admin/reseed` do ticket-service no link publicado, com a chave de admin. Os passos que escrevem mudam os dados, então volte a rodar o seed antes de repetir o roteiro.
- Qualquer senha serve.
- Use duas janelas, uma delas anônima, quando o passo envolver funcionário e analista ao mesmo tempo. A sessão fica num cookie, e cada janela guarda uma pessoa.
- O modelo não dá sempre as mesmas palavras. Confira o que o passo diz que acontece, não a frase exata. Só os textos entre aspas que vêm do código ou do design são fixos.
- Faça os passos em horário útil (segunda a sexta, 8h às 18h, em São Paulo). Fora dele, os prazos em horas úteis mostram o dia seguinte, o que é correto, mas muda o que você lê.

| Pessoa | E-mail | Papel | O que tem nos dados de exemplo |
|---|---|---|---|
| Ana Souza | ana.souza@nexo.com.br | Funcionária | Chat vazio. INC-20311 (vencido), INC-20298, REQ-10442, INC-20150 (resolvido há 4 dias), INC-19877 (há 12 dias), INC-19410 (há 30 dias) |
| Bruno Tavares | bruno.tavares@nexo.com.br | Funcionário | Conversa com o agent. REQ-10450 |
| Carla Mendes | carla.mendes@nexo.com.br | Funcionária | Conversa esperando o N1, "Agent pediu ajuda · confiança 41%" |
| Diego Ramos | diego.ramos@nexo.com.br | Funcionário | Conversa esperando o N2. INC-20319 (crítico) |
| Elisa Prado | elisa.prado@nexo.com.br | Funcionária | Última conversa encerrada pelo agent: disse que resolveu, nota "Resolvida pelo Nexo", selo "Resolvido pelo agent" |
| Fábio Nunes | fabio.nunes@nexo.com.br | Funcionário | Conversa com o Rafael. INC-20302 |
| Gabriela Rocha | gabriela.rocha@nexo.com.br | Funcionária | Última conversa encerrada por analista. INC-20297 |
| Rafael Lima | rafael.lima@nexo.com.br | Analista N2 | Atende o Fábio |
| Juliana Costa | juliana.costa@nexo.com.br | Analista N1 | |

## Entrada

| # | Passo | Resultado esperado |
|---|---|---|
| E1 | Abra `/login` | Aparecem os três números: "primeira resposta, em média", "resolvidos sem fila" e "analistas online agora" |
| E2 | Entre com `ninguem@nexo.com.br` | "E-mail não encontrado." e a tela continua no login |
| E3 | Entre como Ana | Abre o chat dela, vazio, com "Assistente online" |
| E4 | Saia e entre como Rafael | Abre `/console` |
| E5 | Como Ana, abra `/console` | Volta para o chat: funcionário não entra no console |

## Histórias do funcionário

### Funcionário 1: tirar uma dúvida sem abrir chamado

| # | Passo | Resultado esperado |
|---|---|---|
| F1.1 | Como Ana, escreva "Minha VPN está dando erro 809. Uso Windows 10, o que eu faço?" | A resposta chega em partes. Diz para reinstalar o cliente de VPN pelo portal de softwares e reiniciar. Nenhum rascunho aparece |
| F1.2 | Olhe a linha acima da resposta e expanda | A linha diz que buscou na central de ajuda. O detalhe mostra o que entendeu, a ação, a confiança e o motivo |
| F1.3 | Escreva "Qual o horário do service desk?" | De segunda a sexta, das 8h às 18h, com plantão 24 horas para críticos. Sem chamado |
| F1.4 | Escreva só "Obrigado" | Responde numa frase e a conversa continua aberta, sem nota de encerramento |
| F1.5 | Escreva "Resolveu, obrigada!" | Uma frase de encerramento, sem pergunta. Nota "Resolvida pelo Nexo · conversa encerrada", botão "Nova conversa" e, no campo, "Comece uma nova conversa…". A próxima mensagem começa outra conversa, e o passo seguinte parte dela |
| F1.6 | Como Rafael, em "Todas", abra a conversa da Ana | Selo "Resolvido pelo agent" |

### Funcionário 2: saber como está um chamado sem lembrar o número

| # | Passo | Resultado esperado |
|---|---|---|
| F2.1 | Como Ana, escreva "Qual o status do meu chamado?" | Lista para escolher com os 3 abertos: INC-20311, INC-20298 e REQ-10442. Nenhum chamado de outra pessoa |
| F2.2 | Clique no INC-20311 | Card do chamado: Hardware › Notebook, Média, Aguardando analista, vencido. Oferece "Falar com um analista", "Adicionar informação" e "Não, obrigado" |
| F2.3 | Escreva "Como está o chamado do meu notebook?" | Acha o INC-20311 sem pedir o número e diz que está vencido |

### Funcionário 3: complementar um chamado aberto

| # | Passo | Resultado esperado |
|---|---|---|
| F3.1 | Como Ana, peça o INC-20311 e clique em "Adicionar informação" | O agent pergunta o que acrescentar |
| F3.2 | Escreva "A lentidão piora quando abro o Excel." | Card "Complemento · INC-20311" com a informação nova e "prazo vencido". Nada foi enviado ainda |
| F3.3 | Clique em Confirmar | "Complemento enviado ao INC-20311." O chamado continua vencido: o complemento não muda o prazo |

### Funcionário 4: abrir um chamado só conversando

| # | Passo | Resultado esperado |
|---|---|---|
| F4.1 | Como Bruno, escreva "O Teams não abre no meu computador." | O agent consulta os chamados e a central, e pergunta "Quem está sendo afetado?" com as opções "Só eu", "Minha equipe", "Toda a empresa" e "Não sei" |
| F4.2 | Clique em "Só eu" e, se ele perguntar, diga que há uma reunião hoje às 15h que depende disso | Card do rascunho com título, descrição, tipo INC, categoria Software, prioridade Alta com o prazo e "Somente você". Estado "Aguardando confirmação". A frase acima diz por que é Alta |
| F4.3 | Clique em Editar, mude o título e a categoria e salve | Os campos abrem dentro do card. Não há campo de prioridade. O card mostra o que foi editado |
| F4.4 | Clique em Confirmar | "Chamado INC-xxxxx criado." e o número novo. Recarregue: continua igual |
| F4.5 | Escreva "Quero um segundo mouse para o escritório" e siga até o rascunho. Clique em Cancelar | Tipo REQ. "Rascunho descartado. Se mudar de ideia, é só pedir." Nenhum chamado novo |

### Funcionário 5: falar com um analista

| # | Passo | Resultado esperado |
|---|---|---|
| F5.1 | Como Bruno, escreva "Quero falar com um analista, meu Outlook não abre." | Diz que encaminhou para o Suporte N1, com o horário. Nota "Transferida para Suporte N1". O topo mostra "Aguardando analista" |
| F5.2 | Escreva "Estou aguardando" | A mensagem é gravada e o agent não responde: ele para até a conversa ser liberada |
| F5.3 | Como Ana, peça o INC-20311 e clique em "Falar com um analista" | Vai para o Suporte N2, porque o chamado está vencido |

### Funcionário 6: voltar outro dia e continuar

A volta em outro dia depende do calendário. Para conferir no mesmo dia, use a Gabriela e a Elisa, cujas conversas têm dias anteriores nos dados de exemplo.

| # | Passo | Resultado esperado |
|---|---|---|
| F6.1 | Como Ana, numa conversa ativa, saia, entre de novo e recarregue | A conversa volta inteira, com cards, decisões e o contador |
| F6.2 | Referência ao que foi dito: escreva "Como está o INC-20298?" e depois "Quero acrescentar nesse chamado que o dono da pasta é a Marina." | Monta o complemento do INC-20298 sem perguntar qual chamado |
| F6.3 | Entre como Gabriela | Abre a última conversa, encerrada há 2 dias, com as pílulas de dia. Em cima dela aparece "Nova conversa" |
| F6.4 | Volte no dia seguinte à conversa do passo F6.2 e pergunte como está o chamado | Consulta de novo antes de responder, sem cumprimentar de novo. A nova mensagem ganha a pílula do dia |
| F6.5 | Limite: chegue à 30ª mensagem numa conversa sem nada pendente | O contador avisa quanto falta nas últimas 5. A 30ª é respondida, e a conversa encerra com a nota do limite e "Nova conversa". Com algo pendente, ela vai para um analista com "Limite de mensagens" |

## Histórias do analista

### Analista 1: receber chamados que não exigem perguntar de novo

| # | Passo | Resultado esperado |
|---|---|---|
| A1.1 | Depois do F4.4, entre como Rafael, abra a conversa do Bruno em "Todas" e veja o painel "Chamados de Bruno" | O chamado criado está lá, com tipo, categoria e prioridade da conversa |
| A1.2 | Leia a descrição do chamado | Conta o que acontece, desde quando, o sistema, o que já foi tentado e o impacto, com as palavras dele |

### Analista 2: ver as conversas que precisam de mim

| # | Passo | Resultado esperado |
|---|---|---|
| A2.1 | Como Rafael, clique em "Para você" | Mostra o que espera no N2, como Diego, com INC-20319 |
| A2.2 | Saia e entre como Juliana, em "Para você" | Mostra o que espera no N1, como Carla, com "Agent pediu ajuda · confiança 41%" |
| A2.3 | Abra a conversa da Carla | Mostra o histórico, o motivo da transferência, o resumo e, em cada resposta, o detalhe da decisão |
| A2.4 | Use "Todas", "Com o agent" e "Minhas", e busque "Diego" | Cada filtro muda a lista, e a busca acha o Diego. "Todas" mostra os selos "Agent atendendo" e "Resolvido pelo agent" |
| A2.5 | Desligue "Disponível", recarregue e ligue de novo | O estado sobrevive ao recarregar |

### Analista 3: assumir, devolver e encerrar

| # | Passo | Resultado esperado |
|---|---|---|
| A3.1 | Faça o F5.3 com a Ana. Como Rafael, abra a conversa dela em "Para você" | "Aguardando atendente", o campo de resposta travado até assumir, e o painel "Chamados de Ana" |
| A3.2 | Clique em "Assumir atendimento" | Nota "Rafael Lima assumiu · agent pausado". A conversa vai para "Minhas". No chat da Ana, em até alguns segundos: "Rafael Lima entrou na conversa" e "Analista online" |
| A3.3 | Troquem mensagens | Cada um vê a do outro em até 3 s. O agent não responde |
| A3.4 | Clique em "Devolver ao agent" e, como Ana, escreva "Qual o horário do service desk?" | No console, "Rafael Lima devolveu ao agent". O agent volta a responder a Ana |
| A3.5 | Como Ana, peça um analista de novo. Como Rafael, assuma e clique em "Encerrar atendimento" | "Rafael Lima encerrou o atendimento" nas duas telas. A linha mostra "Encerrada por você" |
| A3.6 | No painel, clique em "Ver todos os chamados de Ana" | Abre a lista completa, só dela |

## Regras do Anexo A

### Tipos de chamado

| # | Passo | Resultado esperado |
|---|---|---|
| R1.1 | Siga o F4.2: algo que não funciona | Tipo INC |
| R1.2 | Siga o F4.5: um pedido de equipamento | Tipo REQ |

### Categorias

| # | Passo | Resultado esperado |
|---|---|---|
| R2.1 | Em rascunhos separados, descreva um problema de cada: senha bloqueada; VPN que não conecta; notebook que não liga; Excel que não abre; e-mail que não chega; um problema de TI que não se encaixa em nenhuma dessas | Acesso, Rede e VPN, Hardware, Software, E-mail e Outros. Cancele cada um |
| R2.2 | Clique em Editar num rascunho e abra a categoria | As seis opções aparecem |

### Abertura: campos e confirmação

| # | Passo | Resultado esperado |
|---|---|---|
| R3.1 | Confira o card do F4.2 | Título, descrição, tipo, categoria, prioridade e quem é afetado |
| R3.2 | Antes de clicar em Confirmar, abra os chamados do Bruno no console | O chamado ainda não existe |
| R3.3 | Clique em Confirmar | Agora ele existe. Clicar de novo ou recarregar não cria outro |
| R3.4 | Com um rascunho na tela, force a queda: `POST /admin/outage?seconds=8` no ticket-service, com a chave de admin. Clique em Confirmar | "O serviço de chamados não respondeu. Tente de novo; o chamado não será duplicado." e o rascunho continua lá. Depois da queda, a nova tentativa cria um chamado só |

### Sem duplicidade e reabertura em 7 dias

| # | Passo | Resultado esperado |
|---|---|---|
| R4.1 | Como Ana, escreva "Meu notebook está lento desde a atualização do Windows. Quero abrir um chamado." | Não monta um chamado novo. Leva ao INC-20311, com o card ou o rascunho "Complemento · INC-20311" |
| R4.2 | Como Ana, escreva "A senha do SAP bloqueou de novo." | Rascunho "Reabertura · INC-20150" (resolvido há 4 dias). Depois de Confirmar: "INC-20150 reaberto." e o status volta para Aguardando analista |
| R4.3 | Como Ana, escreva "O Outlook do celular parou de sincronizar de novo." | O INC-19877 foi resolvido há 12 dias: diz que não pode ser reaberto e segue para um chamado novo |

### Casos de transferência

| # | Passo | Resultado esperado |
|---|---|---|
| R5.1 | Pedido: F5.1 | N1, motivo pedido do funcionário |
| R5.2 | Crítico: como Elisa, escreva "O sistema de pedidos caiu para toda a minha equipe, ninguém consegue trabalhar." | Sem perguntar mais nada, diz que o caso é crítico e que encaminhou para o Suporte N2, com espera de até 1 hora. Mostra o rascunho com prioridade Crítica e a nota "Transferida para Suporte N2". Como Rafael, a conversa aparece em "Para você", com o título e a descrição do rascunho como resumo. Como Elisa, clique em Confirmar: o chamado é criado e fica ligado à conversa |
| R5.3 | Vencido: F5.3 | N2, motivo vencido |
| R5.4 | Dúvida do agent: como Gabriela, escreva "Meu Excel fecha sozinho quando abro a planilha de campanhas, a que tem macros. Já reiniciei e testei em outro computador." | Se a confiança ficar abaixo de 0,6, vai para o N1 com "Agent pediu ajuda · confiança N%". O modelo pode variar: veja [docs/evals/resultado.md](evals/resultado.md) |
| R5.5 | Em qualquer transferência, abra a conversa no console | O resumo do caso está lá |
| R5.6 | Com a conversa em espera ou com um analista, escreva como funcionário | O agent não responde |

### Privacidade

| # | Passo | Resultado esperado |
|---|---|---|
| R6.1 | Como Ana, escreva "Como está o INC-20319? É do Diego Ramos, da minha equipe." | Diz que não encontrou esse número entre os chamados dela. Nada do chamado aparece: nem título, nem status |
| R6.2 | Como Ana, escreva "Quais os chamados do Diego?" | Não lista nenhum chamado dele |
| R6.3 | Como Ana, chame `GET /api/console/employees/emp-diego/tickets` no navegador | Recusado: a rota é só de analista |

### Escopo

| # | Passo | Resultado esperado |
|---|---|---|
| R7.1 | Escreva "Como faço para pedir minhas férias?" | Indica o RH: rh@nexo.com.br, ramal 4100. Sem chamado |
| R7.2 | Escreva "Como peço reembolso de um táxi?" | Indica o financeiro: financeiro@nexo.com.br, ramal 4200 |
| R7.3 | Escreva "O ar-condicionado da sala 3 está pingando." | Indica facilities: facilities@nexo.com.br, ramal 4300 |

### Tabela de prioridade e prazos

Monte um rascunho para cada linha e cancele. A tabela é lida de cima para baixo, e vale a primeira linha que bater.

| # | O que dizer ao agent | Prioridade | Prazo |
|---|---|---|---|
| R8.1 | Algo parou para a equipe ou para a empresa | Crítica | 1 hora, 24 horas por dia |
| R8.2 | Parou só para mim | Alta | 4 horas úteis |
| R8.3 | Atrapalha, tem alternativa, mas há um compromisso hoje | Alta | 4 horas úteis |
| R8.4 | Atrapalha a equipe, mas há alternativa | Média | 3 dias úteis |
| R8.5 | Pedido sem urgência | Baixa | 5 dias úteis |

| # | Passo | Resultado esperado |
|---|---|---|
| R8.6 | Peça o INC-20311 | Vencido: Média, sem atualização há 6 dias, acima de 3 dias úteis |
| R8.7 | Peça o INC-20298 | No prazo: a TI respondeu ontem, e o prazo conta da última resposta |
| R8.8 | Complemente o INC-20311 e peça o chamado de novo | Continua vencido: o complemento do funcionário não reinicia o prazo |
| R8.9 | Reabra o INC-20150 e confira o prazo no card | Conta da reabertura |
| R8.10 | Depois do A3.3, com o Rafael tendo respondido na conversa ligada ao INC-20311, e do A3.4, peça o INC-20311 como Ana | Não está mais vencido: a resposta do analista recomeça o prazo. O card mostra o que ele escreveu como a última resposta da TI |

## Tetos de uso

Só no local, porque muda a configuração. O `.env` define quantas mensagens podem chamar o modelo por dia de São Paulo.

| # | Passo | Resultado esperado |
|---|---|---|
| T1 | Ponha `USAGE_LIMIT_GLOBAL_PER_DAY=1` no `.env`, suba de novo e, como Gabriela, mande duas mensagens em conversas com o agent | A segunda recebe "O Nexo não pode responder: a demo está indisponível hoje. Sua mensagem ficou salva." A mensagem fica na tela e o contador a conta |
| T2 | Com o teto estourado, abra o console e assuma uma conversa | O console e o analista continuam funcionando: o teto só vale para a mensagem que chamaria o modelo |
| T3 | Volte o `.env` ao valor anterior e suba de novo | O Nexo volta a responder |

## Falhas conhecidas

Os resultados com o modelo real estão em [docs/evals/resultado.md](evals/resultado.md). Um caso abaixo de 3 de 3 lá pode variar aqui também.

- Numa queda do ticket-service com a lista de analistas ainda válida no cache do web, a mensagem do analista fica gravada, mas o prazo só recomeça na próxima mensagem que passar (README, "Limitações conhecidas").
