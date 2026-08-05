/* ============================================================================
   DOM-STUB.JS — Stub mínimo de navegador para rodar util.js e leitorPdf.js
   em Node, sem precisar de um navegador/DOM real.

   Filosofia: não simular um DOM completo (isso seria reimplementar o
   jsdom). Só o suficiente para que:
     - $(id) / document.getElementById(id) sempre devolva um objeto "elemento
       fake" que aceita qualquer propriedade (style, classList, textContent,
       disabled, innerHTML...) sem lançar erro — os módulos testados usam
       esses elementos só para efeitos colaterais de UI (barra de progresso,
       toasts) que não nos interessam nos testes de extração.
     - document.createElement('canvas') devolva um canvas fake com
       getContext('2d') funcional o bastante para prepararCanvasParaOcr
       (getImageData/putImageData) e para o mock de render() de
       mocks-pdf-ocr.js marcar qual página/escala/rotação foi renderizada.
     - localStorage, performance, setTimeout/clearTimeout e
       document.addEventListener existam (mesmo que no-op) para não quebrar
       carregador.js/leitorPdf.js ao serem carregados.
============================================================================ */

function criarElementoFake(id){
  const el = {
    id,
    style: {},
    classList: {
      _set: new Set(),
      add(...cs){ cs.forEach(c => this._set.add(c)); },
      remove(...cs){ cs.forEach(c => this._set.delete(c)); },
      contains(c){ return this._set.has(c); }
    },
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    children: [],
    _listeners: {},
    addEventListener(evt, fn){ (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    removeEventListener(){},
    appendChild(child){ this.children.push(child); return child; },
    click(){},
    focus(){}
  };
  return el;
}

function criarContexto2DFake(canvas){
  return {
    __canvas: canvas,
    // getImageData/putImageData reais o bastante para prepararCanvasParaOcr
    // (escala de cinza + contraste) rodar sem erro sobre uma imagem "em
    // branco" — os testes de extração não dependem do conteúdo de pixel,
    // só de o pipeline não quebrar e de o texto do OCR mockado ser usado.
    getImageData(x, y, w, h){
      const data = new Uint8ClampedArray(w * h * 4).fill(200);
      return { data, width: w, height: h };
    },
    putImageData(){ /* no-op: não precisamos ler o resultado do pixel */ },
    drawImage(){},
    fillRect(){},
    clearRect(){}
  };
}

function criarCanvasFake(){
  const canvas = { width: 0, height: 0, __ctx: null };
  canvas.getContext = function(tipo){
    if(tipo !== '2d') return null;
    if(!canvas.__ctx) canvas.__ctx = criarContexto2DFake(canvas);
    return canvas.__ctx;
  };
  return canvas;
}

function montarDocumentoFake(){
  const registroElementos = new Map();
  const documento = {
    _listeners: {},
    getElementById(id){
      if(!registroElementos.has(id)) registroElementos.set(id, criarElementoFake(id));
      return registroElementos.get(id);
    },
    createElement(tag){
      if(tag === 'canvas') return criarCanvasFake();
      return criarElementoFake(null);
    },
    addEventListener(evt, fn){ (documento._listeners[evt] = documento._listeners[evt] || []).push(fn); },
    removeEventListener(){},
    // usado por algum trecho de UI para disparar o DOMContentLoaded manualmente
    // se algum teste precisar (não é necessário para os testes de extração).
    dispararDOMContentLoaded(){
      (documento._listeners['DOMContentLoaded'] || []).forEach(fn => fn());
    }
  };
  return documento;
}

function montarLocalStorageFake(){
  const dados = new Map();
  return {
    getItem(k){ return dados.has(k) ? dados.get(k) : null; },
    setItem(k, v){ dados.set(k, String(v)); },
    removeItem(k){ dados.delete(k); },
    clear(){ dados.clear(); }
  };
}

// Monta o objeto "sandbox" completo (vira o `global`/`window` do contexto vm
// onde os arquivos .js do app são carregados). Cada chamada devolve um
// sandbox NOVO e independente — importante para os testes não vazarem
// estado (histórico de leitura, worker de OCR reaproveitado etc.) de um
// cenário para outro.
function montarSandbox(){
  const documento = montarDocumentoFake();
  const sandbox = {
    document: documento,
    window: null, // preenchido abaixo, para permitir window.foo === global foo
    navigator: { userAgent: 'node-test-stub' },
    localStorage: montarLocalStorageFake(),
    console,
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
    TextEncoder,
    TextDecoder,
    Uint8ClampedArray,
    Array,
    Object,
    Map,
    Set,
    Promise,
    Math,
    JSON,
    Date,
    RegExp,
    isFinite,
    parseFloat,
    parseInt,
    String,
    Number,
    Boolean,
    encodeURIComponent,
    decodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

module.exports = { montarSandbox, criarElementoFake, criarCanvasFake };
