export function criarRastreadorArquivos() {
  const pendentesPorArquivo = new Map();

  function registrarTotal(arquivo, total) {
    if (total > 0) {
      pendentesPorArquivo.set(arquivo, total);
    }
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

  return { registrarTotal, concluirItem };
}
