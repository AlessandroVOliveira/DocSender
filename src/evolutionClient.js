import axios from 'axios';
import { config } from '../config/config.js';

const http = axios.create({
  baseURL: config.evolution.url,
  headers: { apikey: config.evolution.apiKey },
});

const instancia = config.evolution.instancia;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function obterEstadoConexao() {
  const { data } = await http.get(`/instance/connectionState/${instancia}`);
  return data.instance.state;
}

export async function aguardarConexao({ logger, tentativas = 10, intervaloMs = 5000 }) {
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      const estado = await obterEstadoConexao();
      if (estado === 'open') {
        logger.info({ tentativa }, 'Evolution API conectada');
        return;
      }
      logger.warn({ tentativa, estado }, 'Evolution API ainda nao esta conectada, aguardando');
    } catch (erro) {
      logger.warn({ tentativa, erro: erro.message }, 'falha ao consultar status da Evolution API, aguardando');
    }
    await esperar(intervaloMs);
  }
  throw new Error(`Evolution API nao ficou pronta apos ${tentativas} tentativas`);
}

export async function enviarTexto(numero, texto) {
  const { data } = await http.post(`/message/sendText/${instancia}`, {
    number: numero,
    text: texto,
  });
  return data;
}

export async function enviarDocumento(numero, { pdfBytes, nomeArquivo, legenda }) {
  const media = Buffer.from(pdfBytes).toString('base64');
  const { data } = await http.post(`/message/sendMedia/${instancia}`, {
    number: numero,
    mediatype: 'document',
    mimetype: 'application/pdf',
    fileName: nomeArquivo,
    caption: legenda,
    media,
  });
  return data;
}

export async function configurarWebhook(url) {
  const { data } = await http.post(`/webhook/set/${instancia}`, {
    webhook: {
      enabled: true,
      url,
      byEvents: false,
      events: ['CONNECTION_UPDATE'],
    },
  });
  return data;
}

export async function enviarPresenca(numero, presence, delayMs) {
  const { data } = await http.post(`/chat/sendPresence/${instancia}`, {
    number: numero,
    presence,
    delay: delayMs,
  });
  return data;
}
