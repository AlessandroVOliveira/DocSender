import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../config/config.js';
import { criarFila } from '../src/fila.js';
import { criarRastreadorArquivos } from '../src/rastreadorArquivos.js';
import { iniciarWatcher } from '../src/watcher.js';

const logger = pino({ level: 'warn' });

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

const ARQUIVOS = [
  {
    nome: 'documento-unico.pdf',
    paginas: [['$Q-Zap=5511999998888|Joao Silva$', 'Conteudo pagina 1']],
  },
  {
    nome: 'lote-multi-cliente.pdf',
    paginas: [
      ['$Q-Zap=5511999998888|Joao Silva$', 'Cliente A pagina 1'],
      ['$Q-Zap=5511999998888|Joao Silva$', 'Cliente A pagina 2'],
      ['$Q-Zap=5555996188546|Maria Souza$', 'Cliente B pagina 1'],
    ],
  },
  {
    nome: 'lote-com-erro.pdf',
    paginas: [
      ['Relatorio sem marcador nenhum'],
      ['$Q-Zap=5555996188546|Maria Souza$', 'Cliente valido'],
    ],
  },
];

async function limparPastaEntrada() {
  const arquivos = await readdir(config.pastas.entrada);
  await Promise.all(
    arquivos
      .filter((arquivo) => arquivo.toLowerCase().endsWith('.pdf'))
      .map((arquivo) => rm(path.join(config.pastas.entrada, arquivo))),
  );
}

async function aguardarTotal(itensProcessados, totalEsperado, timeoutMs) {
  const inicio = Date.now();
  while (itensProcessados.length < totalEsperado) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`timeout esperando itens da fila: ${itensProcessados.length}/${totalEsperado}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function main() {
  await limparPastaEntrada();

  const itensProcessados = [];
  const fila = criarFila(async (item) => {
    itensProcessados.push(item);
    console.log(
      `  [fila] tipo=${item.tipo} numero=${item.numero ?? '-'} nome=${item.nome ?? '-'} arquivoOrigem=${path.basename(item.arquivoOrigem)}`,
    );
  });

  console.log('=== iniciando watcher em', config.pastas.entrada, '===');
  const rastreador = criarRastreadorArquivos();
  const watcher = iniciarWatcher({ logger, fila, rastreador });
  await watcher.awaitReady?.();

  console.log('\n=== gravando arquivos simultaneamente na pasta de entrada ===');
  await Promise.all(
    ARQUIVOS.map(async (arquivo) => {
      const dadosPdf = await gerarPdfSintetico(arquivo.paginas);
      await writeFile(path.join(config.pastas.entrada, arquivo.nome), dadosPdf);
    }),
  );

  // documento-unico: 1 item | lote-multi-cliente: 2 itens | lote-com-erro: 2 itens (1 doc + 1 erro)
  const totalEsperado = 1 + 2 + 2;
  await aguardarTotal(itensProcessados, totalEsperado, 15000);

  console.log(`\n=== total de itens enfileirados e processados: ${itensProcessados.length} (esperado ${totalEsperado}) ===`);
  const porTipo = itensProcessados.reduce(
    (acc, item) => ({ ...acc, [item.tipo]: (acc[item.tipo] || 0) + 1 }),
    {},
  );
  console.log('por tipo:', porTipo);

  await watcher.close();
  await limparPastaEntrada();
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 3', erro);
  process.exit(1);
});
