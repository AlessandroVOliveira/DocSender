# Plano de Desenvolvimento — Q-Zap

Stack definida: **Node.js** (LTS), com `chokidar` (monitoramento de pasta), `axios`/`fetch` (chamadas à Evolution API), `dotenv` (config), `pdfjs-dist` (extração de texto por página de PDF), `pdf-lib` (recorte/geração de PDF por grupo de páginas) e um logger estruturado (`pino`). `pdfjs-dist` e `pdf-lib` foram escolhidos por serem 100% JS, sem dependência nativa — evita exigir build tools (`node-gyp`, Visual Studio Build Tools) na máquina do cliente, o que quebraria a instalação de um comando só (RNF08).

Decisões de config assumidas para v1 (podem ser revisadas):
- `.env` para configuração operacional (`PASTA_BASE`, credenciais/URL da Evolution API, delays, limite diário, máx. de tentativas de retry, número administrador).
- `PASTA_BASE` é a única configuração de caminho. As subpastas `entrada/`, `enviados/`, `erro/`, `processado/` e `logs/` são derivadas por convenção e criadas automaticamente (idempotente, `mkdir recursive`) toda vez que o serviço inicia — não só na instalação.
- `template.txt` separado para a mensagem padrão, editável sem mexer em código/`.env`.
- Identificação do cliente via marcador embutido no PDF (`$Q-Zap=numero|nome$`) — não existe mais cadastro externo de clientes na v1. O `$` final é o terminador do campo `nome` (ver Etapa 2 — necessário porque a extração de texto do `pdfjs-dist` não preserva quebras de linha entre "text runs", então o nome precisa de um limite explícito em vez de depender de fim de linha).
- Máximo de tentativas de retry por envio: 3 (configurável).
- Logger: `pino`, arquivo local com rotação diária.
- v1 suporta apenas arquivos `.pdf`.
- Alertas: `erro/log.txt` (local, sempre disponível) + resumo por WhatsApp ao número administrador ao final de cada arquivo processado. Sem e-mail/SMTP na v1.
- Chave da Evolution API gerada nativamente em PowerShell no `install.ps1` (sem dependência de Python/outro runtime) e sincronizada automaticamente entre o `.env` do Q-Zap e o `docker-compose.yml` da Evolution API.
- Webhook de status de conexão (RF13) escuta em `127.0.0.1` (bind explícito, nunca `0.0.0.0`, reforçando que nada é acessado de fora mesmo que o firewall da máquina esteja mal configurado).

### Variáveis de `.env`

| Variável | Descrição | Default |
|---|---|---|
| `PASTA_BASE` | Pasta raiz de trabalho; subpastas (`entrada/`, `enviados/`, `erro/`, `processado/`, `logs/`) derivadas automaticamente | obrigatória, sem default |
| `EVOLUTION_API_URL` | URL local da instância Evolution API | `http://localhost:8080` |
| `EVOLUTION_API_KEY` | Chave de autenticação da instância | gerada automaticamente no deploy (Etapa 11) |
| `EVOLUTION_INSTANCE` | Nome da instância dentro da Evolution API | `Q-Zap` (fixo) |
| `WEBHOOK_PORT` | Porta local onde o Q-Zap escuta o webhook de status de conexão (RF13) | `3939` |
| `NUMERO_ADMIN` | Número que recebe os resumos de envio/erro (RF18) | obrigatória, sem default |
| `DELAY_MIN_SEC` / `DELAY_MAX_SEC` | Faixa de delay aleatório entre envios consecutivos (RF09) | `5` / `15` |
| `TYPING_BASE_MS` / `TYPING_MS_POR_CARACTER` / `TYPING_MAX_MS` | Fórmula de duração do indicador "digitando" (RF10): `min(BASE + tamanho_mensagem * MS_POR_CARACTER, MAX) + jitter` | `1500` / `40` / `8000` |
| `LIMITE_DIARIO_POR_NUMERO` | Limite diário de mensagens enviadas por número (RF11) | a definir por cliente na instalação |
| `RETRY_MAX_TENTATIVAS` | Máximo de tentativas de envio antes de considerar erro (RF12) | `3` |
| `RETRY_BASE_MS` / `RETRY_MAX_MS` | Backoff exponencial (RF12): `delay(tentativa) = min(BASE * 2^(tentativa-1), MAX) + jitter`. Sequência com os defaults: ~5s → ~10s → ~20s | `5000` / `60000` |
| `LOG_LEVEL` | Nível de verbosidade do `pino` (`trace`<`debug`<`info`<`warn`<`error`<`fatal`; cada nível loga a si e os mais severos) | `info` |
| `POSTGRES_PASSWORD` | Senha do Postgres usado internamente pela Evolution API (v2 exige banco Prisma/Postgres para persistência de instância, não há mais modo só-arquivo) — usada tanto no `.env` do Q-Zap quanto no `docker-compose.yml` | obrigatória, sem default; gerada nativamente no `install.ps1` (Etapa 11), mesmo mecanismo do `EVOLUTION_API_KEY` |

