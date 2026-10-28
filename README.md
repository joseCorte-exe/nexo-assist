# Nexo Assist

Desafio técnico da Beyond the Bytes. A arquitetura e as decisões estão em [ARQUITETURA.md](ARQUITETURA.md).

## Como rodar

Precisa de Node 22.13 ou mais novo e pnpm 11.

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:seed` recria os dados de exemplo com datas relativas a hoje. `pnpm test` roda os testes.

O web sobe em http://localhost:3000 e o ticket-service em http://localhost:3001.
