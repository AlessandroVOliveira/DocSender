# PRD — DocSender

## 1. Visão geral

DocSender é um serviço de envio automático de documentos (notas fiscais, boletos, etc.) gerados por sistemas ERP legados para clientes via WhatsApp, usando a Evolution API. Resolve a falta de integração nativa com WhatsApp em sistemas antigos, eliminando o envio manual desses documentos.

## 2. Problema

ERPs antigos geram documentos que precisam ser enviados aos clientes, mas não têm integração com WhatsApp. Hoje esse envio depende de processo manual (alguém baixa o documento e manda um a um), o que é lento e sujeito a esquecimento/erro.

## 3. Objetivo

Automatizar o envio desses documentos assim que são gerados pelo ERP, sem exigir nenhuma alteração no ERP além de salvar o arquivo em uma pasta com um nome de arquivo padronizado.

## 4. Escopo

**Dentro do escopo**
- Monitoramento de uma pasta local para novos arquivos.
- Identificação do cliente destinatário a partir do nome do arquivo.
- Envio do arquivo como anexo via Evolution API, acompanhado de mensagem de texto personalizada.
- Organização dos arquivos processados (sucesso/erro).
- Proteções anti-ban no disparo (throttling, retry, circuit breaker).
- Subida e configuração da instância local da Evolution API (via Docker), rodando na mesma máquina do DocSender.
- Script único de instalação para uso em cliente novo, exigindo no máximo a configuração de um `.env` e a execução de um comando.

**Fora do escopo (por enquanto)**
- Qualquer alteração ou integração direta com o ERP (banco de dados, impressão, etc.).
- Recebimento/tratamento de respostas dos clientes no WhatsApp.
- Interface gráfica de administração (cadastro via txt é suficiente na v1).
- Opt-in/opt-out formal de contatos.
- Múltiplos números/instâncias em rotação.
- Migração para Meta Cloud API oficial (caminho futuro, não v1).

## 5. Definições de entrada

### 5.1 Pasta monitorada
- ERP salva o documento (PDF) em uma pasta configurável.
- Nome do arquivo no formato `{codCliente}-{identificador}.pdf` (ex: `3424-nf1034.pdf`).
- Apenas o `codCliente` (trecho antes do primeiro `-`) é usado para identificar o destinatário; o `identificador` é livre/informativo.

### 5.2 Cadastro de clientes
- Arquivo texto (`cadastro.txt`), codificação UTF-8, uma linha por cliente:
  ```
  cod;nome;numero
  3424;João Silva;5511999998888
  ```
- `numero` já no formato internacional esperado pela Evolution API (DDI+DDD+número, sem símbolos).
- Recarregado a cada processamento (não requer reiniciar o serviço ao editar o txt).

### 5.3 Template de mensagem
- Texto configurável (arquivo de config), com placeholder `{nome}`.
- Exemplo padrão: `Olá {nome}, segue seu documento em anexo.`
- Mensagem é enviada junto com o arquivo anexado — o conteúdo do documento não entra no texto.

### 5.4 Infraestrutura da Evolution API
- A instância da Evolution API roda **localmente, na mesma máquina** que o DocSender (provavelmente via Docker/docker-compose).
- Comunicação DocSender ↔ Evolution API via `localhost`, sem necessidade de túnel/exposição externa (ex: ngrok) para o webhook de status de conexão.
- Ainda precisa ser montada/configurada — não é uma instância pré-existente (entra como pré-requisito no plano de desenvolvimento).
- A sessão autenticada (pareamento via QR code) deve persistir entre reinícios do container/serviço, para não exigir novo pareamento a cada restart.
- Como Evolution API e DocSender compartilham a mesma máquina, essa máquina é um ponto único de falha para todo o fluxo (ver RNF06).

## 6. Requisitos funcionais

| ID | Requisito |
|----|-----------|
| RF01 | O sistema deve monitorar continuamente uma pasta configurável em busca de novos arquivos. |
| RF02 | O sistema deve aguardar a estabilização do arquivo (ERP terminar de escrevê-lo) antes de processá-lo, para evitar ler arquivo incompleto. |
| RF03 | O sistema deve extrair o código do cliente a partir do nome do arquivo (`{codCliente}-{identificador}`). |
| RF04 | O sistema deve buscar o código extraído no `cadastro.txt` para obter nome e número do cliente. |
| RF05 | Se o código não for encontrado no cadastro, o arquivo deve ser movido para a pasta `erro/`, e o evento registrado em log. |
| RF06 | Se o código for encontrado, o sistema deve montar a mensagem a partir do template, substituindo `{nome}`. |
| RF07 | O sistema deve enviar o arquivo como anexo via Evolution API, junto com a mensagem montada, para o número do cliente. |
| RF08 | Após envio confirmado com sucesso, o arquivo deve ser movido para a pasta `enviados/`. |
| RF09 | O sistema deve aplicar um delay aleatório (configurável, ex: `random(5,15)s`) entre o processamento de arquivos consecutivos. |
| RF10 | O sistema deve exibir indicador de "digitando" por um tempo plausível antes de enviar cada mensagem. |
| RF11 | O sistema deve respeitar um limite diário configurável de mensagens enviadas por número. |
| RF12 | Em caso de falha no envio, o sistema deve tentar novamente com backoff exponencial e jitter, sem loop imediato. |
| RF13 | O sistema deve monitorar o status de conexão da instância Evolution API (via webhook) e pausar o processamento da fila caso a instância caia ou apresente erro recorrente. |
| RF14 | O sistema deve permitir retomada manual do processamento após uma pausa por circuit breaker. |
| RF15 | Toda ação relevante (processado, erro, movido, pausado, retomado) deve ser registrada em log. |
| RF16 | No início da execução (e após qualquer perda de conexão), o sistema deve verificar se a instância local da Evolution API está acessível e conectada antes de processar a fila, aguardando/tentando novamente em intervalo razoável em vez de falhar imediatamente. |

