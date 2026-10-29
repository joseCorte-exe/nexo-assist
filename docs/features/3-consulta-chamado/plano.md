# Feature 3: Consulta de chamado

Linha da feature: [ARQUITETURA.md, seção 10, feature 3](../../../ARQUITETURA.md#desenvolvimento-feature-por-feature). História: Funcionário 2, saber como está um chamado meu, mesmo sem lembrar o número, e saber se ele está atrasado.

Tela do design: "Chat — Consulta e transferência (desktop)", no nexo.pen. Desta feature saem a lista selecionável dos chamados, o card do chamado, o vencido e a oferta de chamar um analista com as opções rápidas. O card e as opções rápidas têm a mesma forma do rascunho e das perguntas da tela "Chat — Novo chamado", e a feature 4 reaproveita os dois.

## Plano

1. Contratos em `packages/shared`:
   - `tickets.ts`: a atualização do chamado (`author`, `text`, `createdAt`) e o detalhe do chamado (o chamado, o nome de quem assumiu e as atualizações, da mais antiga para a mais recente);
   - `sla.ts`: o prazo de cada prioridade em palavras ("1 hora", "4 horas úteis", "3 dias úteis", "5 dias úteis"), o mesmo texto para o agent e para a tela;
   - `chat.ts`: entrada e saída de quatro ferramentas novas e o id de chamado (`INC-` ou `REQ-` com 5 dígitos, maiúsculo):
     - `listMyTickets`: os chamados do funcionário, abertos ou todos, com id, título, status, abertura e se está vencido;
     - `getTicket`: o card do chamado (tipo, título, descrição, categoria, subcategoria, prioridade, status, quem assumiu, abertura, última atualização, prazo, vencido, dias sem atualização, o prazo da prioridade em palavras, a última atualização da TI e o momento da consulta);
     - `offerTicketChoice`: a lista selecionável, com os chamados que o agent escolheu mostrar;
     - `offerReplies`: de 2 a 4 respostas rápidas, de até 40 caracteres.
2. Ticket-service:
   - `GET /employees/:id/tickets?status=open` devolve os chamados do funcionário, do mais recente para o mais antigo. `status=open` deixa de fora os resolvidos; sem `status`, vêm todos. Funcionário que não existe dá 404;
   - `GET /tickets/:id?employeeId=` devolve o detalhe. Um chamado que não existe e um chamado de outra pessoa dão o mesmo 404, para ninguém descobrir pelo erro que o número existe. Sem `employeeId`, 400;
   - índice em `tickets (opened_by, created_at)`, que atende as duas buscas por funcionário sem varrer a tabela;
   - o cliente em `shared` ganha `listEmployeeTickets` e `getTicket`, que devolve `null` no 404.
3. O agent:
   - o id do funcionário chega às ferramentas pelo `requestContext` do Mastra, validado por schema e montado pela rota com o id da sessão. O modelo nunca escolhe de quem são os chamados;
   - `listMyTickets` e `getTicket` calculam o vencido com o RN-02 do `shared` e o relógio injetado, e mandam ao modelo números já prontos (dias sem atualização, prazo em palavras), para ele não fazer conta de data;
   - `offerTicketChoice` busca de novo os chamados do funcionário e mostra só os que são dele, na ordem do serviço. Um id de outra pessoa é descartado em silêncio;
   - `offerReplies` só mostra as opções;
   - as duas ferramentas de oferta terminam a resposta (`stopWhen`): o funcionário responde clicando, e o modelo não é chamado de novo à toa;
   - instruções: consulta sem número lista os chamados; com um só aberto, consulta direto; com vários, pergunta qual com a lista; com o número, consulta direto. Chamado vencido ganha a oferta de chamar um analista com "Falar com um analista", "Adicionar informação" e "Não, obrigado". Enquanto a transferência (feature 5) e o complemento (feature 4) não existem, o agent diz com franqueza que ainda não faz isso pelo chat e indica o ramal 4000;
   - o modelo simulado ganha as mesmas regras, para o Playwright e para rodar sem chave.
4. `POST /api/chat` passa o id da sessão no `requestContext`. `GET /api/conversation` confere as partes novas contra os mesmos schemas.
5. Tela de Atendimento, conferida lado a lado com o design:
   - a linha de ações ganha "consultou seus chamados", "consultou o INC-20311" e "calculou o prazo";
   - a resposta desenha as partes na ordem em que chegaram: texto em bolha, card do chamado quando `getTicket` responde. A lista selecionável vem depois do texto, e as respostas rápidas ficam dentro da última bolha;
   - lista selecionável: número, título, status com a cor do design e a data de abertura. O clique manda "INC-20311 · título" como mensagem do funcionário;
   - card do chamado: "Chamado · INC-20311", status, título, descrição, e Categoria, Prioridade, Aberto em e Última atualização, com "há N dias · prazo vencido" em âmbar quando vencido e "· no prazo" quando não;
   - o escolhido fica marcado (a lista e a opção) e sai da mensagem seguinte do funcionário, então é o mesmo ao vivo e depois de recarregar. Só a última resposta aceita clique, e só quando o agent não está respondendo;
   - estados: consultando, chamado não encontrado, serviço de chamados fora do ar e sem chamados abertos.
6. Dados de exemplo: o chamado do SharePoint passa a ser o INC-20298, o número que o design usa no chat e no console. A descrição do INC-20311 fica igual à do design, sem a data fixa.
7. Testes: contratos e prazo em palavras (shared), as duas rotas novas com privacidade e índice (ticket-service), as ferramentas com o funcionário vindo do contexto, o fim da resposta nas ofertas e o modelo simulado (agent), a rota do chat com o contexto (web), a leitura das partes para a tela e a escolha marcada (web) e o fluxo inteiro no navegador (Playwright).

## Fica de fora

- Transferir de verdade para um analista e o que acontece depois (feature 5). Aceitar a oferta, por enquanto, recebe a resposta franca com o ramal 4000.
- Complementar o chamado (feature 4). "Adicionar informação" recebe a mesma resposta franca.
- A pergunta em negrito acima das opções rápidas, que só aparece na abertura de chamado (feature 4).
- O título curto que o design mostra na lista ("Notebook lento após atualização"): a lista usa o título do chamado, que é o do Anexo B.
- Os testes do agent com o modelo real (`pnpm eval`), que entram nos testes de ponta a ponta da seção 10.
