/* ============================================================================
   LEITORPDF.JS — Importação e leitura de PDF (Fase 1 e Fase 2 do checklist)

   Responsabilidade deste arquivo: só ENTRADA e TEXTO BRUTO por página.
   - Fase 1 (Importação): botão "Anexar PDF", drag & drop, múltiplos PDFs,
     barra de progresso, cancelar leitura, histórico de arquivos.
   - Fase 2 (Leitura): leitura de PDF digital (pdf.js), OCR para páginas
     escaneadas (Tesseract.js), processamento em lotes e liberação de
     memória entre lotes, com as seguintes robustezes adicionais:
       • baixa qualidade: a imagem da página passa por conversão para
         escala de cinza + alargamento de contraste antes do OCR; se a
         confiança do OCR ainda ficar baixa, tenta de novo em resolução
         maior;
       • páginas giradas: a rotação DECLARADA no PDF (pagina.rotate) já é
         respeitada em toda renderização; se ainda assim a confiança do OCR
         ficar baixa (comum em digitalização por celular sem metadado de
         rotação), tenta as outras 3 rotações (90/180/270°) e fica com a de
         maior confiança;
       • PDFs grandes: processados em lotes, liberando memória da página e
         do canvas a cada uma — o limite de páginas (LIMITE_PAGINAS_PDF) é
         uma rede de segurança para casos extremos, não um teto normal de
         uso;
       • anexos: arquivos incorporados ao PDF (via anexo nativo do formato,
         não anexo de e-mail) são detectados; se forem PDFs, são lidos e
         suas páginas entram no pipeline junto com as do arquivo principal.

   Classificação (Fase 3), extração de campos (Fase 4) e inteligência
   jurídica (Fase 5) ficam em classificadorExtrator.js e
   inteligenciaJuridica.js. Conferência/preenchimento/relatório (Fases 6-8)
   ficam em painelConferencia.js — este arquivo só entrega o texto por
   página; quem orquestra o pipeline completo é painelConferencia.js.

   LIMITAÇÃO HONESTA SOBRE "OCR OFFLINE" (checklist pede Fase 2 offline):
   o Tesseract.js baixa o motor (wasm) e os dados de idioma ("por.traineddata")
   de uma CDN na primeira vez que roda nesta aba — igual ao jsPDF/xlsx que já
   existiam no app. Isso NÃO é OCR 100% offline "de fábrica". Como o app já é
   um PWA com service worker (sw.js), dá para colocar esses arquivos em cache
   depois da primeira leitura bem-sucedida e então funcionar sem internet nas
   próximas vezes — mas isso ainda não está feito aqui (ver observação no
   relatório da leitura, campo `avisoOffline`). Tratar como pendência real,
   não como algo já entregue.

   DEPENDE de: js/util.js ($, toast) e js/normalizadorTexto.js
   (normalizarTextoExtraido — Fase 1 do checklist: corrige erro comum de OCR,
   normaliza moeda/data e limpa espaçamento do texto de cada página antes de
   ela seguir para classificação/extração). Bibliotecas globais: pdfjsLib
   (pdf.js), Tesseract (Tesseract.js) — carregadas via <script> no index.html
   antes deste arquivo.
============================================================================ */

// Limite de páginas por arquivo: rede de segurança para não travar o
// navegador em casos patológicos, não um teto de uso normal — o
// processamento em lotes já libera memória a cada página/canvas, então
// suporta PDFs bem maiores que 2.000 páginas (o antigo limite "normal").
const LIMITE_PAGINAS_PDF = 20000;
const TAMANHO_LOTE_PAGINAS = 15;       // páginas por lote antes de liberar memória/ceder a UI
const MIN_CARACTERES_TEXTO_DIGITAL = 25; // abaixo disso, a página é tratada como escaneada -> OCR
const ESCALA_OCR_PADRAO = 2;   // resolução usada na primeira tentativa de OCR de cada página
const ESCALA_OCR_ALTA = 3;     // resolução usada quando a 1ª tentativa teve confiança baixa (baixa qualidade/borrado)
const LIMIAR_CONFIANCA_OCR_RETENTATIVA = 60; // confiança do Tesseract (0-100); abaixo disso, tenta de novo

if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ------------------------------------------------------------------------
   1. ESTADO DA LEITURA (para permitir cancelar entre páginas/lotes)
------------------------------------------------------------------------ */
const LEITOR_PDF_ESTADO = {
  cancelado: false,
  processando: false,
  workerOcr: null // reaproveitado entre páginas/arquivos para não recriar o worker do Tesseract a cada página
};

