/* ============================================================================
   PAINELCONFERENCIA.JS — Orquestração do pipeline + Fases 6, 7 e 8.

   iniciarPipelineLeituraPdf(arquivos) é o ponto de entrada chamado por
   leitorPdf.js (anexar/drag&drop). Ele:
     1) lê todos os PDFs anexados (leitorPdf.js);
     2) concatena as páginas de todos os arquivos, marcando a origem de cada
        uma (arquivo + número da página);
     3) classifica e extrai campos (classificadorExtrator.js);
     4) aplica a inteligência jurídica (inteligenciaJuridica.js);
     5) renderiza o painel de conferência (Fase 6) e o relatório (Fase 8);
     6) deixa pronto o botão "Preencher formulário" (Fase 7).

   NADA é escrito nos campos do formulário antes do usuário clicar em
   "Preencher formulário automaticamente" na Fase 6 — a leitura, sozinha,
   nunca altera o que já está digitado.
============================================================================ */

// Definição dos campos que este módulo sabe preencher no formulário
// principal (Art. 1º a 7º do index.html). `semCampo:true` = extraído só
// para o relatório/conferência, sem correspondente no formulário atual.
const CAMPOS_PREENCHIVEIS = [
  // `elId` só existe quando o id do campo extraído difere do id do elemento
  // no formulário — caso de tipoAcaoDetectado, que é sugestão para o
  // <select id="tipoAcao"> já existente (não cria um campo novo no HTML).
  // Onde `elId` não é definido, quem usa este array (renderizarPainelConferencia,
  // preencherFormularioComConferencia, desfazerPreenchimentoPdf) cai de volta
  // no próprio `id`, exatamente como antes desta entrada existir.
  { id: 'tipoAcaoDetectado', elId: 'tipoAcao', rotulo: 'Tipo de ação (direta/indireta) — detectado', tipo: 'select-tipoacao' },
  { id: 'numeroProcesso', rotulo: 'Número do processo', tipo: 'texto' },
  { id: 'comarca', rotulo: 'Comarca/Vara', tipo: 'texto' },
  { id: 'expropriante', rotulo: 'Autor (expropriante)', tipo: 'texto' },
  { id: 'expropriado', rotulo: 'Réu (expropriado)', tipo: 'texto' },
  { id: 'valorOferta', rotulo: 'Valor da oferta', tipo: 'moeda' },
  { id: 'valorSentenca', rotulo: 'Valor da sentença/indenização', tipo: 'moeda' },
  { id: 'dataOferta', rotulo: 'Data da oferta', tipo: 'data' },
  { id: 'dataSentenca', rotulo: 'Data da sentença', tipo: 'data' },
  { id: 'dataImissao', rotulo: 'Data da imissão na posse', tipo: 'data' },
  { id: 'indice', rotulo: 'Índice de correção', tipo: 'select' },
  { id: 'percentualHonor', rotulo: '% Honorários sucumbenciais', tipo: 'numero' },
  { id: 'faixaCompTaxa', rotulo: 'Juros compensatórios (% a.a.)', tipo: 'numero' },
  { id: 'faixaMoraTaxa', rotulo: 'Juros moratórios (% a.a.)', tipo: 'numero' },
  { id: 'existeDeposito', rotulo: 'Houve depósito judicial', tipo: 'bool' },
  { id: 'aplicarEC113', rotulo: 'Trocar para Selic a partir de 12/2021 (EC 113/2021)', tipo: 'bool' },
  { id: 'valorPericial', rotulo: 'Valor pericial (referência — sem campo próprio)', tipo: 'moeda', semCampo: true },
  { id: 'areaImovel', rotulo: 'Área do imóvel (referência — sem campo próprio)', tipo: 'texto', semCampo: true }
];

/* ------------------------------------------------------------------------
   0. ESTADO DA ÚLTIMA LEITURA (para o fallback IA re-renderizar depois)
------------------------------------------------------------------------ */
let PAGINAS_ULTIMA_LEITURA = null;
let RESULTADOS_ULTIMA_LEITURA = null;
let TOTAL_PAGINAS_ULTIMA_LEITURA = 0;
let TEMPO_TOTAL_ULTIMA_LEITURA = 0;

