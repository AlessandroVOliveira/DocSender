import { extrairTextoPorPagina } from './extratorTexto.js';
import { agruparPaginas } from './agrupador.js';
import { carregarPdfOrigem, gerarPdfGrupo } from './gerarPdfGrupo.js';

export async function processarArquivoPdf(dadosPdf) {
  // pdfjs-dist consome (detacha) o ArrayBuffer recebido, por isso extrai o texto
  // a partir de uma copia e preserva o buffer original para o pdf-lib.
  const textosPorPagina = await extrairTextoPorPagina(dadosPdf.slice());
  const { documentos, erros } = agruparPaginas(textosPorPagina);
  const origem = await carregarPdfOrigem(dadosPdf);

  for (const documento of documentos) {
    documento.pdfBytes = await gerarPdfGrupo(origem, documento.paginas);
  }
  for (const erro of erros) {
    erro.pdfBytes = await gerarPdfGrupo(origem, erro.paginas);
  }

  return { documentos, erros };
}
