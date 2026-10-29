# Feature 2: Conversa com o agent

Linha da feature: [ARQUITETURA.md, seção 10, feature 2](../../../ARQUITETURA.md#desenvolvimento-feature-por-feature). História: Funcionário 1, tirar uma dúvida sem precisar abrir chamado.

Telas do design: "Chat — Novo chamado (desktop)" e "Chat — Consulta de chamado (desktop)", no nexo.pen. Desta feature saem a barra com "Assistente online", as mensagens do funcionário e do agent, a linha de ações acima de cada resposta, a caixa de mensagem e o contador. Os cards de chamado, a lista selecionável, as opções rápidas e o rascunho ficam para as features 3 e 4.

## Plano

1. Contratos em `packages/shared`:
   - `help-center.ts`: o artigo da central de ajuda (`id`, `title`, `content`, `category`);
   - `chat.ts`: o limite de 30 mensagens, a entrada do `POST /api/chat` (o id que o chat deu à mensagem e o texto, de 1 a 2.000 caracteres), o registro de decisão que o agent preenche (`understanding`, `action`, `confidence` de 0 a 1, `reason`), a decisão gravada (`record` nulo no registro reduzido, mais `toolsUsed`), a entrada e a saída de cada ferramenta desta feature, a parte `data-conversation` do stream, a mensagem do chat (`NexoUIMessage`, com as ferramentas tipadas pelos mesmos schemas) e a resposta do `GET /api/conversation`.
2. Ticket-service: `GET /kb/search?q=` devolve até 3 artigos, do mais para o menos parecido. A busca não liga para maiúsculas nem acentos ("ferias" acha "férias"), ignora palavras como "o", "de" e "meu", e pontua assim: palavra-chave do artigo inteira na pergunta vale 3, palavra da pergunta no título vale 2, no texto vale 1. Sem nada parecido, a lista vem vazia. O cliente em `shared` ganha `searchArticles`.
3. O agent em `packages/agent`, montado por uma função que recebe o modelo, a memória e o cliente do ticket-service, para os testes trocarem o modelo por um simulado:
   - `recordDecision`: obrigatória no primeiro passo (`prepareStep` com `toolChoice` nela no passo 0). Só devolve que gravou; quem grava é a rota, no fim;
   - `searchArticles`: busca na central de ajuda. Se o ticket-service não responder, devolve `{ ok: false }` e o agent diz isso ao funcionário;
   - `redirectOutOfScope`: para RH, financeiro e facilities, busca o artigo do canal da área na central de ajuda, pelo id dele (os canais estão nos dados de exemplo), e o agent indica para onde ir;
   - memória do Mastra no banco das conversas: thread = id da conversa, resource = id do funcionário, as últimas 20 mensagens e a memória de trabalho da conversa;
   - limites explícitos: até 5 passos, até 800 tokens de saída por passo, 45 s no total;
   - modelo `anthropic/claude-haiku-5-5`. Com `NEXO_AGENT_MODEL=simulated` entra um modelo simulado, com regras fixas, usado no Playwright e para rodar sem chave.
4. `POST /api/chat` (só funcionário):
   - num batch só (uma ida ao banco, sem segurar a trava de escrita entre comandos), acha a conversa ativa ou cria uma, grava a mensagem do funcionário com o id que veio do chat e recalcula o contador pelas mensagens gravadas. Reenviada com o mesmo id ("Tentar de novo"), a mensagem é respondida sem ser gravada nem contada de novo. Um id que já é de outra conversa recebe 409;
   - conversa fora de `with_agent` devolve 409 e o LLM não é chamado (a gravação dessa mensagem e a cópia para a memória entram na feature 5);
   - responde em partes: primeiro `data-conversation` (id, estado e contador), depois o stream do agent no formato do AI SDK v7;
   - no fim, grava a mensagem do agent com as partes que saíram no stream (menos o contador) e a decisão, lida dessas partes. `toolsUsed` são as ferramentas que rodaram, na ordem, sem repetir e sem as internas da memória. Sem `recordDecision` válido, grava o registro reduzido (só `toolsUsed`). A primeira resposta da conversa marca `first_response_at`;
   - a resposta é gravada mesmo que a aba feche: uma cópia do stream é lida até o fim no servidor e a rota espera a gravação com `after()`;
   - se o modelo falhar, o stream termina com um erro curto em português e nada do agent é gravado.
5. `GET /api/conversation` (só funcionário): a conversa ativa, com estado e contador, e as mensagens no formato do chat, em duas consultas. A resposta do agent volta com as partes gravadas, então a tela desenha igual ao vivo e depois de recarregar. Sem conversa ativa, devolve `conversation: null` e a lista vazia. A página monta o mesmo dado no servidor, com a mesma função, para abrir pronta.
6. Banco das conversas: índice único em `decisions.message_id` (uma decisão por mensagem) e `understanding` e `action` sem obrigatoriedade, para o registro reduzido não guardar texto vazio.
7. Tela de Atendimento, conferida lado a lado com o design:
   - barra com "Assistente online" à direita;
   - mensagens do funcionário (bolha escura à direita, até 520 px) e do agent ("Nexo Assist", a linha de ações e a bolha branca de 600 px), na coluna de 808 px do design;
   - a linha de ações cresce enquanto as ferramentas rodam, e o detalhe da decisão abre a partir dela (formato definido com o design-engineer, já que o design não desenha o detalhe);
   - caixa "Escreva para o Nexo…" com Enviar e o contador "N/30 mensagens nesta sessão";
   - estados: conversa vazia, carregando a página, agent pensando, resposta chegando, falha do agent, falha de rede e central de ajuda fora do ar.
   - no celular (abaixo de 768 px), a barra lateral vira uma gaveta aberta pelo menu, e o chat usa a largura toda.
8. Testes: contratos (shared), busca da central de ajuda e rota nova (ticket-service), resumo da decisão, ferramentas, passo obrigatório e memória com o modelo simulado (agent), as duas rotas com o agent de verdade e o LLM simulado (web), o mapa da tela (web) e o fluxo inteiro no navegador com o modelo simulado (Playwright).

## Fica de fora

- Chamados: listar, consultar, card, rascunho e opções rápidas (features 3 e 4).
- Transferência, inclusive a transferência obrigatória com confiança abaixo de 0,6, e o que acontece com mensagens enquanto a conversa não está com o agent (feature 5).
- O limite de 30 em si (aviso, transferência ou encerramento) e encerrar a conversa como "resolvida pelo agent" (feature 6). Aqui o contador só conta.
- Os tetos de uso por IP e global (deploy).
- Os testes do agent com o modelo real (`pnpm eval`), que entram nos testes de ponta a ponta da seção 10.