/* ------------------------------------------------------------------------
   1. PIPELINE COMPLETO
------------------------------------------------------------------------ */
async function iniciarPipelineLeituraPdf(arquivos){
  const inicioTotal = performance.now();
  const resultados = await processarArquivosPdf(arquivos);
  if(!resultados.length) return; // cancelado, erro, ou nenhum PDF válido — leitorPdf.js já mostrou o toast

  // Concatena páginas de todos os arquivos anexados nesta leva, mantendo a
  // referência de origem (arquivo + página) para a Fase 6.
  const paginas = [];
  let totalPaginasLidas = 0;
  let algumTruncado = false;
  resultados.forEach(r => {
    algumTruncado = algumTruncado || r.truncado;
    r.paginas.forEach(p => {
      paginas.push({ numero: p.numero, texto: p.texto, fonte: p.fonte, arquivo: p.arquivo || r.nomeArquivo });
      totalPaginasLidas++;
    });
  });

  const campos = extrairCampos(paginas);
  aplicarInteligenciaJuridica(campos, paginas);

  const tempoTotalMs = performance.now() - inicioTotal;

  PAGINAS_ULTIMA_LEITURA = paginas;
  RESULTADOS_ULTIMA_LEITURA = resultados;
  TOTAL_PAGINAS_ULTIMA_LEITURA = totalPaginasLidas;
  TEMPO_TOTAL_ULTIMA_LEITURA = tempoTotalMs;

  renderizarRelatorio(resultados, totalPaginasLidas, tempoTotalMs, campos);
  renderizarPainelConferencia(campos);
  if(typeof renderizarAreaFallbackIA === 'function') renderizarAreaFallbackIA(campos, paginas);

  resultados.forEach(r => {
    const totalCampos = CAMPOS_PREENCHIVEIS.length;
    const encontrados = Object.keys(campos).filter(k => !k.startsWith('_')).length;
    registrarHistoricoLeituraPdf({
      nome: r.nomeArquivo,
      paginas: r.paginas.length,
      truncado: r.truncado,
      camposEncontrados: encontrados,
      camposTotal: totalCampos,
      quando: Date.now()
    });
  });

  toast(`Leitura concluída: ${totalPaginasLidas} página(s) processada(s).`);
}

// Chamada por iaFallback.js depois que a IA preenche/completa campos, para
// atualizar o relatório e a tabela de conferência sem precisar reler o PDF.
function reexibirAposFallbackIA(campos){
  renderizarRelatorio(RESULTADOS_ULTIMA_LEITURA, TOTAL_PAGINAS_ULTIMA_LEITURA, TEMPO_TOTAL_ULTIMA_LEITURA, campos);
  renderizarPainelConferencia(campos);
}

