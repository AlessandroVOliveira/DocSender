# PRD — Q-Zap

## 1. Visão geral

Q-Zap é um serviço de envio automático de documentos (notas fiscais, boletos, etc.) gerados por sistemas ERP legados para clientes via WhatsApp, usando a Evolution API. Resolve a falta de integração nativa com WhatsApp em sistemas antigos, eliminando o envio manual desses documentos.

### 1.1 Identidade visual e mascote

A marca tem como mascote o **Q-Ro**, um quero-quero (*Vanellus chilensis*) estilizado, representado na logo em voo, levando um documento no bico. O nome e o desenho não são arbitrários:

- **Nome**: "Q-Ro" ecoa tanto o "Q" de Q-Zap quanto o nome popular da própria ave, o quero-quero.
- **Velocidade**: o quero-quero é uma ave ágil, de voo rápido — remete à entrega automática e imediata do documento assim que o ERP o gera, sem intervenção manual.
- **Instinto de proteção**: é uma ave conhecida pelo comportamento defensivo intenso, alertando e reagindo a qualquer ameaça próxima ao seu território — simboliza o cuidado do produto com a segurança e a integridade dos dados do cliente durante o envio.
- **Identidade regional**: a empresa por trás do Q-Zap é do Rio Grande do Sul, e o quero-quero é uma ave fortemente associada à paisagem e à cultura do Sul do Brasil — a mascote reforça a origem do produto na marca.

## 2. Problema

ERPs antigos geram documentos que precisam ser enviados aos clientes, mas não têm integração com WhatsApp. Hoje esse envio depende de processo manual (alguém baixa o documento e manda um a um), o que é lento e sujeito a esquecimento/erro.

## 3. Objetivo

Automatizar o envio desses documentos assim que são gerados pelo ERP, sem exigir nenhuma alteração no código do ERP — apenas que o editor de relatórios usado (ex: Crystal Reports) embuta um marcador de identificação no próprio documento.

## 4. Escopo

**Dentro do escopo**
- Monitoramento de uma pasta local para novos arquivos.
- Identificação do cliente destinatário a partir de um marcador embutido no conteúdo do PDF.
- Suporte a arquivos de entrada em lote (um PDF contendo os documentos de vários clientes).
- Envio do arquivo como anexo via Evolution API, acompanhado de mensagem de texto personalizada.
- Organização dos arquivos processados (sucesso/erro).
- Proteções anti-ban no disparo (throttling, retry, circuit breaker).
- Subida e configuração da instância local da Evolution API (via Docker), rodando na mesma máquina do Q-Zap.
- Script único de instalação para uso em cliente novo, exigindo no máximo a configuração de um `.env` e a execução de um comando.

**Fora do escopo (por enquanto)**
- Qualquer alteração ou integração direta com o ERP (banco de dados, impressão, etc.).
- Recebimento/tratamento de respostas dos clientes no WhatsApp.
- Interface gráfica de administração.
- Opt-in/opt-out formal de contatos.
- Múltiplos números/instâncias em rotação.
- Migração para Meta Cloud API oficial (caminho futuro, não v1).

## 5. Definições de entrada

### 5.1 Pasta monitorada
- O `.env` define uma única pasta base (`PASTA_BASE`). O sistema deriva e cria automaticamente, se não existirem, as subpastas `entrada/`, `enviados/`, `erro/`, `processado/` e `logs/` dentro dela.
- O editor de relatórios do ERP (ex: Crystal Reports) deve ser configurado para exportar o documento (PDF) para `{PASTA_BASE}/entrada` — é a única integração necessária com o ERP, feita no destino de exportação do relatório, sem alteração de código.
- O nome do arquivo é irrelevante para a identificação do cliente — pode ser qualquer nome, inclusive gerado automaticamente pelo ERP.
- Um arquivo PDF pode conter o documento de um único cliente, ou, em geração em lote (ex: boletos do mês para todos os clientes), os documentos de vários clientes concatenados em um único PDF.

### 5.2 Marcador de identificação no PDF
- Cada página do PDF deve conter, na camada de texto do documento, um marcador no formato:
  ```
  $Q-Zap=<numero>|<nome>$
  ```
  Exemplo: `$Q-Zap=5511999998888|João Silva$`
- `numero` pode vir com máscara (ex: hífen), já que o campo é salvo assim pelo ERP antes de chegar ao relatório — o Q-Zap deve sanitizar removendo tudo que não é dígito antes de validar/usar o número.
- `nome` é o nome/razão social exibido na mensagem (placeholder `{nome}` do template). O `$` final é obrigatório: delimita onde o nome termina. Sem ele, a extração de texto do PDF (que não preserva quebras de linha entre os "text runs" da página) faria o nome "vazar" e capturar o resto do conteúdo visível da página.
- O marcador é inserido via template do relatório (ex: campo de texto no Crystal Reports puxando dados do banco do ERP), podendo ser visualmente invisível (ex: mesma cor do fundo) — não depende de nenhuma alteração no código do ERP.
- Páginas consecutivas com o mesmo marcador pertencem ao mesmo documento/envio; uma mudança de marcador indica o início de um novo documento (novo cliente) dentro do mesmo arquivo de entrada.
- Não existe cadastro de clientes separado (`cadastro.txt`) na v1 — número e nome vêm diretamente do marcador de cada documento.