---

## Etapa 1 — Setup do projeto e infraestrutura local
- Subir a Evolution API localmente via Docker/docker-compose, na mesma máquina do Q-Zap. Imagem `evoapicloud/evolution-api:latest` (o projeto foi renomeado de `atendai/evolution-api`, que não existe mais no Docker Hub). A v2 exige PostgreSQL para persistência de instância (Prisma, sem modo só-arquivo como na v1) — container `postgres:15` adicional no mesmo compose, mesma máquina (RNF06 já aceita ponto único de falha). Redis é opcional na v2 e fica desligado (`CACHE_REDIS_ENABLED=false`) para não adicionar um terceiro container sem necessidade.
- Pareamento via QR pode falhar silenciosamente (nenhum erro do lado do servidor após várias rotações de QR) se houver muitas tentativas em pouco tempo — o WhatsApp aplica rate limiting anti-abuso nesse padrão (mensagem no celular: "erro ao conectar, tente mais tarde"). Não é bug da Evolution API nem da rede (validado: conectividade WS ao WhatsApp ok, IP não é datacenter/proxy, mesma imagem já funcionou em outro projeto na mesma máquina). Se acontecer: parar de tentar, esperar ao menos 30-60 min, então desconectar a instância (botão de logout no manager) antes de reiniciar e gerar um QR novo.
- Configurar API key/instância e realizar o pareamento inicial via QR code.
- Configurar volume Docker para persistir a sessão autenticada entre reinícios (RNF07) — validar reiniciando o container e confirmando que não pede novo QR code.
- Inicializar repositório e `package.json`.
- Estrutura de pastas do código-fonte: `src/`, `config/`.
- Instalar dependências base: `chokidar`, `axios`, `dotenv`, `pino`, `pdfjs-dist`, `pdf-lib`.
- Módulo de bootstrap que lê `PASTA_BASE` do `.env` e garante (cria se faltar) as subpastas `entrada/`, `enviados/`, `erro/`, `processado/`, `logs/` a cada início da execução.
- `.env.example` com todas as variáveis da tabela acima, já com os defaults preenchidos (exceto `PASTA_BASE`, `EVOLUTION_API_KEY` e `NUMERO_ADMIN`, que não têm default seguro).

**Entrega**: Evolution API rodando localmente e conectada ao WhatsApp (sessão persistente), projeto Node roda `node src/index.js` sem erro (mesmo sem lógica ainda).

## Etapa 2 — Extração de marcador e agrupamento de páginas
- Módulo que abre um PDF (`pdfjs-dist`) e extrai o texto de cada página individualmente via `getTextContent()`.
- Antes do parse, normalizar o texto da página colapsando espaços/quebras de linha (`texto.replace(/\s+/g, ' ')`), já que a extração pode inserir espaçamento irregular entre os "text runs" do PDF.
- Parser do marcador com regex tolerante: `/\$\s*Q-Zap\s*=\s*([\d\-\s()]+)\|\s*([^$]+)\$/i`, buscando a primeira ocorrência em qualquer posição do texto da página (a ordem de extração não é garantida seguir a ordem visual). O `nome` é delimitado por um `$` de fechamento (formato `$Q-Zap=numero|nome$`), não por quebra de linha — `pdfjs-dist` (`getTextContent()`) concatena os "text runs" da página sem inserir `\n` real entre eles, então `[^\n\r]+` nunca encontraria um limite e capturaria o resto do texto visível da página inteira como se fosse o nome (validado empiricamente contra `testes/relatorio teste.pdf .pdf`).
- Sanitização do número: remover tudo que não é dígito (`numero.replace(/\D/g, '')`) — o campo já vem com máscara/hífen do banco do ERP antes de ser salvo no relatório, então a extração nunca deve assumir formato limpo.
- Validação do número sanitizado (tamanho/formato esperado pela Evolution API, DDI+DDD+número).
- Agrupamento de páginas consecutivas com o mesmo marcador em "documentos" lógicos (lista de grupos: `{ numero, nome, paginas: [...] }`).
- Páginas sem marcador válido, ou com dado inválido (ex: número fora do tamanho esperado após sanitização), viram grupos de erro isolados — não abortam o restante do arquivo.
- Geração de um PDF por grupo (via `pdf-lib`, `copyPages` + `addPage`), a partir das páginas originais.

