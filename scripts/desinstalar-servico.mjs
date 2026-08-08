import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from 'node-windows';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raizProjeto = path.resolve(__dirname, '..');

const svc = new Service({
  name: 'Q-Zap',
  script: path.join(raizProjeto, 'src', 'index.js'),
});

svc.on('alreadyuninstalled', () => {
  console.log('Servico "Q-Zap" ja nao estava instalado.');
});

svc.on('uninstall', () => {
  console.log('Servico "Q-Zap" desinstalado.');
});

svc.on('error', (erro) => {
  console.error('Erro ao desinstalar o servico:', erro);
  process.exitCode = 1;
});

console.log('Desinstalando o servico "Q-Zap" (requer privilegios de administrador)...');
svc.uninstall();