### 5.3 Template de mensagem
- Texto configurável (arquivo de config), com placeholder `{nome}`.
- Exemplo padrão: `Olá {nome}, segue seu documento em anexo.`
- Mensagem é enviada junto com o arquivo anexado — o conteúdo do documento não entra no texto.

### 5.4 Infraestrutura da Evolution API
- A instância da Evolution API roda **localmente, na mesma máquina** que o Q-Zap (provavelmente via Docker/docker-compose).
- Comunicação Q-Zap ↔ Evolution API via `localhost`, sem necessidade de túnel/exposição externa (ex: ngrok) para o webhook de status de conexão.
- Ainda precisa ser montada/configurada — não é uma instância pré-existente (entra como pré-requisito no plano de desenvolvimento).
- A sessão autenticada (pareamento via QR code) deve persistir entre reinícios do container/serviço, para não exigir novo pareamento a cada restart.
- Como Evolution API e Q-Zap compartilham a mesma máquina, essa máquina é um ponto único de falha para todo o fluxo (ver RNF06).

## 6. Requisitos funcionais

| ID | Requisito |
|----|-----------|
| RF01 | O sistema deve monitorar continuamente uma pasta configurável em busca de novos arquivos. |
| RF02 | O sistema deve aguardar a estabilização do arquivo (ERP terminar de escrevê-lo) antes de processá-lo, para evitar ler arquivo incompleto. |
| RF03 | O sistema deve extrair o marcador de identificação (`$Q-Zap=numero\|nome$`) da camada de texto de cada página do PDF. |
| RF04 | O sistema deve agrupar páginas consecutivas com o mesmo marcador em um único documento de saída, gerando um PDF separado por grupo sempre que o arquivo de entrada contiver mais de um cliente (lote). |
| RF05 | Se uma página não tiver marcador válido (ausente ou malformado) ou os dados extraídos forem inválidos (ex: número de telefone inexistente/malformado), apenas o documento correspondente àquele grupo de páginas deve ser movido para a pasta `erro/`, sem interromper o processamento dos demais documentos do mesmo arquivo de entrada. |
| RF06 | Para cada documento identificado com sucesso, o sistema deve montar a mensagem a partir do template, substituindo `{nome}` pelo nome extraído do marcador. |
| RF07 | O sistema deve enviar o documento (PDF do grupo de páginas correspondente) como anexo via Evolution API, junto com a mensagem montada, para o número extraído do marcador. |
| RF08 | Após envio confirmado com sucesso de um documento, o PDF gerado para aquele grupo de páginas deve ser movido para a pasta `enviados/`. Quando todos os documentos de um arquivo de entrada tiverem sido processados (enviados e/ou movidos para erro), o arquivo original deve ser movido para uma pasta `processado/`. |
| RF09 | O sistema deve aplicar um delay aleatório (configurável, ex: `random(5,15)s`) entre o processamento de documentos consecutivos. |
| RF10 | O sistema deve exibir indicador de "digitando" por um tempo plausível antes de enviar cada mensagem. |
| RF11 | O sistema deve respeitar um limite diário configurável de mensagens enviadas por número. |
| RF12 | Em caso de falha no envio, o sistema deve tentar novamente com backoff exponencial e jitter, sem loop imediato. |
| RF13 | O sistema deve monitorar o status de conexão da instância Evolution API (via webhook) e pausar o processamento da fila caso a instância caia ou apresente erro recorrente. |
| RF14 | O sistema deve permitir retomada manual do processamento após uma pausa por circuit breaker. |
| RF15 | Toda ação relevante (processado, erro, movido, pausado, retomado) deve ser registrada em log. |
| RF16 | No início da execução (e após qualquer perda de conexão), o sistema deve verificar se a instância local da Evolution API está acessível e conectada antes de processar a fila, aguardando/tentando novamente em intervalo razoável em vez de falhar imediatamente. |
| RF17 | Sempre que um documento for movido para a pasta `erro/`, o sistema deve registrar uma entrada legível (`<identificação do documento> - <motivo do erro>`) em um arquivo de texto `log.txt` dentro da própria pasta `erro/`, complementando o log estruturado (RF15). Esse registro não depende de rede nem da Evolution API estar no ar. |
| RF18 | Ao final do processamento de cada arquivo de entrada, o sistema deve enviar uma mensagem de resumo para um número administrador configurável via WhatsApp, informando quantos documentos foram enviados com sucesso e quantos foram para erro (com motivo de cada um). |
| RF19 | Enquanto a fila estiver pausada por circuit breaker (RF13), o sistema deve manter um arquivo `status.txt` na raiz da `PASTA_BASE` com o motivo e o horário do início da pausa, atualizado em tempo real. Esse registro não depende de rede nem da Evolution API estar no ar, cobrindo o cenário em que o alerta por WhatsApp (RF18) não pode ser entregue por a própria conexão estar indisponível. |
| RF20 | A retomada manual do processamento (RF14) deve ser sinalizada pela criação de um arquivo sentinela `RETOMAR.txt` na raiz da `PASTA_BASE`. Ao detectar esse arquivo, o sistema deve retomar o processamento, remover o arquivo automaticamente, atualizar o `status.txt` e enviar ao número administrador um resumo do período pausado via WhatsApp. |

