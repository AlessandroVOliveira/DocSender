import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from 'node-windows';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raizProjeto = path.resolve(__dirname, '..');

const svc = new Service({
  name: 'Q-Zap',
  description: 'Envio automatico de documentos de ERPs legados via WhatsApp (Evolution API).',
  script: path.join(raizProjeto, 'src', 'index.js'),
  workingDirectory: raizProjeto,
});

svc.on('alreadyinstalled', () => {
  console.log('Servico "Q-Zap" ja esta instalado.');
});

svc.on('invalidinstallation', () => {
  console.error(
    'Instalacao existente invalida (arquivos do daemon ausentes). Remova a pasta src/daemon e tente novamente.',
  );
  process.exitCode = 1;
});

svc.on('install', () => {
  console.log('Servico "Q-Zap" instalado. Iniciando...');
  svc.start();
});

svc.on('start', () => {
  console.log('Servico "Q-Zap" iniciado.');
});

svc.on('error', (erro) => {
  console.error('Erro ao instalar/iniciar o servico:', erro);
  process.exitCode = 1;
});

console.log('Instalando o Q-Zap como servico do Windows (requer privilegios de administrador)...');
svc.install();
