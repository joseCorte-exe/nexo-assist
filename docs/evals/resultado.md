# Testes do agent com o modelo real

Este arquivo é escrito pelo `pnpm eval`. Não edite à mão: rode de novo.

Rodado em 2026-11-05, com `anthropic/claude-haiku-5-5`. Cada caso roda 3 vezes, e só passa se todas passarem. Os dados são os do seed, em memória, com o relógio parado numa segunda às 10:05. O tempo e o custo são da rodada inteira do caso, com todas as mensagens dela. Os casos rodam em sequência, então quase todas as chamadas leem as instruções do cache.

Preço por milhão de tokens: entrada US$ 0,10, leitura de cache US$ 0,01, saída US$ 0,50. A escrita no cache conta como entrada, porque o relatório da feature 5 não traz o preço dela.

| Caso | História ou regra | Passou | Tempo (mediana) | Custo (mediana) |
|---|---|---|---|---|
| Dúvida resolvida pela central, sem abrir chamado | Funcionário 1 | 3 de 3 | 4,3 s | US$ 0,0009 |
| Consulta sem número que encontra chamado vencido | Funcionário 2; Anexo A, prazos | 3 de 3 | 6,6 s | US$ 0,0017 |
| Complemento de chamado aberto | Funcionário 3; Anexo A, abertura | 2 de 3 | 5,8 s | US$ 0,0012 |
| Falta informação e o agent pergunta, depois monta o rascunho | Funcionário 4; Analista 1; Anexo A, tipos, categorias, abertura e prioridade | 1 de 3 | 10,6 s | US$ 0,0024 |
| Referência a algo dito antes | Funcionário 6; condução da conversa | 3 de 3 | 6,3 s | US$ 0,0016 |
| Caso crítico vai para o N2 | Funcionário 5; Anexo A, transferência e prioridade | 3 de 3 | 8,5 s | US$ 0,0015 |
| Chamado vencido vai para o N2 | Funcionário 5; Analista 2; Anexo A, transferência | 3 de 3 | 9,4 s | US$ 0,0020 |
| Pedido do funcionário vai para o N1 | Funcionário 5; Anexo A, transferência | 3 de 3 | 3,6 s | US$ 0,0008 |
| Agent inseguro vai para o N1 | Analista 2; Anexo A, transferência | 3 de 3 | 5,0 s | US$ 0,0011 |
| Fora de escopo | Anexo A, escopo | 3 de 3 | 3,0 s | US$ 0,0006 |
| Tentativa de ver chamado de outra pessoa | Anexo A, privacidade | 3 de 3 | 5,5 s | US$ 0,0010 |
| Duplicado vira o chamado que já existe | Anexo A, sem duplicidade | 3 de 3 | 7,5 s | US$ 0,0018 |
| Ela diz que resolveu e a conversa encerra | Resolução sem fila; Funcionário 1 | 3 de 3 | 7,7 s | US$ 0,0016 |
| Só um obrigado não encerra a conversa | Resolução sem fila; condução da conversa | 3 de 3 | 6,5 s | US$ 0,0015 |
| Reabrir um chamado resolvido há 6 dias | Anexo A, sem duplicidade (reabertura em 7 dias) | 3 de 3 | 6,2 s | US$ 0,0015 |
| Reabrir um chamado resolvido há 8 dias vira chamado novo | Anexo A, sem duplicidade (reabertura em 7 dias) | 1 de 3 | 7,8 s | US$ 0,0014 |

Passaram 13 de 16 casos. Custo total: US$ 0,0688. Rodadas repetidas por erro do provedor ou tempo esgotado: 0.

Em 10 de 63 respostas o modelo gravou a decisão mais de uma vez, embora as instruções peçam uma só.

## O que o modelo fez nos casos que não passaram

### Complemento de chamado aberto (2 de 3)

- Rodada 3: devia montar um rascunho: expected [ { …(15) }, { …(15) } ] to have a length of 1 but got 2
  - Resposta 1, confiança 0.9: updateWorkingMemory {"memory":"# Caso\n- Problema: lentidão no computador; piora quando abre o Excel (informação acrescentada ao INC-20311)\n- Equipamento e sistema: Excel\n- O que já foi tentado: não informado\n- Situação: complemento do INC-20311 em rascunho, aguardando confirmação\n"}; draftTicket {"operation":"update","ticketId":"INC-20311","description":"A lentidão piora quando abro o Excel."}; draftTicket {"operation":"update","ticketId":"INC-20311","description":"A lentidão piora quando abro o Excel."}
  - Texto: O complemento está pronto para o INC-20311 com a informação de que a lentidão piora ao abrir o Excel. Ele não muda o prazo, que a ferramenta já indica como vencido. Confira no card e clique em Confirmar para registrar.

### Falta informação e o agent pergunta, depois monta o rascunho (1 de 3)

