export function criarRastreadorArquivos() {
  const pendentesPorArquivo = new Map();
  const resultadosPorArquivo = new Map();

  function registrarTotal(arquivo, total) {
    if (total > 0) {
      pendentesPorArquivo.set(arquivo, total);
      resultadosPorArquivo.set(arquivo, []);
    }
  }

  function registrarResultado(arquivo, resultado) {
    resultadosPorArquivo.get(arquivo)?.push(resultado);
  }

  function concluirItem(arquivo) {
    const restante = (pendentesPorArquivo.get(arquivo) ?? 0) - 1;
    if (restante <= 0) {
      pendentesPorArquivo.delete(arquivo);
      return true;
    }
    pendentesPorArquivo.set(arquivo, restante);
    return false;
  }

  function obterResultados(arquivo) {
    const resultados = resultadosPorArquivo.get(arquivo) ?? [];
    resultadosPorArquivo.delete(arquivo);
    return resultados;
  }

  return { registrarTotal, registrarResultado, concluirItem, obterResultados };
}
