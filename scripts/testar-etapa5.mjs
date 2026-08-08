import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../config/config.js';
import { criarProcessadorDeItens } from '../src/index.js';
import { criarFila } from '../src/fila.js';
import { criarRastreadorArquivos } from '../src/rastreadorArquivos.js';
import { iniciarWatcher } from '../src/watcher.js';
import { aguardarConexao } from '../src/evolutionClient.js';

const logger = pino({ level: 'info' });

async function gerarPaginaTexto(doc, linhas) {
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const pagina = doc.addPage();
  linhas.forEach((linha, indice) => {
    pagina.drawText(linha, { x: 50, y: 750 - indice * 20, size: 12, font: fonte });
  });
}

async function gerarPdfSintetico(paginas) {
  const doc = await PDFDocument.create();
  for (const linhas of paginas) {
    await gerarPaginaTexto(doc, linhas);
  }
  return doc.save();
}

const ARQUIVOS = (numeroAdmin) => [
  {
    nome: 'etapa5-documento-valido.pdf',
    paginas: [[`$Q-Zap=${numeroAdmin}|Teste Etapa 5$`, 'Conteudo de teste']],
  },
  {
    nome: 'etapa5-documento-invalido.pdf',
    paginas: [['Relatorio sem marcador nenhum']],
  },
];

async function limparPastas() {
  for (const pasta of [config.pastas.entrada, config.pastas.enviados, config.pastas.erro, config.pastas.processado]) {
    const arquivos = await readdir(pasta);
    await Promise.all(
      arquivos
        .filter((arquivo) => arquivo.toLowerCase().startsWith('etapa5-'))
        .map((arquivo) => rm(path.join(pasta, arquivo))),
    );
  }
}

async function aguardarArquivosEm(pasta, prefixo, quantidadeEsperada, timeoutMs) {
  const inicio = Date.now();
  while (true) {
    const arquivos = (await readdir(pasta)).filter((arquivo) => arquivo.startsWith(prefixo));
    if (arquivos.length >= quantidadeEsperada) {
      return arquivos;
    }
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`timeout esperando ${quantidadeEsperada} arquivo(s) em ${pasta}, encontrados: ${arquivos.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function main() {
  await limparPastas();

  console.log('=== aguardando conexao da Evolution API ===');
  await aguardarConexao({ logger });

  const rastreador = criarRastreadorArquivos();
  const fila = criarFila(criarProcessadorDeItens(rastreador));

  console.log('=== iniciando watcher em', config.pastas.entrada, '===');
  const watcher = iniciarWatcher({ logger, fila, rastreador });
  await watcher.awaitReady?.();

  console.log('\n=== gravando arquivos de teste na pasta de entrada ===');
  const arquivos = ARQUIVOS(config.numeroAdmin);
  await Promise.all(
    arquivos.map(async (arquivo) => {
      const dadosPdf = await gerarPdfSintetico(arquivo.paginas);
      await writeFile(path.join(config.pastas.entrada, arquivo.nome), dadosPdf);
    }),
  );

  console.log('\n=== aguardando os 2 arquivos originais chegarem em processado/ ===');
  await aguardarArquivosEm(config.pastas.processado, 'etapa5-', 2, 30000);

  const emEnviados = await aguardarArquivosEm(config.pastas.enviados, 'etapa5-documento-valido', 1, 5000);
  const emErro = await aguardarArquivosEm(config.pastas.erro, 'etapa5-documento-invalido', 1, 5000);

  console.log('\n=== resultado ===');
  console.log('enviados/:', emEnviados);
  console.log('erro/:', emErro);
  console.log('\nConfira o WhatsApp do numero administrador: deve ter recebido o documento de teste com a mensagem do template.txt.');

  await watcher.close();
  await limparPastas();
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 5', erro);
  process.exit(1);
});
