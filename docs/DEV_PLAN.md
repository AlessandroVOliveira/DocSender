# Plano de Desenvolvimento — DocSender

Stack definida: **Node.js** (LTS), com `chokidar` (monitoramento de pasta), `axios`/`fetch` (chamadas à Evolution API), `dotenv` (config) e um logger estruturado (`pino`).

Decisões de config assumidas para v1 (podem ser revisadas):
- `.env` para configuração operacional (caminhos de pasta, credenciais/URL da Evolution API, delays, limite diário, máx. de tentativas de retry).
- `cadastro.txt` (já definido no PRD) para clientes.
- `template.txt` separado para a mensagem padrão, editável sem mexer em código/`.env`.
- Máximo de tentativas de retry por envio: 3 (configurável).
- Logger: `pino`, arquivo local com rotação diária.
- v1 suporta apenas arquivos `.pdf`.

---

## Etapa 1 — Setup do projeto e infraestrutura local
- Subir a Evolution API localmente via Docker/docker-compose, na mesma máquina do DocSender.
- Configurar API key/instância e realizar o pareamento inicial via QR code.
- Configurar volume Docker para persistir a sessão autenticada entre reinícios (RNF07) — validar reiniciando o container e confirmando que não pede novo QR code.
- Inicializar repositório e `package.json`.
- Estrutura de pastas: `src/`, `config/`, `logs/`.
- Instalar dependências base: `chokidar`, `axios`, `dotenv`, `pino`.
- `.env.example` com todas as variáveis necessárias (pastas, URL/porta local da Evolution API, API key, delays, limites).

**Entrega**: Evolution API rodando localmente e conectada ao WhatsApp (sessão persistente), projeto Node roda `node src/index.js` sem erro (mesmo sem lógica ainda).

## Etapa 2 — Cadastro e parsing de arquivo
- Módulo de leitura do `cadastro.txt` → mapa `cod → { nome, numero }`, recarregado a cada uso (sem cache persistente).
- Função de extração do código do cliente a partir do nome do arquivo (`{codCliente}-{identificador}.pdf`).
- Tratamento de nome de arquivo fora do padrão (sem hífen, código não encontrado, etc.).

**Entrega**: dado um nome de arquivo e o `cadastro.txt`, o sistema resolve corretamente nome/número ou identifica "não encontrado".

## Etapa 3 — Watcher de pasta + fila
- `chokidar` monitorando a pasta de entrada.
- Verificação de estabilização do arquivo (tamanho estável por X ms) antes de processar — evita pegar arquivo que o ERP ainda está escrevendo.
- Fila interna simples (array/FIFO), processada um item por vez, nunca em paralelo.

**Entrega**: arquivos novos na pasta entram na fila corretamente, mesmo se vários chegarem ao mesmo tempo.

## Etapa 4 — Integração básica com Evolution API
- Cliente HTTP para: enviar mensagem de texto, enviar mídia/documento, disparar indicador de presença ("digitando").
- Verificação de conectividade/status da instância local no início da execução, com espera e nova tentativa caso ainda não esteja pronta em vez de falhar de imediato (RF16) — relevante especialmente no boot da máquina, quando o container da Evolution API pode ainda estar subindo.
- Teste manual isolado (fora da fila) contra a instância local da Evolution API.

**Entrega**: envio manual de uma mensagem + anexo funciona ponta a ponta para um número de teste; sistema aguarda corretamente se a Evolution API ainda não estiver pronta.

## Etapa 5 — Fluxo principal (ligar tudo)
- Watcher → parsing → lookup no cadastro → template com `{nome}` → envio → mover arquivo.
- Não encontrado no cadastro → move para `erro/` (RF05).
- Enviado com sucesso → move para `enviados/` (RF08).

**Entrega**: fluxo completo funcional em condição ideal (sem falha de rede), cobrindo os critérios de aceite básicos do PRD.

