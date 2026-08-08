import http from 'node:http';
import { config } from '../config/config.js';

function lerCorpo(requisicao) {
  return new Promise((resolve, reject) => {
    let bruto = '';
    requisicao.on('data', (pedaco) => {
      bruto += pedaco;
    });
    requisicao.on('end', () => resolve(bruto));
    requisicao.on('error', reject);
  });
}

export function iniciarServidorWebhook({ logger, onStatusConexao }) {
  const servidor = http.createServer(async (requisicao, resposta) => {
    if (requisicao.method !== 'POST') {
      resposta.writeHead(404).end();
      return;
    }

    try {
      const bruto = await lerCorpo(requisicao);
      const evento = JSON.parse(bruto);
      if (evento.event === 'connection.update' && evento.data?.state) {
        onStatusConexao(evento.data.state);
      }
    } catch (erro) {
      logger.warn({ erro: erro.message }, 'falha ao processar payload do webhook da Evolution API');
    }

    resposta.writeHead(200).end();
  });

  servidor.listen(config.webhookPort, '127.0.0.1', () => {
    logger.info({ porta: config.webhookPort }, 'servidor de webhook escutando');
  });

  return servidor;
}
