<p align="center">
  <img src="logo.jpg" alt="Q-Zap logo" width="420">
</p>

# Q-Zap

Serviço de envio automático de documentos (notas fiscais, boletos, etc.) gerados por sistemas ERP legados para clientes via WhatsApp, usando a Evolution API.

Resolve a falta de integração nativa com WhatsApp em sistemas antigos: o ERP apenas salva o documento em uma pasta, e o Q-Zap cuida de identificar o cliente e enviar o arquivo automaticamente, sem exigir nenhuma alteração no ERP.

## Status atual

Etapas 1 a 10 do [`docs/DEV_PLAN.md`](./docs/DEV_PLAN.md) concluídas: fluxo completo (extração de marcador, watcher, envio via Evolution API, anti-ban, retry/circuit breaker, logging, testes end-to-end) rodando como serviço do Windows. Falta só a Etapa 11 (instalador/desinstalador de um comando só para clientes novos).

## Como funciona (resumo)

1. O ERP (via editor de relatórios, ex: Crystal Reports) salva um PDF na pasta monitorada. O nome do arquivo é irrelevante; o PDF pode conter o documento de um único cliente ou, em geração em lote (ex: boletos do mês), os documentos de vários clientes concatenados.
2. O Q-Zap extrai, da camada de texto de cada página, um marcador no formato `$Q-Zap=numero|nome$`, e agrupa páginas consecutivas com o mesmo marcador em um documento por cliente.
3. Se uma página não tiver marcador válido (ausente, malformado ou com dado inválido), apenas aquele documento é movido para uma pasta de erro, sem afetar os demais do mesmo lote.
4. Para cada documento identificado, o Q-Zap monta uma mensagem a partir de um template configurável e envia o documento como anexo pelo WhatsApp, via Evolution API rodando localmente.
5. Após o envio confirmado, o documento é movido para uma pasta de enviados; quando todos os documentos de um arquivo de entrada forem concluídos, o arquivo original é movido para uma pasta de processados.

O envio segue um conjunto de regras de throttling e comportamento (delay entre mensagens, indicador de digitação, limite diário, circuit breaker em caso de instabilidade) para reduzir o risco de bloqueio do número no WhatsApp.

## Documentação

- [`docs/Contexto.md`](./docs/Contexto.md) — contexto e motivação inicial do projeto.
- [`docs/PRD.md`](./docs/PRD.md) — requisitos funcionais e não funcionais, escopo, fluxo do sistema e critérios de aceite.
- [`docs/DEV_PLAN.md`](./docs/DEV_PLAN.md) — etapas de desenvolvimento planejadas, da configuração inicial ao instalador para novos clientes.
- [`docs/WHATSAPP_EVOAPI_ANTIBAN_GUIDELINES.md`](./docs/WHATSAPP_EVOAPI_ANTIBAN_GUIDELINES.md) — regras de referência para uso seguro da Evolution API, usadas como base para as proteções anti-ban do projeto.

## Stack

- Node.js (runtime)
- Evolution API, rodando localmente via Docker, na mesma máquina do Q-Zap

Detalhes de bibliotecas e decisões de configuração estão em [`docs/DEV_PLAN.md`](./docs/DEV_PLAN.md).

## Instalação

Instalador de um comando só (Etapa 11) ainda não implementado. O objetivo definido no PRD é que a instalação em uma máquina nova exija apenas executar um único comando e responder a algumas perguntas feitas por ele (pasta base, número administrador, limite diário), sem precisar editar o `.env` manualmente, além do pareamento inicial do WhatsApp via QR code. Ver Etapa 11 em [`docs/DEV_PLAN.md`](./docs/DEV_PLAN.md).

Até lá, a instalação é manual: subir a Evolution API (`docker-compose up -d`), preencher o `.env` a partir do `.env.example`, rodar `npm install` e então instalar o serviço do Windows (abaixo).

## Executando como serviço do Windows

Com o `.env` preenchido e a Evolution API pareada (Etapa 1), o Q-Zap roda em segundo plano como um serviço nativo do Windows, sobrevivendo a reinícios da máquina:

- Instalar e iniciar o serviço (terminal com privilégios de administrador):
  ```
  npm run servico:instalar
  ```
- Remover o serviço:
  ```
  npm run servico:desinstalar
  ```

O serviço aparece no utilitário "Serviços" do Windows com o nome `Q-Zap` e também pode ser controlado por `NET START Q-Zap` / `NET STOP Q-Zap` ou pelo utilitário `sc`. Reinício automático em caso de falha é gerenciado pelo próprio `node-windows` (backoff crescente entre tentativas, limite de tentativas por janela de 60s).

O container Docker da Evolution API já sobe automaticamente com o Windows desde a Etapa 1 (`restart: always` no `docker-compose.yml`), sem passo adicional.

## Operação

- **Logs da aplicação**: `PASTA_BASE/logs/q-zap.<data>.<N>.log` (rotação diária). Logs do wrapper do serviço (start/stop/erros do processo em si) ficam em `src/daemon/` e no Visualizador de Eventos do Windows.
- **Erros**: `PASTA_BASE/erro/log.txt` (uma linha por documento com erro, formato `<documento> - <motivo>`) e os PDFs correspondentes em `PASTA_BASE/erro/`.
- **Pausar/retomar (circuit breaker)**: o sistema pausa sozinho o envio (não a leitura de novos arquivos) em caso de desconexão da Evolution API ou erros consecutivos, gravando `PASTA_BASE/status.txt` com o motivo. Para retomar manualmente, crie um arquivo vazio `RETOMAR.txt` na raiz da `PASTA_BASE`; o Q-Zap detecta, retoma o processamento, remove os dois arquivos sentinela e envia ao número administrador um resumo do período pausado.
- **Configuração**: `template.txt` é lido a cada envio, editável sem reiniciar o serviço. Alterações no `.env` exigem reiniciar o serviço (`npm run servico:desinstalar && npm run servico:instalar`, ou pelo utilitário de Serviços do Windows).

## Estrutura de dados esperada

- Marcador `$Q-Zap=numero|nome$` embutido na camada de texto de cada página do PDF (via template do editor de relatórios do ERP) — não há mais cadastro externo de clientes.
- `template.txt` — texto da mensagem enviada junto com o documento, com placeholder `{nome}`.
- `.env` — configuração operacional (`PASTA_BASE`, acesso à Evolution API, delays, limites, número administrador). As subpastas `entrada/`, `enviados/`, `erro/`, `processado/` e `logs/` são criadas automaticamente dentro de `PASTA_BASE`.

## Escopo da v1

Fora do escopo por enquanto: integração direta com o ERP, tratamento de respostas dos clientes no WhatsApp, interface gráfica de administração, opt-in/opt-out formal, múltiplos números em rotação e migração para a Meta Cloud API oficial. Detalhes em [`docs/PRD.md`](./docs/PRD.md).