**Entrega**: dado um PDF (documento único ou lote com vários clientes), o sistema retorna a lista de documentos identificados corretamente (com PDF individual gerado) e a lista de grupos de erro, cobrindo o caso de 1 página só e o caso de várias páginas por cliente.

## Etapa 3 — Watcher de pasta + fila
- `chokidar` monitorando a pasta de entrada.
- Verificação de estabilização do arquivo (tamanho estável por X ms) antes de processar — evita pegar arquivo que o ERP ainda está escrevendo.
- Fila interna simples (array/FIFO) de documentos (não de arquivos — um arquivo de entrada em lote gera N itens de fila), processada um item por vez, nunca em paralelo.

**Entrega**: arquivos novos na pasta entram na fila corretamente como documentos individuais (já divididos pela Etapa 2), mesmo se vários arquivos chegarem ao mesmo tempo ou um arquivo contiver múltiplos clientes.

## Etapa 4 — Integração básica com Evolution API
- Cliente HTTP para: enviar mensagem de texto, enviar mídia/documento, disparar indicador de presença ("digitando").
- Verificação de conectividade/status da instância local no início da execução, com espera e nova tentativa caso ainda não esteja pronta em vez de falhar de imediato (RF16) — relevante especialmente no boot da máquina, quando o container da Evolution API pode ainda estar subindo.
- Teste manual isolado (fora da fila) contra a instância local da Evolution API.

**Entrega**: envio manual de uma mensagem + anexo funciona ponta a ponta para um número de teste; sistema aguarda corretamente se a Evolution API ainda não estiver pronta.

## Etapa 5 — Fluxo principal (ligar tudo)
- Watcher → extração/agrupamento de marcadores (Etapa 2) → fila de documentos → template com `{nome}` (do marcador) → envio → mover PDF do documento.
- Documento sem marcador válido → move o PDF do grupo para `erro/` (RF05).
- Documento enviado com sucesso → move o PDF do grupo para `enviados/` (RF08).
- Quando todos os documentos de um arquivo de entrada forem concluídos (enviados e/ou em erro), mover o arquivo original para `processado/`.
- Mensagem e anexo enviados numa única chamada (`POST /message/sendMedia`, mensagem no campo `caption`), conforme RF07 ("junto com a mensagem montada") — não há chamada separada de texto.
- Nome do PDF salvo em `enviados/`/`erro/` é derivado do arquivo de entrada original + índice do grupo dentro dele + identificador (número para documento, página para erro): `<arquivo>__doc<N>__<numero>.pdf` / `<arquivo>__erro<N>__p<pagina>.pdf`. Necessário porque `enviados/`/`erro/` acumulam PDFs de vários arquivos de entrada ao longo do tempo — evita colisão de nome (mesmo cliente em dois grupos não consecutivos do mesmo lote, ou dois arquivos de entrada diferentes) e mantém rastreabilidade até a origem.
- Falha no envio (erro de rede/API) nesta etapa é tratada como erro: PDF vai para `erro/` com o motivo sendo a mensagem da exceção, e o documento conta como concluído para fins de mover o arquivo original para `processado/`. Ainda não há retry (isso é a Etapa 7) — decisão explícita do usuário para não deixar a exceção propagar e travar o processamento dos demais itens da fila (inclusive de outros arquivos).

**Entrega**: fluxo completo funcional em condição ideal (sem falha de rede), cobrindo os critérios de aceite básicos do PRD, incluindo o caso de lote com múltiplos clientes em um único arquivo de entrada.