async function obterWorkerOcr(){
  if(LEITOR_PDF_ESTADO.workerOcr) return LEITOR_PDF_ESTADO.workerOcr;
  const worker = await Tesseract.createWorker('por', 1, {
    logger: () => {} // silencioso; o progresso já é reportado pela barra própria do app
  });
  LEITOR_PDF_ESTADO.workerOcr = worker;
  return worker;
}

async function encerrarWorkerOcr(){
  if(LEITOR_PDF_ESTADO.workerOcr){
    try{ await LEITOR_PDF_ESTADO.workerOcr.terminate(); }catch(e){}
    LEITOR_PDF_ESTADO.workerOcr = null;
  }
}

/* ------------------------------------------------------------------------
   2. UI: progresso, cancelar, drag & drop
------------------------------------------------------------------------ */
function atualizarProgressoLeitura(atual, total, rotulo){
  const wrap = $('leitorProgressoWrap');
  const barra = $('leitorProgressoBarra');
  const texto = $('leitorProgressoTexto');
  wrap.style.display = 'block';
  const pct = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;
  barra.style.width = pct + '%';
  texto.textContent = rotulo || (`Processando página ${atual} de ${total} (${pct}%)`);
}

function esconderProgressoLeitura(){
  $('leitorProgressoWrap').style.display = 'none';
}

function iniciarUiProcessamento(){
  LEITOR_PDF_ESTADO.processando = true;
  LEITOR_PDF_ESTADO.cancelado = false;
  $('btnCancelarLeitura').style.display = 'inline-block';
  $('btnAnexarPdf').disabled = true;
  $('inputPdf').disabled = true;
}

function encerrarUiProcessamento(){
  LEITOR_PDF_ESTADO.processando = false;
  $('btnCancelarLeitura').style.display = 'none';
  $('btnAnexarPdf').disabled = false;
  $('inputPdf').disabled = false;
}

class LeituraCanceladaError extends Error {
  constructor(){ super('Leitura cancelada pelo usuário.'); this.name = 'LeituraCanceladaError'; }
}

function verificarCancelamento(){
  if(LEITOR_PDF_ESTADO.cancelado) throw new LeituraCanceladaError();
}

