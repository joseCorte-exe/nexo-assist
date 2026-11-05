# Feature 6: Continuidade e limite

Linha da feature: [ARQUITETURA.md, seção 10, feature 6](../../../ARQUITETURA.md#desenvolvimento-feature-por-feature). História: Funcionário 6, voltar outro dia e continuar de onde parou. O PRD também pede o limite de 30 mensagens por sessão, e a seção 1 da arquitetura diz o que acontece nele: aviso, analista se ainda houver algo pendente, encerramento se não houver, e a próxima mensagem abre uma conversa nova.

O nexo.pen não tem quadro para nenhum destes estados. Eles saem das peças que já existem (a nota centrada, a pílula do dia do console, a linha de espera, o contador) e foram decididos com o design-engineer.

## Regras

| Regra | Onde fica |
|---|---|
| O contador conta só as mensagens dela na conversa. A 30ª é respondida como qualquer outra; o limite vale logo depois dela | `POST /api/chat` |
| Pendente é: um rascunho esperando confirmação, a última mensagem dela sem resposta, ou a última resposta do Nexo esperando a dela (as respostas rápidas, a lista de chamados ou uma pergunta) | `pendingAtLimit`, em `continuity.ts` do `shared` |
| No limite, com o agent: havendo algo pendente, a conversa vai para um analista pela regra de sempre (crítico ou vencido no N2, o resto no N1), com o motivo "limite de mensagens" e um resumo que o código monta do caso; sem nada pendente, ela é encerrada com o desfecho `limit_reached` | `applyLimit`, no web |
| O chamado do caso é o do rascunho pendente ou o último que o Nexo consultou na resposta; a classificação, a do rascunho novo. O modelo não decide nada no limite | `caseAtLimit`, no `shared` |
| No limite, com um analista (esperando ou atendendo): a conversa fica com ele e ela continua escrevendo para a pessoa, sem o modelo. O analista não pode mais devolver ao agent, só encerrar | `applyLimit` e o movimento `release` |
| O aviso é uma nota, gravada uma vez só, no mesmo batch da mudança, e copiada para a memória do agent | `conversation-moves.ts` |
| Uma mensagem nova numa conversa com o agent que já bateu o limite, sem que ele tenha sido aplicado (a 30ª ficou sem resposta), aplica o limite antes e segue para onde a conversa foi | `POST /api/chat` |
| Voltar outro dia: a conversa ativa continua como estava. Se a mensagem anterior a dela é de outro dia (São Paulo), o agent recebe na memória uma nota "(retomada)" dizendo desde quando, para consultar de novo o que pode ter mudado | `resumeNote`, em `packages/agent`, e `POST /api/chat` |
| Sem conversa ativa, o chat mostra a última que terminou, com o fim dela; a próxima mensagem abre uma nova, que substitui a anterior na tela | `loadConversation` e o chat |

## Plano

1. `packages/shared`: `continuity.ts` (o pendente, o caso no limite e o resumo para o analista); o motivo `message_limit` na transferência; a nota `limit_reached`; `limitReached` na conversa como o chat a vê; a hora de cada mensagem salva, para as pílulas de dia.
2. Web: a coluna `limit_reached_at` (migração 0006) e o índice da última conversa da pessoa; o movimento do limite e a recusa do `release`; `applyLimit`; o `POST /api/chat` aplicando o limite e a retomada; `loadConversation` caindo na última encerrada.
3. Agent: a instrução da nota "(retomada)"; o modelo simulado responde "(retomada)" como qualquer turno.
4. Telas: o aviso, o contador perto do fim e depois do limite, o fim da conversa com "Nova conversa", as pílulas de dia no chat e o "Devolver ao agent" travado no console.
5. Testes: regras puras (shared), movimentos e `applyLimit` com banco em memória, rota do chat do 29º ao 31º turno, as corridas, e a história inteira no navegador.

## Fica de fora

- O teto por IP e o global por dia (seção 9). Eles são do deploy.
- O desfecho `resolved_by_agent` vindo de uma confirmação dela. Ele continua vindo dos dados de exemplo.
