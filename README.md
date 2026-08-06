# DocSender

Serviço de envio automático de documentos (notas fiscais, boletos, etc.) gerados por sistemas ERP legados para clientes via WhatsApp, usando a Evolution API.

Resolve a falta de integração nativa com WhatsApp em sistemas antigos: o ERP apenas salva o documento em uma pasta, e o DocSender cuida de identificar o cliente e enviar o arquivo automaticamente, sem exigir nenhuma alteração no ERP.

## Status atual

Projeto em fase de planejamento. Requisitos e etapas de desenvolvimento já definidos; implementação ainda não iniciada.

## Como funciona (resumo)

1. O ERP salva um PDF na pasta monitorada, nomeado como `{codCliente}-{identificador}.pdf` (ex: `3424-nf1034.pdf`).
2. O DocSender detecta o arquivo, extrai o código do cliente do nome e busca esse código em um cadastro local (`cadastro.txt`).
3. Se o código não for encontrado, o arquivo é movido para uma pasta de erro.
4. Se encontrado, o DocSender monta uma mensagem a partir de um template configurável e envia o documento como anexo pelo WhatsApp, via Evolution API rodando localmente.
5. Após o envio confirmado, o arquivo é movido para uma pasta de enviados.

O envio segue um conjunto de regras de throttling e comportamento (delay entre mensagens, indicador de digitação, limite diário, circuit breaker em caso de instabilidade) para reduzir o risco de bloqueio do número no WhatsApp.

## Documentação

- [`docs/Contexto.md`](./docs/Contexto.md) — contexto e motivação inicial do projeto.
- [`docs/PRD.md`](./docs/PRD.md) — requisitos funcionais e não funcionais, escopo, fluxo do sistema e critérios de aceite.
- [`docs/DEV_PLAN.md`](./docs/DEV_PLAN.md) — etapas de desenvolvimento planejadas, da configuração inicial ao instalador para novos clientes.
- [`docs/WHATSAPP_EVOAPI_ANTIBAN_GUIDELINES.md`](./docs/WHATSAPP_EVOAPI_ANTIBAN_GUIDELINES.md) — regras de referência para uso seguro da Evolution API, usadas como base para as proteções anti-ban do projeto.

## Stack

- Node.js (runtime)
- Evolution API, rodando localmente via Docker, na mesma máquina do DocSender

Detalhes de bibliotecas e decisões de configuração estão em [`docs/DEV_PLAN.md`](./docs/DEV_PLAN.md).

## Instalação

Ainda não implementada. O objetivo definido no PRD é que a instalação em uma máquina nova exija apenas preencher um arquivo `.env` e executar um único comando, além do pareamento inicial do WhatsApp via QR code. Ver Etapa 11 em [`docs/DEV_PLAN.md`](./docs/DEV_PLAN.md).

## Estrutura de dados esperada

- `cadastro.txt` — um cliente por linha, no formato `cod;nome;numero`.
- `template.txt` — texto da mensagem enviada junto com o documento, com placeholder `{nome}`.
- `.env` — configuração operacional (pastas de entrada/erro/enviados, acesso à Evolution API, delays, limites).

## Escopo da v1

Fora do escopo por enquanto: integração direta com o ERP, tratamento de respostas dos clientes no WhatsApp, interface gráfica de administração, opt-in/opt-out formal, múltiplos números em rotação e migração para a Meta Cloud API oficial. Detalhes em [`docs/PRD.md`](./docs/PRD.md).