## Etapa 6 — Anti-ban: throttling e comportamento humano
- Delay aleatório configurável entre itens da fila (RF09).
- Indicador de presença com duração plausível antes do envio (RF10).
- Contador de envios diários por número, resetado à meia-noite, bloqueando novos envios ao atingir o limite (RF11).

**Entrega**: processamento de múltiplos arquivos respeita delay e limite diário, visível nos logs.

## Etapa 7 — Resiliência: retry e circuit breaker
- Retry com backoff exponencial + jitter em falha de envio (RF12).
- Listener do webhook de status de conexão da Evolution API.
- Circuit breaker: após N falhas/desconexão, pausa a fila automaticamente (RF13) e exige retomada manual (RF14) — ex: comando/flag de controle.

**Entrega**: simulação de queda de conexão ou falha de envio pausa o sistema corretamente, sem loop de erro.

## Etapa 8 — Logging e observabilidade
- Log estruturado de todos os eventos: processado, erro, movido, pausado, retomado (RF15).
- Rotação/organização dos arquivos de log por data.

**Entrega**: qualquer evento do fluxo é rastreável no log sem precisar reproduzir o cenário.

## Etapa 9 — Testes end-to-end
Validar contra os critérios de aceite do PRD:
- Arquivo válido → enviado corretamente com mensagem personalizada.
- Código inexistente → vai para `erro/`, não trava a fila.
- Reinício do serviço → não reenvia arquivos já em `enviados/`.
- Delay aleatório observável entre envios.
- Queda de conexão → pausa automática.
- Falha pontual de envio → retry controlado, sem derrubar o serviço.

**Entrega**: checklist de aceite do PRD (seção 10) todo marcado.

## Etapa 10 — Deploy como serviço no Windows
- Empacotar para rodar em background (ex: `node-windows` para instalar como Windows Service).
- Configurar o container Docker da Evolution API para iniciar automaticamente com o Windows (`restart: always` no docker-compose), já que os dois dependem da mesma máquina.
- Documentar instalação, configuração inicial (`.env`, `cadastro.txt`, `template.txt`) e operação (como pausar/retomar, onde ficam os logs).

**Entrega**: DocSender instalado e rodando como serviço, sobrevivendo a reinício do Windows.

## Etapa 11 — Instalador para cliente novo
- Criar um script único (ex: `install.ps1` ou `npm run setup`) que automatiza tudo que hoje é manual nas Etapas 1 e 10:
  - Verifica pré-requisitos (Node, Docker instalados).
  - Copia `.env.example` para `.env` caso não exista (sem sobrescrever um já preenchido).
  - Cria as pastas de entrada/erro/enviados definidas no `.env`, se não existirem.
  - Sobe a Evolution API via `docker-compose up -d`.
  - Instala dependências (`npm install`).
  - Registra o DocSender como serviço Windows.
  - Ao final, orienta o usuário a escanear o QR code para parear o WhatsApp — única etapa manual inevitável.
- Testar o script do zero em uma máquina limpa (ou VM), simulando instalação em cliente novo.

**Entrega**: instalação em máquina nova reduzida a "preencher `.env` + rodar um comando" (RNF08), validado de ponta a ponta.

---

## Ordem de execução

As etapas 1→5 formam o **MVP funcional** (sem anti-ban ainda) — útil pra validar o fluxo fim a fim rápido, inclusive com teste manual real na Evolution API. As etapas 6→8 adicionam as proteções que tornam o uso seguro em produção. 9 e 10 fecham para uso real na sua própria máquina/instância. A etapa 11 só faz sentido depois de 1 e 10 estarem estáveis, já que ela empacota exatamente esses dois processos (setup inicial + deploy como serviço) num único comando reaproveitável para outros clientes.

Recomendo não pular direto pro deploy (etapa 10) sem 6 e 7 prontos — enviar em produção sem throttling/circuit breaker é o cenário que o manual anti-ban trata como risco de ban.
