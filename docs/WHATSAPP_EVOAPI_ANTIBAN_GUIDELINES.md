# Regras Anti-Ban para Integrações WhatsApp via Evolution API (Baileys)

> Documento de referência para uso em qualquer projeto que integre WhatsApp através da Evolution API (ou outra API não-oficial baseada em Baileys/WhatsApp Web multi-dispositivo). Aplique estas regras ao planejar arquitetura, filas, jobs de disparo e regras de negócio de mensageria.

## Contexto e motivação

A Evolution API não é uma API oficial do WhatsApp — ela emula um cliente WhatsApp Web conectado via QR code. O WhatsApp/Meta ativamente detecta e pune padrões de automação nesse tipo de conexão. Diferente da Meta Cloud API oficial (onde os limites são formais e reversíveis via `messaging_limit_tier`/`quality_rating`), aqui o risco é **ban silencioso e definitivo do número**, sem aviso.

Estas regras existem para reduzir a chance de detecção como automação abusiva, mantendo o uso legítimo (atendimento real a clientes) funcional.

---

## 1. Warm-up de número novo

- Número novo nunca deve começar em volume alto. Primeiras 1-2 semanas com rampa gradual.
- Sugestão de rampa: dia 1-3 → até 20 conversas/dia; dia 4-7 → até 50; semana 2 → até 150-200; depois escalar conforme estabilidade.
- Priorizar receber mensagens (inbound) antes de iniciar muitos contatos novos (outbound).
- Antes de qualquer disparo em massa, o número deve ter histórico de uso "humano" (conversas reais, não só automação).

## 2. Rate limiting / throttling de disparo

- Nunca enviar mensagens em loop sem delay.
- Delay mínimo entre envios: aleatório, não fixo (ex: `random(3, 15)` segundos), para evitar padrão detectável de robô.
- Limite diário/horário por número (ex: máximo configurável de mensagens/dia, começando conservador e ajustando com base em métricas de bloqueio/denúncia).
- Implementar throttling real na infraestrutura de filas (ex: rate limiter por número de origem — não apenas prioridade de fila). Se usar Sidekiq/BullMQ/etc., o throttling deve ser por `instance`/número, não global.
- Nunca processar uma lista de contatos inteira de forma síncrona dentro de um único job — sempre com controle de taxa entre os itens.

## 3. Simular comportamento humano

- Delay antes de enviar proporcional ao tamanho da mensagem (uma resposta longa não deve sair em milissegundos).
- Usar indicadores de presença (`typing...`, `recording...`) com duração plausível antes de enviar.
- Variar horários de atividade — evitar operação constante 24/7 em ritmo perfeitamente regular.
- Adicionar jitter aleatório em todos os tempos de resposta automatizados.

## 4. Evitar mensagens idênticas em massa (broadcast)

- Nunca enviar o mesmo texto, ao mesmo tempo, para uma lista grande de contatos — é o padrão mais forte de detecção de spam.
- Personalizar conteúdo (nome, variações de frase) quando possível.
- Espaçar bem o envio no tempo mesmo quando o conteúdo é necessariamente parecido.
- Evitar broadcast para contatos que nunca interagiram com o número — é o maior gatilho de denúncia → ban.

## 5. Controle de contatos novos

- Limitar quantos números **novos** (sem histórico de conversa) podem ser contatados por dia.
- Priorizar fluxos onde o cliente inicia o contato (opt-in ativo) em vez de prospecção fria via WhatsApp.

## 6. Opt-in e opt-out

- Só enviar mensagens para quem deu consentimento explícito (cadastro, formulário, clique em link "falar no WhatsApp", etc.).
- Implementar opt-out real e funcional — parar de enviar imediatamente para quem solicitou ou bloqueou.
- Manter um campo de status de consentimento por contato (`opted_in` / `opted_out`) na modelagem de dados, e toda rotina de disparo em massa deve filtrar por esse campo antes de processar a lista.

## 7. Monitoramento proativo e circuit breaker

- Escutar webhooks de status de conexão da Evolution API (desconexões, erros de sessão, mudanças de estado) e tratar como sinal de risco — não apenas reconectar automaticamente sem investigar.
- Monitorar taxa de bloqueio/denúncia ao longo do tempo; se subir, é sinal de alerta antes do ban acontecer.
- Implementar um circuit breaker: se detectar padrão repetido de erro, desconexão, ou taxa de bloqueio elevada, pausar disparos automáticos daquele número até revisão manual.
- Logar e alertar (não apenas registrar em log passivo) quando esses sinais de risco aparecerem — a proteção só é útil se resultar em ação.

## 8. Infraestrutura de conexão

- Evitar trocar de IP/dispositivo constantemente para a mesma sessão — muda o fingerprint da conexão e levanta suspeita.
- Não rodar múltiplas instâncias/sessões simultâneas para o mesmo número.
- Ao usar múltiplos números em rotação para distribuir carga, cada número individual ainda precisa passar pelo próprio warm-up (regra 1) — não é atalho para pular a rampa.

## 9. Retry e tratamento de erro

- Falhas de envio não devem gerar retry agressivo/imediato em loop — aplicar backoff exponencial com jitter.
- Erros de sessão/desconexão da Evolution API não devem disparar reconexão em loop apertado; espaçar tentativas.

## 10. Caminho de longo prazo

- Este conjunto de regras reduz o risco, mas não elimina — a conexão via Baileys/Evolution API é tecnicamente não-oficial e sempre carrega risco residual.
- Para uso comercial com volume crescente, planejar migração gradual para a **Meta Cloud API oficial** (ou um BSP homologado como 360dialog) assim que o volume/criticidade do negócio justificar. Nesse cenário, a proteção anti-ban deixa de ser responsabilidade da aplicação e passa a ser garantida formalmente pela Meta.

---

## Checklist rápido para novas implementações

- [ ] Rampa de warm-up configurada e respeitada para números novos
- [ ] Delay aleatório entre envios implementado (nunca fixo, nunca zero)
- [ ] Limite diário/horário de mensagens por número configurável
- [ ] Throttling real na fila (não apenas prioridade)
- [ ] Nenhum job processa uma lista inteira de contatos de forma síncrona sem controle de taxa
- [ ] Conteúdo de broadcast personalizado ou bem espaçado no tempo
- [ ] Limite de novos contatos/dia implementado
- [ ] Campo de opt-in/opt-out no modelo de contato, respeitado em toda rotina de disparo
- [ ] Webhooks de status de conexão monitorados ativamente
- [ ] Circuit breaker implementado para pausar disparos em cenário de risco
- [ ] Retry com backoff exponencial + jitter em falhas de envio/reconexão
- [ ] Plano de migração para API oficial definido caso o volume cresça
