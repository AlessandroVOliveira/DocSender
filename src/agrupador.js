import { extrairMarcador } from './marcador.js';

export function agruparPaginas(textosPorPagina) {
  const documentos = [];
  const erros = [];
  let grupoAtual = null;

  textosPorPagina.forEach((texto, indice) => {
    const numeroPagina = indice + 1;
    const marcador = extrairMarcador(texto);

    if (!marcador.valido) {
      grupoAtual = null;
      erros.push({ paginas: [numeroPagina], motivo: marcador.motivo });
      return;
    }

    const mesmoDocumento =
      grupoAtual && grupoAtual.numero === marcador.numero && grupoAtual.nome === marcador.nome;

    if (mesmoDocumento) {
      grupoAtual.paginas.push(numeroPagina);
      return;
    }

    grupoAtual = { numero: marcador.numero, nome: marcador.nome, paginas: [numeroPagina] };
    documentos.push(grupoAtual);
  });

  return { documentos, erros };
}