## Etapa 6 — Anti-ban: throttling e comportamento humano
- Delay aleatório configurável entre itens da fila, entre `DELAY_MIN_SEC` e `DELAY_MAX_SEC` (RF09).
- Indicador de presença com duração calculada pela fórmula `min(TYPING_BASE_MS + tamanho_mensagem * TYPING_MS_POR_CARACTER, TYPING_MAX_MS) + jitter` (RF10) — aplica o princípio do guideline anti-ban de duração proporcional ao tamanho da mensagem.
- Contador de envios diários por número, persistido em `logs/contagem-diaria.json` (`{ "data": "AAAA-MM-DD", "contagens": { "<numero>": N } }`), sobrevivendo a reinícios do serviço. Gravação via arquivo temporário + rename (evita corromper o JSON em caso de queda no meio da escrita). Comparação da `data` gravada com a data atual a cada leitura: se divergir, zera as contagens — reset "de meia-noite" sem precisar de agendador separado. Bloqueia novos envios ao atingir `LIMITE_DIARIO_POR_NUMERO` (RF11).

**Entrega**: processamento de múltiplos documentos respeita delay e limite diário, visível nos logs.

## Etapa 7 — Resiliência: retry e circuit breaker
- Retry com backoff exponencial + jitter em falha de envio: `delay(tentativa) = min(RETRY_BASE_MS * 2^(tentativa-1), RETRY_MAX_MS) + jitter`, até `RETRY_MAX_TENTATIVAS` (RF12).
- Listener do webhook de status de conexão da Evolution API, escutando em `127.0.0.1:WEBHOOK_PORT` (bind local, nunca exposto).
- Circuit breaker: após N falhas/desconexão, pausa a fila automaticamente (RF13) e grava/atualiza `status.txt` na raiz da `PASTA_BASE` com motivo e horário da pausa (RF19) — mecanismo local, funciona mesmo com a Evolution API fora do ar.
- Retomada manual (RF14, RF20): reutiliza a instância do `chokidar` já criada na Etapa 3 pra também observar a raiz da `PASTA_BASE`, aguardando a criação de `RETOMAR.txt`. Ao detectar, retoma o processamento, apaga o `RETOMAR.txt` (autolimpeza) e envia ao número administrador um resumo do período pausado via WhatsApp.

**Entrega**: simulação de queda de conexão ou falha de envio pausa o sistema corretamente, sem loop de erro; `status.txt` reflete a pausa em tempo real; criar `RETOMAR.txt` retoma o processamento e gera o resumo retroativo.

## Etapa 8 — Logging e observabilidade
- Log estruturado de todos os eventos: processado, erro, movido, pausado, retomado (RF15), com verbosidade controlada por `LOG_LEVEL` (default `info`).
- Rotação/organização dos arquivos de log por data.
- Ao mover um documento para `erro/`, gravar (append) uma linha legível em `erro/log.txt` no formato `<identificação do documento> - <motivo do erro>` (RF17) — mecanismo local, não depende da Evolution API estar acessível.
- Ao final do processamento de cada arquivo de entrada, montar e enviar (via Evolution API) um resumo para o número administrador configurado no `.env`, com contagem de enviados/erros e motivo de cada erro (RF18).

**Entrega**: qualquer evento do fluxo é rastreável no log sem precisar reproduzir o cenário; um documento em erro é identificável abrindo só a pasta `erro/`, mesmo sem acesso à instância da Evolution API; o número administrador recebe um resumo por WhatsApp ao fim de cada arquivo processado.

## Etapa 9 — Testes end-to-end
Validar contra os critérios de aceite do PRD:
- Documento único com marcador válido → enviado corretamente com mensagem personalizada.
- Arquivo em lote com múltiplos clientes → dividido corretamente, cada documento enviado ao destinatário certo.
- Página/documento sem marcador válido → vai para `erro/`, não trava o processamento dos demais documentos do lote.
- Reinício do serviço → não reenvia documentos já em `enviados/`; contagem diária por número (RF11) não reseta indevidamente.
- Delay aleatório observável entre envios.
- Queda de conexão → pausa automática, `status.txt` reflete o motivo; criar `RETOMAR.txt` retoma e dispara resumo retroativo.
- Falha pontual de envio → retry controlado, sem derrubar o serviço.

**Entrega**: checklist de aceite do PRD (seção 11) todo marcado.

