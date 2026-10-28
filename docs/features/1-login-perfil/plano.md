# Feature 1: Login e perfil

Linha da feature: [ARQUITETURA.md, seção 10, feature 1](../../../ARQUITETURA.md#desenvolvimento-feature-por-feature).

Telas do design: "Identificação (desktop)" e "Cliente — Meu perfil (desktop)", no nexo.pen.

## Plano

1. Contratos em `packages/shared`:
   - `people.ts`: o funcionário (`id`, `name`, `email`, `department`, `passwordChangedAt`) e o analista (`id`, `name`, `email`, `level`, `available`);
   - `web-api.ts`: entrada e saída de cada rota do web desta feature, e o formato de erro `{ error: { code, message } }`, o mesmo do ticket-service.
2. Ticket-service:
   - `GET /employees?email=` devolve uma lista com zero ou um funcionário. O e-mail é comparado sem diferenciar maiúsculas e sem espaços nas pontas. E-mail inválido dá 400;
   - `GET /analysts` devolve todos os analistas;
   - o cliente em `shared` ganha `findEmployeeByEmail` e `listAnalysts`.
3. Sessão: cookie `nexo_session` HttpOnly, `SameSite=Lax`, `Secure` em produção, assinado com HMAC-SHA256 (Web Crypto, roda no Node e no proxy). Guarda `sub`, `role`, `name`, `email` e `exp`.
   - "Manter conectado" marcado: o cookie vale 30 dias e o `exp` também;
   - desmarcado: o cookie não tem validade, então some quando o navegador fecha. O `exp` fica em 12 horas, para um navegador que restaura a sessão não manter alguém logado para sempre.
4. Login (`POST /api/auth/login`): procura o e-mail entre os funcionários e os analistas ao mesmo tempo. Funcionário vai para o chat (`/`), analista para o console (`/console`). E-mail fora dos dados de exemplo devolve 401 `email_not_found` e a tela mostra "E-mail não encontrado". Qualquer senha não vazia serve. Serviço de chamados fora do ar devolve 503 `service_unavailable`.
5. `POST /api/auth/logout` apaga o cookie. `GET /api/me` devolve o usuário logado, buscado de novo no ticket-service (para trazer a data da senha). `POST /api/me/reset-password` só devolve o aviso: com sessão, usa o e-mail da sessão; sem sessão ("Esqueci minha senha"), usa o e-mail do corpo, sem dizer se ele existe.
6. Números do login (`GET /api/stats/login`), nos últimos 30 dias:
   - primeira resposta: média de `first_response_at - created_at` das conversas criadas no período;
   - resolvidos sem fila: conversas com `outcome = resolved_by_agent` sobre as encerradas no período;
   - analistas online: analistas com `available = true`.

   Cada número é independente: se o ticket-service cair, só "analistas online" vira "–". A tela de login monta os números no servidor com a mesma função da rota, dentro de um `Suspense`, para o formulário não esperar por eles.
7. Proxy (`proxy.ts`): sem sessão válida, as páginas mandam para `/login`; com sessão, `/login` manda para a página do papel; funcionário não entra em `/console` e analista não entra nas páginas do funcionário. As rotas da API conferem a sessão e o papel de novo, sem depender do proxy.
8. Telas, conferidas lado a lado com o design:
   - login: painel escuro com a chamada, a prévia da conversa e os números; formulário com e-mail, senha com mostrar e esconder, "Manter conectado" (marcado como no design), "Esqueci minha senha", "Ligue no ramal 4000" (só texto) e "Privacidade e uso de dados" (abre um texto curto). Erros aparecem no campo; avisos e falhas gerais aparecem na faixa abaixo do botão, que o design já reserva;
   - estrutura do funcionário: barra lateral com Atendimento, Meu perfil, nome, e-mail e Sair. A página Atendimento fica vazia até a feature 2;
   - Meu perfil: nome, e-mail "Gerenciado pela TI", senha "Alterada há N dias" e "Redefinir senha", que troca o texto da faixa de baixo pelo aviso de link enviado;
   - console: só a barra estreita do design com o logo, o ícone de conversas e o avatar do analista, que abre o Sair. O resto do console entra na feature 5.
9. Dados de exemplo: a senha da Ana foi alterada há 42 dias, como no design, e o tempo da primeira resposta das conversas fica em 8 segundos em média.
10. Testes: contratos e cliente (shared), rotas novas do ticket-service, sessão, formatação, números do login, cada rota do web e o proxy (Vitest), e o fluxo inteiro no navegador (Playwright).

## Fica de fora

- O conteúdo do chat (feature 2) e do console (feature 5), inclusive "Assistente online", "Disponível" e `PATCH /api/console/me`.
- Envio de e-mail de verdade na redefinição de senha.
- Senha de verdade: qualquer senha serve.
- Voltar para a página pedida depois do login: o usuário sempre cai na página do papel.
