/* ============================================================================
   EXPORTAREXCEL.JS — Geração da planilha Excel (SheetJS / XLSX).

   Extraído do arquivo original "calculadora_desapropriacao-parte1-motor-por
   -tipo-1.html", função exportarExcel(), seus helpers diretos (xlsxCelula,
   XLSX_FMT_MOEDA/XLSX_FMT_PCT/XLSX_FMT_FATOR) e o binding do botão #btnExcel.
   Nenhuma alteração de lógica — apenas realocação de código.

   DEPENDE de (já carregados antes deste arquivo):
     - js/util.js: fmtData, toast.
     - js/motor.js: ULTIMO_CALCULO.
     - Biblioteca de terceiro embutida no HTML: window.XLSX (SheetJS).

   NÃO MODULARIZADO AINDA (permanece no arquivo original por ora — mesma
   situação já sinalizada em exportarPDF.js):
     - calcular(): exportarExcel() chama calcular() automaticamente se ainda
       não houver um cálculo feito (ULTIMO_CALCULO nulo).
     - bloqueadoPorAuditoria(): função COMPARTILHADA entre gerarPdf(),
       exportarExcel() e o botão de impressão — verifica se a auditoria
       encontrou erro crítico e, se sim, bloqueia a exportação com um alert().

   A planilha gerada tem 4 abas: Resumo, Memória de Cálculo, Parâmetros e
   Revisão Técnica (auditoria).
============================================================================ */

// Formatos numéricos reutilizados nas planilhas exportadas.
const XLSX_FMT_MOEDA = '"R$" #,##0.00;[Red]\\-"R$" #,##0.00';
const XLSX_FMT_PCT   = '0.0000"%"';
const XLSX_FMT_FATOR = '0.000000';

// Aplica negrito (quando o gerador de xlsx suportar escrita de estilos) sem
// quebrar a planilha nos casos em que o recurso não é suportado — apenas o
// valor e o formato numérico continuam garantidos em qualquer situação.
function xlsxCelula(ws, endereco, valor, opcoes){
  const cel = { v: valor, t: typeof valor === 'number' ? 'n' : 's' };
  if(opcoes && opcoes.z) cel.z = opcoes.z;
  if(opcoes && opcoes.bold) cel.s = { font:{ bold:true } };
  ws[endereco] = cel;
  return cel;
}