// Cede o controle ao navegador entre lotes (repinta a barra de progresso,
// evita a página travar durante PDFs grandes).
function cederControleUi(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

/* ------------------------------------------------------------------------
   3. HISTÓRICO DE ARQUIVOS (Fase 1)
   Guardado em localStorage só com metadados leves (nome, data, contagens) —
   NUNCA o texto extraído do processo, por volume e por prudência com dados
   sensíveis de terceiros que possam constar no PDF.
------------------------------------------------------------------------ */
const CHAVE_HISTORICO_PDF = 'da_historico_leitura_pdf';

function lerHistoricoLeituraPdf(){
  try{
    return JSON.parse(localStorage.getItem(CHAVE_HISTORICO_PDF) || '[]');
  }catch(e){ return []; }
}

function registrarHistoricoLeituraPdf(entrada){
  try{
    const lista = lerHistoricoLeituraPdf();
    lista.unshift(entrada);
    localStorage.setItem(CHAVE_HISTORICO_PDF, JSON.stringify(lista.slice(0, 20)));
  }catch(e){ /* localStorage indisponível/cheio: histórico é cosmético, não bloqueia o app */ }
  renderizarHistoricoLeituraPdf();
}

function renderizarHistoricoLeituraPdf(){
  const container = $('historicoLeituraPdf');
  const lista = lerHistoricoLeituraPdf();
  if(!lista.length){ container.innerHTML = ''; return; }
  const linhas = lista.map(it =>
    `<li><span>${escaparHtml(it.nome)} — ${it.paginas} pág.${it.truncado ? ` (truncado em ${LIMITE_PAGINAS_PDF})` : ''}</span>` +
    `<span>${it.camposEncontrados}/${it.camposTotal} campos · ${new Date(it.quando).toLocaleString('pt-BR')}</span></li>`
  ).join('');
  container.innerHTML = `<strong>Arquivos já lidos nesta instalação</strong><ul>${linhas}</ul>`;
}

function escaparHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ------------------------------------------------------------------------
   4. LEITURA DE UM PDF: texto digital + OCR por página, em lotes
------------------------------------------------------------------------ */
// Devolve { nomeArquivo, paginas: [{numero, texto, fonte}], truncado, totalPaginasOriginal, tempoMs }
async function lerUmPdf(arquivo){
  const inicio = performance.now();
  const bytes = await arquivo.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  const totalPaginasOriginal = pdf.numPages;
  const truncado = totalPaginasOriginal > LIMITE_PAGINAS_PDF;
  const totalAProcessar = Math.min(totalPaginasOriginal, LIMITE_PAGINAS_PDF);

  if(truncado){
    const aviso = $('avisoTruncamento');
    aviso.style.display = 'block';
    aviso.textContent = `"${arquivo.name}" tem ${totalPaginasOriginal} páginas — apenas as primeiras ${LIMITE_PAGINAS_PDF} serão lidas (limite de processamento).`;
  }

  const paginas = [];
  let numeroPagina = 1;

  while(numeroPagina <= totalAProcessar){
    verificarCancelamento();
    const fimDoLote = Math.min(numeroPagina + TAMANHO_LOTE_PAGINAS - 1, totalAProcessar);

    for(let n = numeroPagina; n <= fimDoLote; n++){
      verificarCancelamento();
      atualizarProgressoLeitura(n, totalAProcessar, `Lendo página ${n} de ${totalAProcessar} — "${arquivo.name}"`);

      const pagina = await pdf.getPage(n);
      const conteudoTexto = await pagina.getTextContent();
      let texto = conteudoTexto.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      let fonte = 'digital';

      if(texto.length < MIN_CARACTERES_TEXTO_DIGITAL){
        // Página provavelmente escaneada (imagem) -> OCR
        atualizarProgressoLeitura(n, totalAProcessar, `OCR na página ${n} de ${totalAProcessar} (sem texto digital) — "${arquivo.name}"`);
        texto = await ocrDaPagina(pagina);
        fonte = 'ocr';
      }

      // Fase 1 do checklist: corrige erro comum de OCR, normaliza moeda/data
      // e limpa espaçamento ANTES de a página seguir para classificação/
      // extração (normalizadorTexto.js).
      if(typeof normalizarTextoExtraido === 'function') texto = normalizarTextoExtraido(texto, fonte);

      paginas.push({ numero: n, texto, fonte });

      // Libera referências da página o quanto antes (páginas de PDF grandes
      // seguram recursos internos do pdf.js até o garbage collector passar).
      pagina.cleanup && pagina.cleanup();
    }

    numeroPagina = fimDoLote + 1;
    await cederControleUi(); // deixa a barra repintar e a UI responder antes do próximo lote
  }

  const { paginasExtras, anexosNaoLidos } = await lerAnexosDoPdf(pdf, arquivo.name);
  paginas.push(...paginasExtras);

  await pdf.destroy();

  const tempoMs = performance.now() - inicio;
  return { nomeArquivo: arquivo.name, paginas, truncado, totalPaginasOriginal, tempoMs, anexosLidos: paginasExtras.length, anexosNaoLidos };
}

// Renderiza a página em um canvas numa dada escala, com uma rotação
// ADICIONAL (em graus) somada à rotação já declarada no PDF (pagina.rotate).
// Rotação 0 sempre respeita o que o PDF já declara — as tentativas de
// 90/180/270 só entram quando a confiança do OCR na rotação declarada foi
// baixa (ver ocrDaPagina).
async function renderizarPaginaEmCanvas(pagina, escala, rotacaoExtra){
  const rotacaoBase = pagina.rotate || 0;
  const viewport = pagina.getViewport({ scale: escala, rotation: (rotacaoBase + rotacaoExtra + 360) % 360 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const contexto = canvas.getContext('2d');
  await pagina.render({ canvasContext: contexto, viewport }).promise;
  return canvas;
}

function liberarCanvas(canvas){
  canvas.width = 0;
  canvas.height = 0;
}

// Pré-processamento simples de imagem para ajudar o OCR em digitalizações
// de baixa qualidade: converte para escala de cinza (reduz ruído de cor de
// papel amarelado/desbotado) e alarga o contraste entre o tom mais claro e
// o mais escuro encontrados na própria página — sem isso, digitalizações
// "lavadas" (pouco contraste entre tinta e fundo) confundem bastante o
// Tesseract. Roda direto no canvas já renderizado, antes de mandar pro OCR.
function prepararCanvasParaOcr(canvas){
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const totalPixels = canvas.width * canvas.height;
  const cinza = new Uint8ClampedArray(totalPixels);
  let min = 255, max = 0;
  for(let i = 0, j = 0; i < d.length; i += 4, j++){
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    cinza[j] = g;
    if(g < min) min = g;
    if(g > max) max = g;
  }
  const alcance = Math.max(1, max - min);
  for(let i = 0, j = 0; i < d.length; i += 4, j++){
    const v = Math.round(((cinza[j] - min) / alcance) * 255);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

async function ocrDoCanvas(canvas){
  const worker = await obterWorkerOcr();
  const { data } = await worker.recognize(canvas);
  return {
    texto: (data && data.text || '').replace(/\s+/g, ' ').trim(),
    confianca: (data && typeof data.confidence === 'number') ? data.confidence : 0
  };
}

// OCR de uma página com tentativas progressivas — cobre "baixa qualidade"
// e "páginas giradas" do checklist. A maioria das páginas (qualidade normal,
// rotação já correta) faz UMA tentativa só; o custo extra (resolução maior,
// depois rotações alternativas) só é pago quando a confiança do próprio
// Tesseract sai baixa, então PDFs bons não ficam mais lentos por isto.
async function ocrDaPagina(pagina){
  let canvas = await renderizarPaginaEmCanvas(pagina, ESCALA_OCR_PADRAO, 0);
  prepararCanvasParaOcr(canvas);
  let melhor = await ocrDoCanvas(canvas);
  liberarCanvas(canvas);

  if(melhor.confianca < LIMIAR_CONFIANCA_OCR_RETENTATIVA){
    // Provável baixa qualidade/imagem borrada: mais resolução antes de
    // gastar tentativas de rotação, que não ajudariam nesse caso.
    canvas = await renderizarPaginaEmCanvas(pagina, ESCALA_OCR_ALTA, 0);
    prepararCanvasParaOcr(canvas);
    const tentativaAltaRes = await ocrDoCanvas(canvas);
    liberarCanvas(canvas);
    if(tentativaAltaRes.confianca > melhor.confianca) melhor = tentativaAltaRes;
  }

  if(melhor.confianca < LIMIAR_CONFIANCA_OCR_RETENTATIVA){
    // Ainda ruim — pode ser página girada sem o PDF declarar isso nos
    // metadados (comum em digitalização por celular). Testa as outras 3
    // rotações e fica com a de maior confiança do próprio OCR.
    for(const graus of [90, 180, 270]){
      canvas = await renderizarPaginaEmCanvas(pagina, ESCALA_OCR_PADRAO, graus);
      prepararCanvasParaOcr(canvas);
      const tentativa = await ocrDoCanvas(canvas);
      liberarCanvas(canvas);
      if(tentativa.confianca > melhor.confianca) melhor = tentativa;
    }
  }

  return melhor.texto;
}

/* ------------------------------------------------------------------------
   4.1 ANEXOS INCORPORADOS AO PDF
   PDFs podem ter arquivos incorporados nativamente (não confundir com
   "anexo de e-mail"): pericias, plantas, comprovantes anexados pelo
   cartório/sistema do tribunal. pdf.js expõe isso via pdf.getAttachments().
   Se o anexo for outro PDF, ele é lido e suas páginas entram no pipeline
   junto com as do arquivo principal, identificadas por
   "<arquivo principal> → anexo: <nome>". Anexos que não são PDF (imagem,
   docx etc.) não são lidos automaticamente — ficam listados no relatório
   para o advogado abrir manualmente se for relevante.
------------------------------------------------------------------------ */
async function lerAnexosDoPdf(pdf, nomeArquivoPrincipal){
  const paginasExtras = [];
  const anexosNaoLidos = [];
  let anexos = null;
  try{ anexos = await pdf.getAttachments(); }catch(e){ anexos = null; }
  if(!anexos) return { paginasExtras, anexosNaoLidos };

  const nomes = Object.keys(anexos);
  for(const nomeAnexo of nomes){
    verificarCancelamento();
    const anexo = anexos[nomeAnexo];
    const conteudo = anexo && anexo.content;
    if(!conteudo || !conteudo.length) continue;

    const assinaturaPdf = conteudo.length > 4 && conteudo[0] === 0x25 && conteudo[1] === 0x50 && conteudo[2] === 0x44 && conteudo[3] === 0x46; // "%PDF"
    const pareceSerPdf = /\.pdf$/i.test(nomeAnexo) || assinaturaPdf;

    if(!pareceSerPdf){
      anexosNaoLidos.push({ nome: nomeAnexo, motivo: 'tipo de arquivo não suportado para leitura automática (só anexos em PDF são lidos)' });
      continue;
    }

    try{
      const pdfAnexo = await pdfjsLib.getDocument({ data: conteudo }).promise;
      const totalAnexo = Math.min(pdfAnexo.numPages, LIMITE_PAGINAS_PDF);
      for(let n = 1; n <= totalAnexo; n++){
        verificarCancelamento();
        atualizarProgressoLeitura(n, totalAnexo, `Lendo anexo "${nomeAnexo}" (pág. ${n} de ${totalAnexo}) — "${nomeArquivoPrincipal}"`);
        const paginaAnexo = await pdfAnexo.getPage(n);
        const conteudoTexto = await paginaAnexo.getTextContent();
        let texto = conteudoTexto.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
        let fonte = 'digital';
        if(texto.length < MIN_CARACTERES_TEXTO_DIGITAL){
          texto = await ocrDaPagina(paginaAnexo);
          fonte = 'ocr';
        }
        if(typeof normalizarTextoExtraido === 'function') texto = normalizarTextoExtraido(texto, fonte);
        paginasExtras.push({ numero: n, texto, fonte, arquivo: `${nomeArquivoPrincipal} → anexo: ${nomeAnexo}` });
        paginaAnexo.cleanup && paginaAnexo.cleanup();
      }
      await pdfAnexo.destroy();
    }catch(e){
      anexosNaoLidos.push({ nome: nomeAnexo, motivo: 'falha ao abrir o anexo como PDF (pode estar corrompido)' });
    }
  }
  return { paginasExtras, anexosNaoLidos };
}

/* ------------------------------------------------------------------------
   5. ORQUESTRAÇÃO: múltiplos arquivos anexados de uma vez
------------------------------------------------------------------------ */
// Devolve um array de resultados de lerUmPdf(), um por arquivo, na ordem em
// que foram anexados. Interrompe tudo (com toast, sem travar o app) se o
// usuário cancelar ou se algum PDF falhar ao abrir.
async function processarArquivosPdf(arquivos){
  if(!arquivos || !arquivos.length) return [];
  if(LEITOR_PDF_ESTADO.processando){
    toast('Já há uma leitura de PDF em andamento.', true);
    return [];
  }

  iniciarUiProcessamento();
  $('avisoTruncamento').style.display = 'none';
  const resultados = [];

  try{
    for(const arquivo of arquivos){
      verificarCancelamento();
      if(arquivo.type !== 'application/pdf' && !arquivo.name.toLowerCase().endsWith('.pdf')){
        toast(`"${arquivo.name}" ignorado (não é um PDF).`, true);
        continue;
      }
      const resultado = await lerUmPdf(arquivo);
      resultados.push(resultado);
    }
    return resultados;
  }catch(erro){
    if(erro instanceof LeituraCanceladaError){
      toast('Leitura cancelada.');
    }else{
      console.error(erro);
      toast('Erro ao ler o PDF: ' + erro.message, true);
    }
    return resultados; // devolve o que já foi processado até o cancelamento/erro
  }finally{
    encerrarUiProcessamento();
    esconderProgressoLeitura();
    await encerrarWorkerOcr(); // não deixa o worker do Tesseract vivo consumindo memória entre leituras
  }
}

/* ------------------------------------------------------------------------
   6. LIGAÇÃO COM A UI (botão, input file, drag & drop, cancelar)
   O disparo do pipeline completo (ler -> classificar -> extrair ->
   inteligência jurídica -> conferência) é feito por
   iniciarPipelineLeituraPdf(arquivos), definido em painelConferencia.js.
------------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', function(){
  const zona = $('zonaDropPdf');
  const input = $('inputPdf');

  $('btnAnexarPdf').addEventListener('click', () => input.click());
  zona.addEventListener('click', () => input.click());
  zona.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') input.click(); });

  input.addEventListener('change', () => {
    if(input.files && input.files.length){
      const arquivos = Array.from(input.files);
      input.value = ''; // permite reanexar o mesmo arquivo depois
      if(typeof iniciarPipelineLeituraPdf === 'function') iniciarPipelineLeituraPdf(arquivos);
    }
  });

  ['dragenter', 'dragover'].forEach(evento => {
    zona.addEventListener(evento, e => { e.preventDefault(); zona.classList.add('arrastando'); });
  });
  ['dragleave', 'drop'].forEach(evento => {
    zona.addEventListener(evento, e => { e.preventDefault(); zona.classList.remove('arrastando'); });
  });
  zona.addEventListener('drop', e => {
    const arquivos = Array.from(e.dataTransfer.files || []);
    if(arquivos.length && typeof iniciarPipelineLeituraPdf === 'function') iniciarPipelineLeituraPdf(arquivos);
  });

  $('btnCancelarLeitura').addEventListener('click', () => {
    LEITOR_PDF_ESTADO.cancelado = true;
  });

  renderizarHistoricoLeituraPdf();
});
