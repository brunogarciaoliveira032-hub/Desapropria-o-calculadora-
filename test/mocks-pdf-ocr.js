/* ============================================================================
   MOCKS-PDF-OCR.JS — pdfjsLib e Tesseract falsos, controláveis por página.

   Cada página de um "PDF fake" é descrita por um objeto:
     {
       digital: true|false,        // true = tem texto digital (pdf.js normal);
                                    // false = texto digital vazio/curto -> força OCR
       texto: '...',                // texto "digital" (usado quando digital:true)
       textoDigitalCurto: '',       // texto digital residual quando digital:false
                                    // (normalmente '' — simula página 100% imagem)
       rotacaoDeclarada: 0,         // pagina.rotate do pdf.js (rotação já sabida)
       ocr(escala, rotacaoTotal){   // função que decide o que o Tesseract "lê"
         return { texto, confianca };  // confianca 0-100, igual ao Tesseract real
       }
     }

   `ocr(escala, rotacaoTotal)` deixa cada teste simular exatamente o
   comportamento de leitorPdf.js que queremos exercitar: baixa confiança na
   1ª tentativa (força nova tentativa em resolução maior) e/ou baixa
   confiança mesmo em resolução maior (força varredura das 4 rotações).

   USO:
     const { montarMockPdfjs, montarMockTesseract, criarArquivoPdfFake } = require('./mocks-pdf-ocr');
     sandbox.pdfjsLib = montarMockPdfjs();
     sandbox.Tesseract = montarMockTesseract();
     const arquivo = criarArquivoPdfFake('processo.pdf', [ {digital:true, texto:'...'}, ... ]);
     const resultado = await sandbox.lerUmPdf(arquivo); // dentro do contexto vm
============================================================================ */

let proximoIdArquivo = 1;
const REGISTRO_ARQUIVOS = new Map(); // id -> { paginasDef, anexos }

function criarArquivoPdfFake(nome, paginasDef, opcoes){
  const id = String(proximoIdArquivo++);
  REGISTRO_ARQUIVOS.set(id, { paginasDef, anexos: (opcoes && opcoes.anexos) || null });
  return {
    name: nome,
    type: 'application/pdf',
    arrayBuffer: async () => Buffer.from(JSON.stringify({ id }), 'utf-8')
  };
}

function construirPaginaFake(def, numero){
  return {
    rotate: def.rotacaoDeclarada || 0,
    __def: def,
    __numero: numero,
    async getTextContent(){
      const texto = def.digital ? (def.texto || '') : (def.textoDigitalCurto || '');
      return { items: texto ? [{ str: texto }] : [] };
    },
    getViewport({ scale, rotation }){
      return { width: 600 * scale, height: 800 * scale, scale, rotation };
    },
    async render({ canvasContext, viewport }){
      // "Renderiza": só marca no contexto 2D fake qual página/escala/rotação
      // está sendo pedida, para o mock do Tesseract decidir o que "ler".
      canvasContext.__def = def;
      canvasContext.__numero = numero;
      canvasContext.__escala = viewport.scale;
      canvasContext.__rotacaoTotal = viewport.rotation;
      return { promise: Promise.resolve() };
    },
    cleanup(){}
  };
}

function montarMockPdfjs(){
  return {
    GlobalWorkerOptions: {},
    getDocument({ data }){
      const texto = Buffer.isBuffer(data) ? data.toString('utf-8') : Buffer.from(data).toString('utf-8');
      const { id } = JSON.parse(texto);
      const registro = REGISTRO_ARQUIVOS.get(id);
      if(!registro) throw new Error('Arquivo PDF fake não encontrado no registro de testes: ' + id);

      const promise = (async () => ({
        numPages: registro.paginasDef.length,
        async getPage(n){ return construirPaginaFake(registro.paginasDef[n - 1], n); },
        async getAttachments(){ return registro.anexos; },
        async destroy(){}
      }))();

      return { promise };
    }
  };
}

function montarMockTesseract(){
  return {
    async createWorker(){
      return {
        async recognize(canvas){
          const ctx = canvas.getContext('2d');
          const def = ctx.__def;
          const resultado = (def && typeof def.ocr === 'function')
            ? def.ocr(ctx.__escala, ctx.__rotacaoTotal)
            : { texto: '', confianca: 0 };
          return { data: { text: resultado.texto || '', confidence: resultado.confianca || 0 } };
        },
        async terminate(){}
      };
    }
  };
}

module.exports = { criarArquivoPdfFake, montarMockPdfjs, montarMockTesseract };