## 7. Requisitos não funcionais

| ID | Requisito |
|----|-----------|
| RNF01 | Nenhum documento deve ser enviado duas vezes, mesmo em caso de reinício do serviço (garantido pela movimentação para `enviados/` só após confirmação). |
| RNF02 | Configurações (pasta de entrada, pasta de erro, pasta de enviados, delays, limite diário, template de mensagem, dados de acesso à Evolution API) devem ficar em arquivo de configuração externo, não hardcoded. |
| RNF03 | O sistema não deve depender de nenhuma característica específica de um ERP — apenas da existência de um arquivo em uma pasta com nome no formato definido. |
| RNF04 | O sistema deve poder rodar continuamente em background (serviço), sem necessidade de interação humana no fluxo normal. |
| RNF05 | Falhas de rede/conexão não podem travar o processamento de forma silenciosa — devem ser sinalizadas via log/alerta. |
| RNF06 | O sistema deve assumir e documentar que Evolution API e DocSender compartilham a mesma máquina como ponto único de falha — não há requisito de alta disponibilidade/failover na v1. |
| RNF07 | Dados de sessão da Evolution API (pareamento WhatsApp) devem ser persistidos em disco (volume Docker) de forma a sobreviver a reinícios do container/máquina. |
| RNF08 | A instalação em um cliente novo deve exigir no máximo: preencher um `.env` e executar um único comando. Toda a provisão de infraestrutura (pastas, subida da Evolution API via Docker, dependências, registro como serviço Windows) deve ser automatizada por esse comando. A única etapa manual inevitável é o pareamento inicial via QR code. |

## 8. Fluxo do sistema (alto nível)

1. ERP salva `3424-nf1034.pdf` na pasta monitorada.
2. Serviço detecta o novo arquivo e aguarda estabilização.
3. Extrai `3424` do nome do arquivo.
4. Busca `3424` no `cadastro.txt`.
   - Não encontrado → move para `erro/`, loga, fim.
   - Encontrado → obtém nome e número.
5. Monta mensagem a partir do template.
6. Aguarda delay aleatório (throttling).
7. Envia "digitando...", aguarda tempo plausível.
8. Envia mensagem + anexo via Evolution API.
   - Falha → retry com backoff exponencial/jitter (até limite de tentativas).
   - Sucesso → move arquivo para `enviados/`, loga.
9. Volta a monitorar a pasta.

Em paralelo: serviço escuta webhook de status de conexão da Evolution API; se detectar desconexão/erro recorrente, pausa o passo 6 em diante até revisão manual.

## 9. Decisões já tomadas (fora deste documento)

- **Stack**: Node.js — ver `DEV_PLAN.md`.
- **Infraestrutura Evolution API**: local, mesma máquina do DocSender, via Docker (a montar) — ver seção 5.4.
- **Formato de configuração**: `.env` para parâmetros operacionais + `template.txt` para a mensagem — ver `DEV_PLAN.md`.
- **Retry**: máximo de 3 tentativas por padrão.

## 10. Pontos ainda em aberto

- Suporte a outros tipos de arquivo além de PDF (hoje assumido apenas PDF).
- Estrutura de log (arquivo local, rotação, nível de detalhe) — proposta inicial em `DEV_PLAN.md`, a validar.
- Versão/configuração exata do docker-compose da Evolution API (imagem, portas, volumes).

## 11. Critérios de aceite (v1)

- [ ] Arquivo salvo na pasta monitorada com código de cliente válido é enviado automaticamente ao número correto, com a mensagem personalizada.
- [ ] Arquivo com código inexistente no cadastro é movido para `erro/` e não trava o processamento dos demais.
- [ ] Arquivo enviado com sucesso é movido para `enviados/` e não é reenviado em reinícios subsequentes do serviço.
- [ ] Delay aleatório entre envios é observável nos logs (nunca dois envios em sequência imediata).
- [ ] Queda de conexão da instância Evolution API pausa o processamento automático até intervenção manual.
- [ ] Falha pontual de envio não derruba o serviço nem entra em loop de retry agressivo.
- [ ] Instalação em uma máquina nova exige apenas preencher o `.env` e rodar um comando (além do pareamento por QR code), sem passos manuais adicionais de configuração de pastas, Docker ou serviço.
