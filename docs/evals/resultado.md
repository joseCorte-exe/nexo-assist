# Testes do agent com o modelo real

Este arquivo é escrito pelo `pnpm eval`. Não edite à mão: rode de novo.

Rodado em 2026-11-06, com `anthropic/claude-haiku-5-5`. Cada caso roda 3 vezes, e só passa se todas passarem. Os dados são os do seed, em memória, com o relógio parado numa segunda às 10:05. O tempo e o custo são da rodada inteira do caso, com todas as mensagens dela. Os casos rodam em sequência, então quase todas as chamadas leem as instruções do cache.

Preço por milhão de tokens: entrada US$ 0,10, leitura de cache US$ 0,01, escrita no cache US$ 0,125, saída US$ 0,50.

| Caso | História ou regra | Passou | Tempo (mediana) | Custo (mediana) |
|---|---|---|---|---|
| Dúvida resolvida pela central, sem abrir chamado | Funcionário 1 | 3 de 3 | 4,4 s | US$ 0,0011 |
| Consulta sem número que encontra chamado vencido | Funcionário 2; Anexo A, prazos | 3 de 3 | 4,3 s | US$ 0,0010 |
| Complemento de chamado aberto | Funcionário 3; Anexo A, abertura | 3 de 3 | 4,7 s | US$ 0,0010 |
| Falta informação e o agent pergunta, depois monta o rascunho | Funcionário 4; Analista 1; Anexo A, tipos, categorias, abertura e prioridade | 1 de 3 | 10,2 s | US$ 0,0026 |
| Referência a algo dito antes | Funcionário 6; condução da conversa | 3 de 3 | 7,5 s | US$ 0,0021 |
| Caso crítico vai para o N2 | Funcionário 5; Anexo A, transferência e prioridade | 3 de 3 | 6,4 s | US$ 0,0015 |
| Chamado vencido vai para o N2 | Funcionário 5; Analista 2; Anexo A, transferência | 3 de 3 | 7,8 s | US$ 0,0019 |
| Pedido do funcionário vai para o N1 | Funcionário 5; Anexo A, transferência | 3 de 3 | 3,8 s | US$ 0,0008 |
| Agent inseguro vai para o N1 | Analista 2; Anexo A, transferência | 3 de 3 | 6,5 s | US$ 0,0013 |
| Fora de escopo | Anexo A, escopo | 3 de 3 | 2,7 s | US$ 0,0006 |
| Tentativa de ver chamado de outra pessoa | Anexo A, privacidade | 3 de 3 | 5,1 s | US$ 0,0010 |
| Duplicado vira o chamado que já existe | Anexo A, sem duplicidade | 3 de 3 | 5,6 s | US$ 0,0012 |
| Ela diz que resolveu e a conversa encerra | Resolução sem fila; Funcionário 1 | 3 de 3 | 6,2 s | US$ 0,0015 |
| Só um obrigado não encerra a conversa | Resolução sem fila; condução da conversa | 3 de 3 | 6,9 s | US$ 0,0016 |
| Reabrir um chamado resolvido há 6 dias | Anexo A, sem duplicidade (reabertura em 7 dias) | 3 de 3 | 5,4 s | US$ 0,0012 |
| Reabrir um chamado resolvido há 8 dias vira chamado novo | Anexo A, sem duplicidade (reabertura em 7 dias) | 2 de 3 | 9,4 s | US$ 0,0022 |

Passaram 14 de 16 casos. Custo total: US$ 0,0708. Rodadas repetidas por erro do provedor ou tempo esgotado: 0.

Em 2 de 63 respostas o modelo gravou a decisão mais de uma vez, embora as instruções peçam uma só.

## O que o modelo fez nos casos que não passaram

### Falta informação e o agent pergunta, depois monta o rascunho (1 de 3)