/* ------------------------------------------------------------------------
   2. FASE 8 — RELATÓRIO
------------------------------------------------------------------------ */
function renderizarRelatorio(resultados, totalPaginasLidas, tempoTotalMs, campos){
  const totalCampos = CAMPOS_PREENCHIVEIS.length;
  const idsEncontrados = Object.keys(campos).filter(k => !k.startsWith('_'));
  const encontrados = idsEncontrados.length;
  const pendentes = CAMPOS_PREENCHIVEIS.filter(c => !idsEncontrados.includes(c.id)).map(c => c.rotulo);
  const paginasOcr = resultados.reduce((soma, r) => soma + r.paginas.filter(p => p.fonte === 'ocr').length, 0);

  const segundos = (tempoTotalMs / 1000).toFixed(1);
  const nomesArquivos = resultados.map(r => escaparHtml(r.nomeArquivo)).join(', ');
  const totalAnexosLidos = resultados.reduce((n, r) => n + (r.anexosLidos || 0), 0);
  const anexosNaoLidos = resultados.flatMap(r => r.anexosNaoLidos || []);

  const alertas = [];
  if(campos._alertaTipoAcaoAmbiguo) alertas.push(campos._alertaTipoAcaoAmbiguo.mensagem);
  if(campos.tipoAcaoDetectado){
    const selecaoAtual = $('tipoAcao') ? $('tipoAcao').value : null;
    if(selecaoAtual && selecaoAtual !== campos.tipoAcaoDetectado.valor){
      const nomeDetectado = NOMES_TIPO_ACAO[campos.tipoAcaoDetectado.valor] || campos.tipoAcaoDetectado.valor;
      const nomeAtual = NOMES_TIPO_ACAO[selecaoAtual] || selecaoAtual;
      alertas.push(`O tipo de ação selecionado no formulário é "${nomeAtual}", mas as peças lidas indicam desapropriação ${ROTULOS_TIPO_ACAO[campos.tipoAcaoDetectado.valor] || campos.tipoAcaoDetectado.valor} (confiança ${Math.round(campos.tipoAcaoDetectado.confianca * 100)}%). Confira a sugestão na tabela de conferência antes de calcular.`);
    }
  }
  if(campos._alertaPaginasDuplicadas) alertas.push(campos._alertaPaginasDuplicadas.mensagem);
  if(campos._alertaPartesNaoIdentificadas) alertas.push(campos._alertaPartesNaoIdentificadas.mensagem);
  if(campos._alertaReforma) alertas.push(campos._alertaReforma.mensagem);
  if(campos._alertaIndiceAmbiguo) alertas.push(campos._alertaIndiceAmbiguo.mensagem);
  if(campos._alertaValorPericialDisponivel) alertas.push(campos._alertaValorPericialDisponivel.mensagem);
  if(campos._alertaDatas) alertas.push(campos._alertaDatas.mensagem);
  if(campos._alertasDuplicidadeValor) alertas.push(...campos._alertasDuplicidadeValor);
  anexosNaoLidos.forEach(a => alertas.push(`Anexo "${a.nome}" não foi lido automaticamente: ${a.motivo}.`));

  const html = `
    <strong>Relatório da leitura</strong><br>
    Arquivo(s): ${nomesArquivos}<br>
    Páginas processadas: ${totalPaginasLidas}${paginasOcr ? ` (${paginasOcr} via OCR)` : ''}<br>
    ${totalAnexosLidos ? `Páginas lidas de anexos incorporados ao PDF: ${totalAnexosLidos}<br>` : ''}
    Tempo de processamento: ${segundos}s<br>
    Campos encontrados: ${encontrados}/${totalCampos}<br>
    ${pendentes.length ? `Campos pendentes (não localizados — preencha manualmente): ${pendentes.map(escaparHtml).join(', ')}<br>` : ''}
    ${alertas.length ? `<div style="margin-top:8px;color:var(--alerta);">${alertas.map(a => '⚠ ' + escaparHtml(a)).join('<br>')}</div>` : ''}
  `;
  const painel = $('leitorRelatorio');
  painel.innerHTML = html;
  painel.classList.add('mostrar');
}

/* ------------------------------------------------------------------------
   3. FASE 6 — CONFERÊNCIA (editável, com confiança e página de origem)
------------------------------------------------------------------------ */
let CAMPOS_EM_CONFERENCIA = null; // guarda os valores (possivelmente editados pelo usuário) até o clique em "Preencher"

function renderizarPainelConferencia(campos){
  CAMPOS_EM_CONFERENCIA = campos;
  const relevantes = CAMPOS_PREENCHIVEIS.filter(c => campos[c.id]);

  if(!relevantes.length){
    $('tabelaConferencia').classList.remove('mostrar');
    $('tabelaConferencia').innerHTML = '';
    return;
  }

  const linhas = relevantes.map(c => {
    const dado = campos[c.id];
    const nivel = dado.confianca >= 0.7 ? 'alta' : (dado.confianca >= 0.45 ? 'media' : 'baixa');
    const origem = dado.fonte === 'ia'
      ? 'Sugerido por IA'
      : (dado.pagina ? `${escaparHtml(dado.pagina.arquivo || '')} · pág. ${dado.pagina.numero}${dado.pagina.fonte === 'ocr' ? ' (OCR)' : ''}` : '—');
    const trecho = dado.trecho ? escaparHtml(dado.trecho) : '';
    return `
      <tr data-campo="${c.id}">
        <td>${escaparHtml(c.rotulo)}${c.semCampo ? ' <span class="opt-tag">(informativo)</span>' : ''}</td>
        <td>${renderizarInputConferencia(c, dado)}</td>
        <td><span class="badge-conf ${nivel}">${Math.round(dado.confianca * 100)}%</span>${dado.observacao ? ` <span class="icone-obs" title="${escaparHtml(dado.observacao)}">⚠️</span>` : ''}</td>
        <td class="celula-origem" title="${trecho}">${origem}</td>
      </tr>`;
  }).join('');

  const html = `
    <strong>Conferência dos campos extraídos</strong>
    <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:0.82em;color:var(--text-muted);margin:6px 0 10px;">
      Revise e edite os valores abaixo antes de preencher o formulário. Passe o mouse sobre a coluna "origem" para ver o trecho do PDF que gerou o campo.
    </p>
    <table>
      <thead><tr><th>Campo</th><th>Valor</th><th>Confiança</th><th>Origem</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;">
      <button type="button" id="btnPreencherFormularioPdf">Preencher formulário automaticamente</button>
      <button type="button" id="btnDesfazerPreenchimentoPdf" style="display:none;">Desfazer preenchimento</button>
    </div>
  `;
  const container = $('tabelaConferencia');
  container.innerHTML = html;
  container.classList.add('mostrar');

  $('btnPreencherFormularioPdf').addEventListener('click', preencherFormularioComConferencia);
}