## Etapa 10 — Deploy como serviço no Windows
- Empacotar para rodar em background (ex: `node-windows` para instalar como Windows Service).
- Configurar o container Docker da Evolution API para iniciar automaticamente com o Windows (`restart: always` no docker-compose), já que os dois dependem da mesma máquina.
- Documentar instalação, configuração inicial (`.env`, `template.txt`) e operação (como pausar/retomar, onde ficam os logs).

**Entrega**: Q-Zap instalado e rodando como serviço, sobrevivendo a reinício do Windows.

## Etapa 11 — Instalador e desinstalador para cliente novo
- Criar um script único (ex: `install.ps1` ou `npm run setup`) que automatiza tudo que hoje é manual nas Etapas 1 e 10:
  - Verifica pré-requisitos (Node, Docker instalados).
  - Copia `.env.example` para `.env` caso não exista (sem sobrescrever um já preenchido).
  - Se o `.env` acabou de ser criado (primeira execução), pergunta interativamente via `Read-Host` os 3 campos sem default seguro: `PASTA_BASE`, `NUMERO_ADMIN` (sanitiza e valida formato) e `LIMITE_DIARIO_POR_NUMERO` (sugere um valor conservador como default, aceitável com Enter). Exibe um resumo dos valores informados e pede confirmação antes de prosseguir. Em reexecuções com `.env` já existente, pula essa etapa inteira.
  - Gera `EVOLUTION_API_KEY` nativamente em PowerShell (sem dependência de Python) e grava o mesmo valor no `.env` do Q-Zap e no `docker-compose.yml` da Evolution API, sincronizando os dois automaticamente.
  - Cria a `PASTA_BASE` definida no `.env` e sua subestrutura (`entrada/`, `erro/`, `enviados/`, `processado/`, `logs/`), se não existirem — mesmo mecanismo de bootstrap usado no boot normal (Etapa 1), não uma lógica separada.
  - Sobe a Evolution API via `docker-compose up -d`.
  - Instala dependências (`npm install`).
  - Registra o Q-Zap como serviço Windows.
  - Ao final, orienta o usuário a escanear o QR code para parear o WhatsApp — única etapa manual inevitável.
- Testar o script do zero em uma máquina limpa (ou VM), simulando instalação em cliente novo.
- Criar `uninstall.ps1` (RNF09), par do `install.ps1`:
  - Para e desregistra o serviço Windows do Q-Zap.
  - Derruba os containers Docker com remoção de volumes (`docker-compose down -v`) — inclui a sessão pareada do WhatsApp e os dados do Postgres da Evolution API; uma reinstalação seguinte exige novo pareamento por QR code.
  - Nunca apaga `PASTA_BASE` (documentos de clientes já enviados/em erro, logs) — nem com flag alguma. É dado do cliente, decisão de o que fazer com ele fica fora do escopo de um comando de desinstalação automatizado.
  - Ao final, informa ao usuário onde `PASTA_BASE` continua e que ela não foi tocada.
- Testar o ciclo completo instalar → desinstalar → reinstalar na mesma máquina limpa/VM usada para validar o `install.ps1`, confirmando que a reinstalação pede novo QR code e que `PASTA_BASE` sobrevive intacta ao ciclo.

**Entrega**: instalação em máquina nova reduzida a "rodar um comando e responder 3 perguntas" (RNF08), sem precisar editar `.env` manualmente, validado de ponta a ponta; desinstalação reduzida a um único comando (RNF09), removendo serviço e containers/volumes sem tocar nos dados de `PASTA_BASE`, também validada de ponta a ponta.

---

## Ordem de execução

As etapas 1→5 formam o **MVP funcional** (sem anti-ban ainda) — útil pra validar o fluxo fim a fim rápido, inclusive com teste manual real na Evolution API e com o caso de lote multi-cliente. As etapas 6→8 adicionam as proteções que tornam o uso seguro em produção. 9 e 10 fecham para uso real na sua própria máquina/instância. A etapa 11 só faz sentido depois de 1 e 10 estarem estáveis, já que ela empacota exatamente esses dois processos (setup inicial + deploy como serviço) num único comando reaproveitável para outros clientes.

Recomendo não pular direto pro deploy (etapa 10) sem 6 e 7 prontos — enviar em produção sem throttling/circuit breaker é o cenário que o manual anti-ban trata como risco de ban.