## 7. Requisitos não funcionais

| ID | Requisito |
|----|-----------|
| RNF01 | Nenhum documento deve ser enviado duas vezes, mesmo em caso de reinício do serviço (garantido pela movimentação para `enviados/` só após confirmação, no nível de cada documento/grupo de páginas). |
| RNF02 | Configurações (pasta base de trabalho, delays, limite diário, template de mensagem, dados de acesso à Evolution API, número administrador para alertas) devem ficar em arquivo de configuração externo, não hardcoded. A pasta base é a única configuração de caminho exigida — as subpastas (`entrada/`, `enviados/`, `erro/`, `processado/`, `logs/`) são derivadas dela por convenção e criadas automaticamente pelo sistema se não existirem, a cada início da execução. |
| RNF03 | O sistema não deve depender de nenhuma alteração no código do ERP — apenas da capacidade do editor de relatórios (ex: Crystal Reports) de embutir o marcador de identificação na camada de texto do documento gerado. |
| RNF04 | O sistema deve poder rodar continuamente em background (serviço), sem necessidade de interação humana no fluxo normal. |
| RNF05 | Falhas de rede/conexão não podem travar o processamento de forma silenciosa — devem ser sinalizadas via log/alerta. |
| RNF06 | O sistema deve assumir e documentar que Evolution API e Q-Zap compartilham a mesma máquina como ponto único de falha — não há requisito de alta disponibilidade/failover na v1. |
| RNF07 | Dados de sessão da Evolution API (pareamento WhatsApp) devem ser persistidos em disco (volume Docker) de forma a sobreviver a reinícios do container/máquina. |
| RNF08 | A instalação em um cliente novo deve exigir no máximo: executar um único comando, respondendo interativamente às perguntas feitas por ele (pasta base de trabalho, número administrador, limite diário por número) — sem necessidade de editar o `.env` manualmente. Toda a provisão de infraestrutura (pastas, geração de credenciais da Evolution API, subida via Docker, dependências, registro como serviço Windows) deve ser automatizada por esse comando. A única etapa manual inevitável é o pareamento inicial via QR code. |
| RNF09 | Deve existir um comando único de desinstalação que remova o serviço Windows e os containers Docker (incluindo volumes — sessão pareada do WhatsApp e dados do Postgres da Evolution API, exigindo novo pareamento por QR code numa reinstalação). Os dados em `PASTA_BASE` (documentos de clientes já processados, logs) nunca são apagados automaticamente — permanecem em disco para o operador decidir o que fazer com eles. |

## 8. Fluxo do sistema (alto nível)

1. O ERP (via Crystal Reports ou similar) salva um PDF na pasta monitorada — um único documento ou um lote com vários clientes.
2. Serviço detecta o novo arquivo e aguarda estabilização.
3. Extrai o marcador `$Q-Zap=numero|nome$` da camada de texto de cada página.
4. Agrupa páginas consecutivas com o mesmo marcador em documentos individuais.
5. Para cada documento do grupo:
   - Marcador ausente/malformado ou dado inválido (ex: telefone inexistente) → gera PDF do grupo, move para `erro/`, registra o motivo em `erro/log.txt` e no log estruturado, segue para o próximo documento.
   - Marcador válido → monta mensagem a partir do template, substituindo `{nome}`.
   - Aguarda delay aleatório (throttling).
   - Envia "digitando...", aguarda tempo plausível.
   - Envia mensagem + anexo (PDF do grupo) via Evolution API.
     - Falha → retry com backoff exponencial/jitter (até limite de tentativas). Se esgotar as tentativas, trata como erro (mesma rotina acima).
     - Sucesso → move PDF do grupo para `enviados/`, loga.
6. Quando todos os documentos do arquivo de entrada tiverem sido processados, move o arquivo original para `processado/` e envia ao número administrador um resumo (enviados x erro, com motivo) via WhatsApp.
7. Volta a monitorar a pasta.

