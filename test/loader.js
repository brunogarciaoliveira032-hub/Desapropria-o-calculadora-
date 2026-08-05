/* ============================================================================
   LOADER.JS — Carrega os arquivos reais de js/ num contexto Node `vm`,
   compartilhando o mesmo sandbox (documento fake, pdfjsLib/Tesseract mock),
   igual ao que acontece no navegador com várias tags <script> na mesma
   página. Nenhum arquivo de js/ é modificado — os testes exercitam o
   código de produção tal como ele está no zip enviado.

   Ordem de carregamento segue as dependências documentadas no topo de
   cada arquivo (util -> normalizadorTexto -> classificadorExtrator ->
   extratorCandidatos -> inteligenciaJuridica -> leitorPdf).
   painelConferencia.js NÃO é carregado: ele só orquestra renderização de
   UI (Fases 6/8), que não é o alvo destes testes de extração; os testes
   chamam extrairCampos()/aplicarInteligenciaJuridica() diretamente, do
   jeito que painelConferencia.js já faz internamente.
============================================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { montarSandbox } = require('./dom-stub');
const { montarMockPdfjs, montarMockTesseract } = require('./mocks-pdf-ocr');

const RAIZ_JS = path.join(__dirname, '..', 'js');

const ARQUIVOS_PIPELINE = [
  'util.js',
  'normalizadorTexto.js',
  'classificadorExtrator.js',
  'extratorCandidatos.js',
  'inteligenciaJuridica.js',
  'leitorPdf.js'
];

// Cria um contexto novo e independente, com pdfjsLib/Tesseract mockados e
// todos os módulos do pipeline carregados. Cada teste deve chamar isto de
// novo (não reaproveitar entre cenários) para não vazar estado global do
// app (LEITOR_PDF_ESTADO, histórico em localStorage etc.) de um teste para
// o outro.
function carregarContextoPipeline(){
  const sandbox = montarSandbox();
  sandbox.pdfjsLib = montarMockPdfjs();
  sandbox.Tesseract = montarMockTesseract();

  const contexto = vm.createContext(sandbox);

  for(const nomeArquivo of ARQUIVOS_PIPELINE){
    const caminho = path.join(RAIZ_JS, nomeArquivo);
    const codigo = fs.readFileSync(caminho, 'utf-8');
    // Envolve em (function(){ ... })() só para o `document.addEventListener(
    // 'DOMContentLoaded', ...)` no fim de leitorPdf.js não morrer por falta
    // de alguma variável de módulo ainda não carregada — na prática ele só
    // REGISTRA o listener, nunca é disparado nestes testes.
    const script = new vm.Script(codigo, { filename: caminho });
    script.runInContext(contexto);
  }

  return sandbox; // funções/consts top-level do app acessíveis como sandbox.xxx
}

module.exports = { carregarContextoPipeline, ARQUIVOS_PIPELINE };
