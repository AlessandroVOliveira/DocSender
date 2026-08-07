import pino from 'pino';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../config/config.js';
import { aguardarConexao, enviarDocumento, enviarPresenca, enviarTexto } from '../src/evolutionClient.js';

const logger = pino({ level: 'info' });

async function gerarPdfSintetico() {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const pagina = doc.addPage();
  pagina.drawText('Q-Zap - teste manual da Etapa 4', { x: 50, y: 750, size: 14, font: fonte });
  return doc.save();
}

async function main() {
  const numero = config.numeroAdmin;

  console.log('=== aguardando conexao da Evolution API ===');
  await aguardarConexao({ logger });

  console.log(`=== disparando indicador de presenca para ${numero} ===`);
  await enviarPresenca(numero, 'composing', 2000);

  console.log(`=== enviando mensagem de texto para ${numero} ===`);
  await enviarTexto(numero, 'Teste manual da Etapa 4 do Q-Zap: cliente HTTP da Evolution API.');

  console.log(`=== enviando documento de teste para ${numero} ===`);
  const pdfBytes = await gerarPdfSintetico();
  await enviarDocumento(numero, {
    pdfBytes,
    nomeArquivo: 'teste-etapa4.pdf',
    legenda: 'Anexo de teste da Etapa 4',
  });

  console.log('\n=== teste manual concluido, confira o WhatsApp do numero administrador ===');
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 4', erro.response?.data ?? erro);
  process.exit(1);
});