async function exportarExcel(){
  if(!ULTIMO_CALCULO){ await calcular(); if(!ULTIMO_CALCULO) return; }
  if(bloqueadoPorAuditoria()) return;
  try{
    if(!window.XLSX) throw new Error('Biblioteca de Excel não carregada (verifique sua conexão com a internet).');
    const c = ULTIMO_CALCULO;
    const agora = new Date();

    /* ---------------- Planilha 1: Resumo ---------------- */
    // AJUSTE (a pedido do usuário — "só sair no relatório o que ela usa"):
    // antes, algumas linhas "core" apareciam sempre, mesmo zeradas (oferta,
    // sentença, diferença, correção, juros moratórios). Agora TODAS as
    // linhas de item só aparecem se o valor correspondente foi de fato
    // usado/preenchido — mesmo padrão já aplicado a benfeitorias, juros
    // compensatórios, depósito, honorários e custas.
    const linhasItens = [
      c.valores.oferta !== 0 ? ['Valor da oferta', c.valores.oferta] : null,
      c.valores.sentenca !== 0 ? ['Valor fixado em sentença', c.valores.sentenca] : null,
      (c.valores.oferta !== 0 || c.valores.sentenca !== 0) ? ['Diferença apurada', c.valores.diferenca] : null,
      c.valores.benfeitoriasNominal > 0 ? ['Benfeitorias indenizáveis (valor nominal — correção já somada na linha "Correção monetária")', c.valores.benfeitoriasNominal] : null,
      Math.abs(c.valores.correcao) > 0.004 ? ['Correção monetária', c.valores.correcao] : null,
      c.valores.jurosComp > 0 ? ['Juros compensatórios', c.valores.jurosComp] : null,
      c.valores.juros > 0 ? ['Juros moratórios', c.valores.juros] : null,
      c.valores.depositoCorrigido > 0 ? ['Depósito judicial corrigido (dedução)', -c.valores.depositoCorrigido] : null,
      c.valores.honorVal > 0 ? ['Honorários sucumbenciais', c.valores.honorVal] : null,
      c.valores.custas > 0 ? ['Custas processuais', c.valores.custas] : null,
      c.valores.honorContratualVal > 0 ? ['Honorários contratuais (informativo)', c.valores.honorContratualVal] : null
    ].filter(Boolean);

    const resumo = [
      ['DEMONSTRATIVO DE CÁLCULO — DESAPROPRIAÇÃO'],
      [],
      ['Escritório', c.identificacao.escritorioNome || '—'],
      ['Advogado(a) responsável', c.identificacao.advogadoNome || '—'],
      ['OAB', c.identificacao.advogadoOAB || '—'],
      [],
      ['Tipo de ação', c.identificacao.tipoAcao || '—'],
      ['Processo', c.identificacao.numeroProcesso || '—'],
      ['Comarca/Vara', c.identificacao.comarca || '—'],
      ['Autor (expropriante)', c.identificacao.expropriante || '—'],
      ['Réu (expropriado[a])', c.identificacao.expropriado || '—'],
      [],
      ['Item', 'Valor (R$)'],
      ...linhasItens.map(l => [l[0], l[1]]),
      ['Valor total devido', c.valores.total],
      [],
      ['Gerado em', agora.toLocaleString('pt-BR')]
    ];
    const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
    wsResumo['!cols'] = [{wch:38},{wch:20}];
    wsResumo['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:1} }];

    // Título em negrito e maior destaque
    xlsxCelula(wsResumo, 'A1', resumo[0][0], { bold:true });

    // Cabeçalho "Item / Valor (R$)" em negrito
    const linhaCabecalho = 12; // índice 0-based da linha ['Item','Valor (R$)']
    xlsxCelula(wsResumo, XLSX.utils.encode_cell({r:linhaCabecalho,c:0}), 'Item', { bold:true });
    xlsxCelula(wsResumo, XLSX.utils.encode_cell({r:linhaCabecalho,c:1}), 'Valor (R$)', { bold:true });

    // Formatação de moeda em todas as linhas de valores + linha do total
    const primeiraLinhaValor = linhaCabecalho + 1;
    const linhaTotal = primeiraLinhaValor + linhasItens.length;
    for(let i = 0; i < linhasItens.length; i++){
      const addr = XLSX.utils.encode_cell({ r: primeiraLinhaValor + i, c: 1 });
      if(wsResumo[addr]) wsResumo[addr].z = XLSX_FMT_MOEDA;
    }
    xlsxCelula(wsResumo, XLSX.utils.encode_cell({r:linhaTotal,c:0}), 'Valor total devido', { bold:true });
    xlsxCelula(wsResumo, XLSX.utils.encode_cell({r:linhaTotal,c:1}), c.valores.total, { bold:true, z: XLSX_FMT_MOEDA });
    ['A3','A4','A5','A7','A8','A9','A10','A11'].forEach(addr => {
      if(wsResumo[addr]) wsResumo[addr].s = { font:{ bold:true } };
    });

    /* ---------------- Planilha 2: Memória de cálculo mês a mês ---------------- */
    const memoriaHeader = ['Competência','Índice do mês (%)','Fator mensal','Fator acumulado','Valor corrigido (R$)','Fonte'];
    const memoriaLinhas = c.memoria.map(m => [m.competencia, m.taxa, m.fatorMensal, m.fatorAcumulado, m.valorCorrigido, m.fonte]);
    const wsMemoria = XLSX.utils.aoa_to_sheet([memoriaHeader, ...memoriaLinhas]);
    wsMemoria['!cols'] = [{wch:12},{wch:16},{wch:14},{wch:16},{wch:20},{wch:34}];
    wsMemoria['!rows'] = [{hpx:20}];
    wsMemoria['!freeze'] = { xSplit:0, ySplit:1, topLeftCell:'A2', activePane:'bottomLeft', state:'frozen' };
    wsMemoria['!autofilter'] = { ref: 'A1:F' + (memoriaLinhas.length + 1) };
    memoriaHeader.forEach((_, colIdx) => {
      const addr = XLSX.utils.encode_cell({ r:0, c:colIdx });
      if(wsMemoria[addr]) wsMemoria[addr].s = { font:{ bold:true } };
    });
    memoriaLinhas.forEach((_, i) => {
      const r = i + 1;
      const cTaxa = wsMemoria[XLSX.utils.encode_cell({r,c:1})]; if(cTaxa) cTaxa.z = XLSX_FMT_PCT;
      const cFatorM = wsMemoria[XLSX.utils.encode_cell({r,c:2})]; if(cFatorM) cFatorM.z = XLSX_FMT_FATOR;
      const cFatorA = wsMemoria[XLSX.utils.encode_cell({r,c:3})]; if(cFatorA) cFatorA.z = XLSX_FMT_FATOR;
      const cValor = wsMemoria[XLSX.utils.encode_cell({r,c:4})]; if(cValor) cValor.z = XLSX_FMT_MOEDA;
    });

    /* ---------------- Planilha 3: Parâmetros utilizados no cálculo ---------------- */
    const parametros = [
      ['PARÂMETROS UTILIZADOS NO CÁLCULO'],
      [],
      ['Data da oferta', c.datas.dataOferta ? fmtData(c.datas.dataOferta) : '—'],
      ['Data-base (atualização)', c.datas.dataBase ? fmtData(c.datas.dataBase) : '—'],
      ['Data de pagamento', c.datas.dataPagamento ? fmtData(c.datas.dataPagamento) : '—'],
      ['Data da imissão na posse', c.datas.dataImissao ? fmtData(c.datas.dataImissao) : '—'],
      [],
      ['Índice de correção monetária', c.fonteInfo && c.fonteInfo.detalhe ? c.fonteInfo.detalhe : '—'],
      [],
      ['Correção monetária — memória', c.descricoes.correcao],
      ['Juros compensatórios', c.descricoes.jurosComp],
      ['Juros moratórios', c.descricoes.juros],
      ['Depósito judicial', c.descricoes.deposito],
      ['Honorários sucumbenciais', c.descricoes.honor],
      ['Revisão técnica automática', (c.auditoria || []).filter(i=>i.nivel==='erro').length + ' erro(s), ' + (c.auditoria || []).filter(i=>i.nivel==='alerta').length + ' alerta(s) — ver aba "Revisão Técnica"'],
      [],
      ['Documento gerado por', c.identificacao.advogadoNome || c.identificacao.escritorioNome || '—'],
      ['Gerado em', agora.toLocaleString('pt-BR')]
    ];
    const wsParametros = XLSX.utils.aoa_to_sheet(parametros);
    wsParametros['!cols'] = [{wch:30},{wch:70}];
    wsParametros['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:1} }];
    xlsxCelula(wsParametros, 'A1', parametros[0][0], { bold:true });
    [2,3,4,5,7,9,10,11,12,13,14,16,17].forEach(r => {
      const addr = XLSX.utils.encode_cell({r,c:0});
      if(wsParametros[addr]) wsParametros[addr].s = { font:{ bold:true } };
    });

    /* ---------------- Planilha 4: Revisão técnica automática (auditoria) ---------------- */
    const nivelLabel = { erro: 'ERRO', alerta: 'ALERTA', info: 'INFO', ok: 'OK' };
    const auditoriaHeader = ['Nível', 'Observação'];
    const auditoriaLinhas = (c.auditoria || []).map(item => [nivelLabel[item.nivel] || item.nivel, item.msg]);
    const wsAuditoria = XLSX.utils.aoa_to_sheet([auditoriaHeader, ...auditoriaLinhas]);
    wsAuditoria['!cols'] = [{wch:10},{wch:100}];
    wsAuditoria['!freeze'] = { xSplit:0, ySplit:1, topLeftCell:'A2', activePane:'bottomLeft', state:'frozen' };
    auditoriaHeader.forEach((_, colIdx) => {
      const addr = XLSX.utils.encode_cell({ r:0, c:colIdx });
      if(wsAuditoria[addr]) wsAuditoria[addr].s = { font:{ bold:true } };
    });

    /* ---------------- Monta e exporta o arquivo ---------------- */
    const wb = XLSX.utils.book_new();
    wb.Props = {
      Title: 'Demonstrativo de Cálculo — Desapropriação',
      Subject: c.identificacao.numeroProcesso || 'Cálculo de desapropriação',
      Author: c.identificacao.escritorioNome || c.identificacao.advogadoNome || 'Calculadora de Desapropriação',
      CreatedDate: agora
    };
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
    XLSX.utils.book_append_sheet(wb, wsMemoria, 'Memória de Cálculo');
    XLSX.utils.book_append_sheet(wb, wsParametros, 'Parâmetros');
    XLSX.utils.book_append_sheet(wb, wsAuditoria, 'Revisão Técnica');

    const nomeArquivo = 'calculo-desapropriacao-' + (c.identificacao.numeroProcesso ? c.identificacao.numeroProcesso.replace(/[^\d]/g,'').slice(0,20) : new Date().toISOString().slice(0,10)) + '.xlsx';
    XLSX.writeFile(wb, nomeArquivo, { cellStyles: true });
    toast('Planilha Excel exportada com sucesso (Resumo, Memória de Cálculo e Parâmetros).');
  }catch(err){
    toast('Erro ao exportar Excel: ' + err.message, true);
  }
}


$('btnExcel').addEventListener('click', exportarExcel);