Em paralelo: serviço escuta webhook de status de conexão da Evolution API; se detectar desconexão/erro recorrente, pausa o passo 5 em diante, grava o motivo em `status.txt` na raiz da `PASTA_BASE` (RF19) e aguarda a criação do arquivo `RETOMAR.txt` (RF20) para retomar, atualizar `status.txt` e enviar um resumo retroativo do período pausado ao número administrador.

## 9. Decisões já tomadas (fora deste documento)

- **Stack**: Node.js — ver `DEV_PLAN.md`.
- **Infraestrutura Evolution API**: local, mesma máquina do Q-Zap, via Docker (a montar) — ver seção 5.4.
- **Formato de configuração**: `.env` para parâmetros operacionais + `template.txt` para a mensagem — ver `DEV_PLAN.md`.
- **Retry**: máximo de 3 tentativas por padrão.
- **Identificação do cliente**: via marcador embutido no PDF (`$Q-Zap=numero|nome$`), sem dependência de nome de arquivo ou cadastro externo.
- **Alertas de erro**: registro local em `erro/log.txt` (independe de rede) + resumo via WhatsApp para número administrador ao final de cada arquivo processado. Sem canal de e-mail/SMTP na v1 — não solicitado.
- **Instalação**: `install.ps1` pergunta interativamente (`Read-Host`) os únicos 3 campos sem default seguro (`PASTA_BASE`, `NUMERO_ADMIN`, `LIMITE_DIARIO_POR_NUMERO`) na primeira execução, valida e confirma antes de prosseguir; demais variáveis já vêm com default. Não é mais necessário editar o `.env` manualmente.
- **Desinstalação**: `uninstall.ps1` (par do `install.ps1`) remove o serviço Windows e derruba os containers Docker com remoção de volumes (`docker-compose down -v`) — desinstalação completa da Evolution API, sessão do WhatsApp incluída. Nunca apaga `PASTA_BASE` automaticamente, mesmo com `-v`: são dados de clientes (documentos já enviados/em erro), e uma remoção automática seria irreversível e arriscada demais para um comando de desinstalação rodar sem revisão humana.

## 10. Pontos ainda em aberto

- Suporte a outros tipos de arquivo além de PDF (hoje assumido apenas PDF).
- Estrutura de log (arquivo local, rotação, nível de detalhe) — proposta inicial em `DEV_PLAN.md`, a validar.
- Versão/configuração exata do docker-compose da Evolution API (imagem, portas, volumes).

## 11. Critérios de aceite (v1)

- [x] Arquivo com marcador válido em todas as páginas é enviado automaticamente ao número correto, com a mensagem personalizada.
- [x] Arquivo em lote com documentos de múltiplos clientes é corretamente dividido por marcador, e cada documento é enviado ao destinatário correto.
- [x] Página/documento sem marcador válido (ausente, malformado ou telefone inexistente) é movido para `erro/` e não trava o processamento dos demais documentos do mesmo lote.
- [x] Documento enviado com sucesso é movido para `enviados/`, e o arquivo original é movido para `processado/` quando todos os seus documentos forem concluídos; nada é reenviado em reinícios subsequentes do serviço.
- [x] Delay aleatório entre envios é observável nos logs (nunca dois envios em sequência imediata).
- [x] Queda de conexão da instância Evolution API pausa o processamento automático até intervenção manual.
- [x] Falha pontual de envio não derruba o serviço nem entra em loop de retry agressivo.
- [x] Instalação em uma máquina nova exige apenas rodar um comando e responder às perguntas interativas dele (pasta base, número administrador, limite diário), além do pareamento por QR code — sem precisar editar o `.env` manualmente nem configurar pastas, Docker ou serviço à parte. (`install.ps1` implementado na Etapa 11, validado de ponta a ponta em máquina limpa/VM.)
- [x] Documento em erro gera entrada legível em `erro/log.txt`, consultável sem depender da Evolution API estar no ar.
- [x] Ao final do processamento de um arquivo de entrada, o número administrador recebe um resumo via WhatsApp com a contagem de enviados/erros.
- [x] Durante uma pausa por circuit breaker, `status.txt` reflete o motivo/horário, consultável sem depender da Evolution API estar no ar; criar `RETOMAR.txt` retoma o processamento e dispara um resumo retroativo ao número administrador.
- [x] O limite diário por número (RF11) sobrevive a um reinício do serviço no meio do dia, sem resetar a contagem indevidamente.
- [x] Desinstalação em uma máquina removeu o serviço Windows e os containers/volumes Docker (Evolution API exige novo pareamento por QR code numa reinstalação seguinte), sem apagar nenhum arquivo de `PASTA_BASE`. (`uninstall.ps1` implementado na Etapa 11, validado de ponta a ponta em máquina limpa/VM.)