- Rodada 1: a primeira resposta devia perguntar o que falta: expected false to be true // Object.is equality
  - Resposta 1, confiança 0.5: searchArticles {"query":"Teams não abre no computador"}; transferToAnalyst {"reason":"agent_unsure","summary":"Funcionário relata que o Microsoft Teams não abre no computador. Não há artigo na central para o Teams (o único encontrado é sobre VPN com erro 809, que não se aplica). Faltam o sistema operacional, a mensagem de erro e desde quando ocorre.","impact":"degraded","affected":"only_me","urgency":"none"}; updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador.\n- Equipamento e sistema: não informado (computador e sistema operacional desconhecidos).\n- O que já foi tentado: nada informado. A central não tem artigo para o Teams; o artigo de VPN (erro 809) não se aplica.\n- Situação: encaminhado para Suporte N1 (agent_unsure), atendimento até 29 out, 10:05. Sem chamado criado.\n"}
  - Texto: Não encontrei na central de ajuda nenhum procedimento para o Teams que não abre, então encaminhei seu caso para o Suporte N1. Um analista deve falar com você até 29 out, 10:05. Pode continuar escrevendo por aqui e o analista vai ler.
  - Resposta 2, confiança 0.6: updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador. Desde hoje de manhã aparece tela branca.\n- Equipamento e sistema: computador e sistema operacional não informados.\n- O que já foi tentado: reinicia o computador, sem sucesso. Artigo da central não se aplica (só VPN).\n- Situação: afeta só ele. Tem reunião com cliente hoje às 15h que depende disso (urgência same_day). Encaminh…
  - Texto: Anotei: afeta só você, a tela branca começou hoje de manhã, e a reunião das 15h depende disso. Como o caso já está com o Suporte N1, o analista vai ver essas informações. Se quiser adiantar, me diga qual é o seu sistema operacional (Windows 10 ou 11) e se aparece alguma mensagem de erro.
- Rodada 3: a primeira resposta devia perguntar o que falta: expected false to be true // Object.is equality
  - Resposta 1, confiança 0.5: searchArticles {"query":"Teams não abre no computador"}; transferToAnalyst {"reason":"agent_unsure","summary":"Funcionário relata que o Microsoft Teams não abre no computador dele. A central de ajuda não tem artigo sobre o Teams; o único resultado era sobre VPN com erro 809, que não se aplica. Ainda não se sabe o sistema operacional, a mensagem de erro, desde quando ocorre nem se há compromisso dependendo disso.","impact":"degraded","affected":"only_me","urgency":"none"}; updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador do funcionário.\n- Equipamento e sistema: não informado (sistema operacional desconhecido).\n- O que já foi tentado: não informado. A central de ajuda não tem artigo sobre o Teams (o único resultado, VPN erro 809, não se aplica).\n- Situação: encaminhado para o Suporte N1 (agent_unsure), atendimento até 29 out, 10:05. Sem chamad…
  - Texto: Não encontrei na central de ajuda nenhum artigo sobre o Teams, então encaminhei seu caso para o Suporte N1. Um analista vai falar com você até 29 out, 10:05, e você pode continuar escrevendo por aqui que ele lê.
  - Resposta 2, confiança 0.8: updateWorkingMemory {"memory":"# Caso\n- Problema: Microsoft Teams não abre no computador do funcionário; mostra tela branca desde hoje de manhã.\n- Equipamento e sistema: não informado (sistema operacional desconhecido).\n- O que já foi tentado: reiniciou o computador. A central de ajuda não tem artigo sobre o Teams (o único resultado, VPN erro 809, não se aplica).\n- Situação: afeta só ele. Tem reunião com cliente …

### Reabrir um chamado resolvido há 8 dias vira chamado novo (1 de 3)

- Rodada 1: devia montar um chamado novo: expected [] to have a length of 1 but got +0
  - Resposta 1, confiança 0.8: getTicket {"ticketId":"INC-20150"}; updateWorkingMemory {"memory":"# Caso\n- Problema: senha do SAP bloqueou de novo (mesmo problema do INC-20150, segundo a funcionária).\n- Equipamento e sistema: SAP.\n- O que já foi tentado: ainda não verificado.\n- Situação: afeta só ela; sem compromisso hoje. Consultando INC-20150."}
- Rodada 2: devia montar um chamado novo: expected [] to have a length of 1 but got +0
  - Resposta 1, confiança 0.9: getTicket {"ticketId":"INC-20150"}; updateWorkingMemory {"memory":"# Caso\n- Problema: senha do SAP bloqueou de novo (mesmo problema do INC-20150)\n- Equipamento e sistema: SAP\n- O que já foi tentado: ainda não informado\n- Situação: afeta só ela; sem compromisso hoje. Verificando INC-20150.\n"}; listMyTickets {}