function renderizarInputConferencia(campoDef, dado){
  if(campoDef.semCampo){
    return `<span>${escaparHtml(String(dado.valor))}</span>`;
  }
  if(campoDef.tipo === 'bool'){
    return `<input type="checkbox" class="valorConferencia" ${dado.valor ? 'checked' : ''}>`;
  }
  if(campoDef.tipo === 'select' && campoDef.id === 'indice'){
    const opcoes = [['manual','Taxa personalizada'],['selic','Selic'],['ipca','IPCA'],['ipcae','IPCA-E'],['inpc','INPC'],['sentenca','Conforme sentença']];
    return `<select class="valorConferencia">${opcoes.map(([v,l]) => `<option value="${v}" ${v === dado.valor ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }
  if(campoDef.tipo === 'select-tipoacao'){
    // Espelha só as duas opções que o <select id="tipoAcao"> já tem hoje
    // (ver index.html) — as demais (execução, cobrança, outro) não têm
    // marcador de detecção em inteligenciaJuridica.js e por isso nunca
    // chegam aqui como sugestão.
    const opcoes = [['desapropriacao','Direta'],['indenizacao','Indireta']];
    return `<select class="valorConferencia">${opcoes.map(([v,l]) => `<option value="${v}" ${v === dado.valor ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }
  if(campoDef.tipo === 'data'){
    return `<input type="date" class="valorConferencia" value="${dado.valor || ''}">`;
  }
  if(campoDef.tipo === 'numero'){
    return `<input type="number" step="0.01" class="valorConferencia" value="${dado.valor != null ? dado.valor : ''}">`;
  }
  if(campoDef.tipo === 'moeda'){
    return `<input type="text" class="valorConferencia" value="${formatarValorParaCampoMoeda(dado.valor)}">`;
  }
  return `<input type="text" class="valorConferencia" value="${escaparHtml(String(dado.valor != null ? dado.valor : ''))}">`;
}

/* ------------------------------------------------------------------------
   4. FASE 7 — PREENCHIMENTO NO FORMULÁRIO (com destaque e desfazer)
------------------------------------------------------------------------ */
let SNAPSHOT_ANTES_PREENCHIMENTO_PDF = null;
// Referência à linha de #depositos criada pelo PREENCHIMENTO via PDF (se houver),
// para que um segundo clique em "Preencher formulário automaticamente" (ex.: depois
// do fallback de IA reprocessar os campos) ATUALIZE essa mesma linha em vez de
// adicionar uma nova — evitando depósito duplicado. Fica null se a linha foi
// removida manualmente pelo usuário (não recriamos o que ele apagou de propósito).
let LINHA_DEPOSITO_CRIADA_POR_PDF = null;

function preencherFormularioComConferencia(){
  if(!CAMPOS_EM_CONFERENCIA) return;

  const linhas = document.querySelectorAll('#tabelaConferencia tbody tr');
  const snapshot = {};
  const idsAlterados = [];

  linhas.forEach(linha => {
    const campoId = linha.dataset.campo;
    const def = CAMPOS_PREENCHIVEIS.find(c => c.id === campoId);
    if(!def || def.semCampo) return; // informativo — não tem campo no formulário
    const elId = def.elId || campoId; // ver comentário de `elId` em CAMPOS_PREENCHIVEIS
    const el = $(elId);
    if(!el) return;

    const inputConferencia = linha.querySelector('.valorConferencia');
    if(!inputConferencia) return;

    // Guarda o valor atual do formulário antes de sobrescrever, para o "Desfazer".
    // Chave pelo elId (não pelo campoId) porque é o elemento do DOM que
    // precisa ser restaurado — dois campoId diferentes nunca apontam para o
    // mesmo elId hoje, mas se apontassem, o snapshot já ficaria correto.
    snapshot[elId] = (def.tipo === 'bool') ? el.checked : el.value;

    if(def.tipo === 'bool'){
      el.checked = inputConferencia.checked;
    } else if(def.tipo === 'moeda'){
      // O campo do formulário guarda texto no formato "1.234,56" (ver moneyValue() em util.js).
      el.value = inputConferencia.value;
    } else {
      el.value = inputConferencia.value;
    }

    el.classList.add('campo-preenchido-pdf');
    idsAlterados.push(campoId);
  });

  // Depósito judicial: se marcado, cria (ou reaproveita) uma linha em #depositos
  // com valor/data extraídos (quando disponíveis).
  // CORREÇÃO: antes, cada clique em "Preencher formulário automaticamente"
  // chamava adicionarDeposito() incondicionalmente — um segundo clique (ex.:
  // repetido por engano, ou repetido depois que o fallback de IA reprocessa
  // os campos) criava uma SEGUNDA linha com os mesmos dados, duplicando o
  // depósito já antes de calcular() rodar. Agora a linha criada por este
  // preenchimento é lembrada em LINHA_DEPOSITO_CRIADA_POR_PDF e reutilizada
  // em cliques seguintes, em vez de criar outra. Se o usuário remover essa
  // linha manualmente (botão "remover"), ela não é recriada sozinha — só uma
  // nova linha aparece se ele clicar em "Preencher" de novo.
  if(CAMPOS_EM_CONFERENCIA.existeDeposito && CAMPOS_EM_CONFERENCIA.existeDeposito.valor){
    const aindaNoDom = LINHA_DEPOSITO_CRIADA_POR_PDF && document.body.contains(LINHA_DEPOSITO_CRIADA_POR_PDF);
    if(!aindaNoDom){
      adicionarDeposito();
      const linhasDeposito = document.querySelectorAll('#depositos .deposito');
      LINHA_DEPOSITO_CRIADA_POR_PDF = linhasDeposito[linhasDeposito.length - 1] || null;
    }
    const linha = LINHA_DEPOSITO_CRIADA_POR_PDF;
    if(linha){
      if(CAMPOS_EM_CONFERENCIA.depositoData) linha.querySelector('.depData').value = CAMPOS_EM_CONFERENCIA.depositoData.valor || '';
      if(CAMPOS_EM_CONFERENCIA.depositoValor) linha.querySelector('.depValor').value = CAMPOS_EM_CONFERENCIA.depositoValor.valor || '';
      linha.classList.add('campo-preenchido-pdf');
    }
  }

  SNAPSHOT_ANTES_PREENCHIMENTO_PDF = snapshot;
  $('btnDesfazerPreenchimentoPdf').style.display = 'inline-block';
  $('btnDesfazerPreenchimentoPdf').onclick = desfazerPreenchimentoPdf;

  toast(`${idsAlterados.length} campo(s) preenchido(s) a partir do PDF. Confira antes de calcular.`);
}

function desfazerPreenchimentoPdf(){
  if(!SNAPSHOT_ANTES_PREENCHIMENTO_PDF) return;
  Object.entries(SNAPSHOT_ANTES_PREENCHIMENTO_PDF).forEach(([elId, valorAnterior]) => {
    const el = $(elId);
    if(!el) return;
    // O snapshot é chaveado por elId (id do elemento no DOM), então a busca
    // do def também precisa ser por elId — ver comentário de `elId` em
    // CAMPOS_PREENCHIVEIS logo no topo do arquivo.
    const def = CAMPOS_PREENCHIVEIS.find(c => (c.elId || c.id) === elId);
    if(def && def.tipo === 'bool') el.checked = valorAnterior;
    else el.value = valorAnterior;
    el.classList.remove('campo-preenchido-pdf');
  });
  // CORREÇÃO: o snapshot só cobre os campos simples do formulário — a linha de
  // #depositos criada por este preenchimento (se houver) também precisa sumir
  // no desfazer, senão ela sobrevive e pode duplicar num preenchimento seguinte.
  if(LINHA_DEPOSITO_CRIADA_POR_PDF && document.body.contains(LINHA_DEPOSITO_CRIADA_POR_PDF)){
    LINHA_DEPOSITO_CRIADA_POR_PDF.remove();
  }
  LINHA_DEPOSITO_CRIADA_POR_PDF = null;
  SNAPSHOT_ANTES_PREENCHIMENTO_PDF = null;
  $('btnDesfazerPreenchimentoPdf').style.display = 'none';
  toast('Preenchimento desfeito.');
}