- Rodada 1: a primeira resposta devia perguntar o que falta: expected false to be true // Object.is equality
  - Resposta 1, confiança 0.5: searchArticles {"query":"Teams não abre no computador"}; transferToAnalyst {"reason":"agent_unsure","summary":"Não tenho nada na central sobre Teams que não abre. Ainda não sei o sistema operacional, a mensagem de erro nem desde quando acontece."}; updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador.\n- Equipamento e sistema: não informado.\n- O que já foi tentado: não informado.\n- Situação: a central de ajuda não tem artigo sobre Teams. Encaminhado para o Suporte N1 (agent_unsure), espera até 29 out, 10:05.\n"}
  - Texto: Não encontrei nada na central de ajuda sobre o Teams que não abre. Encaminhei para o Suporte N1, e um analista deve falar com você até 29 out, 10:05. Enquanto isso, pode continuar escrevendo aqui, e o analista vai ler. Se puder, diga qual é o sistema operacional do computador, se aparece alguma mensagem de erro e desde quando isso acontece.
  - Resposta 2, confiança 0.6: updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador; aparece tela branca.\n- Equipamento e sistema: não informado (sistema operacional ainda não confirmado).\n- O que já foi tentado: reiniciou o computador, sem efeito. Não há artigo na central sobre o caso.\n- Situação: começou hoje de manhã. Afeta só ele. Reunião com cliente hoje às 15h depende disso. Encaminhado para o Suporte …
  - Texto: Anotei os detalhes para o analista: só você é afetado, a tela branca começou hoje de manhã, o reinício não resolveu e a reunião com o cliente é às 15h. A conversa já está com o Suporte N1, então ele deve ver essas informações e falar com você até 29 out, 10:05.
- Rodada 2: a primeira resposta devia perguntar o que falta: expected false to be true // Object.is equality
  - Resposta 1, confiança 0.5: searchArticles {"query":"Teams não abre no computador"}; transferToAnalyst {"reason":"agent_unsure","summary":"Funcionário relata que o Microsoft Teams não abre no computador. Não há artigo na central sobre Teams; o único resultado é sobre VPN com erro 809, que não se aplica. Falta saber o sistema operacional, a mensagem de erro e se o problema começou recentemente."}; updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador.\n- Equipamento e sistema: não informado.\n- O que já foi tentado: nada informado. Central de ajuda não tem artigo sobre Teams.\n- Situação: encaminhado para Suporte N1 (agent_unsure), analista até 29 out, 10:05. Sem chamado criado."}
  - Texto: Não encontrei nenhum artigo na central sobre o Teams que não abre. O único resultado era sobre VPN, que não se aplica ao seu caso. Encaminhei para o Suporte N1. Um analista vai falar com você até 29 out, 10:05. Pode continuar escrevendo por aqui que ele lê.
  - Resposta 2, confiança 0.7: listMyTickets {"scope":"open"}; draftTicket {"operation":"create","title":"Microsoft Teams abre com tela branca desde hoje","description":"O Microsoft Teams não abre no meu computador. Desde hoje de manhã aparece uma tela branca ao abrir. Já reiniciei o computador e o problema continua. Sistema operacional e modelo do equipamento não informados. Não há mensagem de erro informada. Afeta só eu e tenho uma reunião com cliente hoje às 15h que d…; updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador; desde hoje de manhã aparece tela branca.\n- Equipamento e sistema: não informado (sistema operacional e modelo ainda não informados).\n- O que já foi tentado: reiniciou o computador, sem efeito. Central de ajuda não tem artigo sobre Teams.\n- Situação: afeta só ele. Reunião com cliente hoje às 15h depende disso. Encaminhado ant…
  - Texto: Coloquei prioridade alta por causa da reunião das 15h. A resposta chega até hoje, às 14:05. Confira antes de eu criar:

### Reabrir um chamado resolvido há 8 dias vira chamado novo (2 de 3)

- Rodada 2: devia montar um chamado novo: expected [] to have a length of 1 but got +0
  - Resposta 1, confiança 0.85: getTicket {"ticketId":"INC-20150"}; draftTicket {"operation":"reopen","ticketId":"INC-20150","description":"A senha do SAP bloqueou de novo, depois de ter sido desbloqueada pela TI. Afeta só a mim e não há compromisso hoje que dependa disso."}; updateWorkingMemory {"memory":"# Caso\n- Problema: Senha do SAP bloqueou de novo (mesmo problema do INC-20150, já resolvido com senha temporária).\n- Equipamento e sistema: SAP\n- O que já foi tentado: INC-20150 resolvido (desbloqueio). Reabertura recusada: janela de 7 dias fechada.\n- Situação: Afeta só ela. Sem compromisso hoje. Precisa de chamado novo (create), a ser montado.\n"}
  - Texto: O INC-20150 foi resolvido há mais de 7 dias, então não dá para reabri-lo. Vou montar um chamado novo. Antes, uma pergunta: a senha bloqueou logo depois do desbloqueio anterior, ou já se passou um tempo?
