/* ============================================================================
   EXPORTARPDF.JS — Geração do relatório em PDF (jsPDF + jsPDF-AutoTable).

   Extraído do arquivo original "calculadora_desapropriacao-parte1-motor-por
   -tipo-1.html", função gerarPdf() e o binding do botão #btnPdf. Nenhuma
   alteração de lógica — apenas realocação de código. A única mudança de
   comportamento em relação ao arquivo original é a correção já aplicada e
   testada anteriormente: a coluna "Valor" da tabela-resumo agora tem largura
   fixa (columnStyles), o que evita que o autoTable quebre o número no meio
   (ex.: "R$ 40.460" numa linha e ",20" na seguinte) quando a descrição do
   item ao lado é longa. Essa correção já estava no HTML de origem desta
   extração.

   DEPENDE de (já carregados antes deste arquivo):
     - js/util.js: fmt, fmtData, fmtPct, formatarCodigoVerificacao,
       hashDocumento, toast.
     - js/motor.js: ULTIMO_CALCULO.
     - js/indices.js: NOMES_INDICE.
     - Bibliotecas de terceiro embutidas no HTML: window.jspdf.jsPDF
       (jsPDF + jsPDF-AutoTable) e, opcionalmente, window.QRCode (o QR de
       validação é omitido silenciosamente se a lib não estiver disponível,
       sem impedir a geração do restante do PDF).

   NÃO MODULARIZADO AINDA (permanece no arquivo original por ora — mesma
   situação já sinalizada em motor.js para coletarFaixasJurosComp/Mora):
     - calcular(): gerarPdf() chama calcular() automaticamente se ainda não
       houver um cálculo feito (ULTIMO_CALCULO nulo).
     - bloqueadoPorAuditoria(): função COMPARTILHADA entre gerarPdf(),
       exportarExcel() e o botão de impressão — verifica se a auditoria
       encontrou erro crítico e, se sim, bloqueia a exportação com um alert()
       e destaca o painel de auditoria na tela. Como é usada pelos três
       fluxos de exportação, decidir onde ela mora (aqui, em exportarExcel.js,
       ou num arquivo comum, ex. um futuro exportarComum.js) é uma decisão
       que prefiro tomar em conjunto antes de mover — por ora ela precisa
       continuar disponível no escopo global junto dos scripts de exportação.
============================================================================ */

async function gerarPdf(){
  if(!ULTIMO_CALCULO){ await calcular(); if(!ULTIMO_CALCULO) return; }
  if(bloqueadoPorAuditoria()) return;
  try{
    if(!window.jspdf || !window.jspdf.jsPDF) throw new Error('Biblioteca de PDF não carregada (verifique sua conexão com a internet).');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const c = ULTIMO_CALCULO;
    const margin = 16;
    const pageWidth = 210;
    const pageHeight = 297;
    let y = margin;

    // --- Timbre: identificação do escritório e do(a) advogado(a) responsável ---
    if(c.identificacao.escritorioNome){
      doc.setFont('helvetica','bold'); doc.setFontSize(13);
      doc.text(c.identificacao.escritorioNome, margin, y);
      y += 6;
    }
    const linhaAdvogado = [
      c.identificacao.advogadoNome ? 'Advogado(a): ' + c.identificacao.advogadoNome : null,
      c.identificacao.advogadoOAB || null
    ].filter(Boolean).join('   ·   ');
    if(linhaAdvogado){
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
      doc.setTextColor(91,100,114);
      doc.text(linhaAdvogado, margin, y);
      doc.setTextColor(0,0,0);
      y += 6;
    }
    if(c.identificacao.escritorioNome || linhaAdvogado){
      doc.setDrawColor(201,196,180); doc.setLineWidth(0.2);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    }

    doc.setFont('helvetica','bold'); doc.setFontSize(15);
    doc.text('Demonstrativo de Cálculo — ' + (c.identificacao.tipoAcao || 'Desapropriação'), margin, y);
    y += 7;
    doc.setDrawColor(156,122,60); doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    y += 7;

    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    const nomeIndice = NOMES_INDICE[c.fonteInfo && c.fonteInfo.indice] || '—';
    const partesDatas = [
      c.datas.dataOferta ? 'Data da oferta: ' + fmtData(c.datas.dataOferta) : null,
      c.datas.dataSentenca ? 'Data da sentença: ' + fmtData(c.datas.dataSentenca) : null,
      c.datas.dataPagamento
        ? 'Data do efetivo pagamento (quitação): ' + fmtData(c.datas.dataPagamento)
        : (c.datas.dataBase ? 'Data-base: ' + fmtData(c.datas.dataBase) : null)
    ].filter(Boolean).join('   |   ');
    const infoLinhas = [
      c.identificacao.numeroProcesso ? 'Processo: ' + c.identificacao.numeroProcesso : null,
      c.identificacao.comarca ? 'Comarca/Vara: ' + c.identificacao.comarca : null,
      c.identificacao.expropriante ? 'Autor (expropriante): ' + c.identificacao.expropriante : null,
      c.identificacao.expropriado ? 'Réu (expropriado[a]): ' + c.identificacao.expropriado : null,
      partesDatas || null,
      Math.abs(c.valores.correcao) > 0.004 ? 'Índice de correção utilizado: ' + nomeIndice + '   |   Fonte oficial: Banco Central do Brasil (SGS)' : null
    ].filter(Boolean);
    infoLinhas.forEach(linha => {
      const linhasQuebradas = doc.splitTextToSize(linha, pageWidth - margin*2);
      doc.text(linhasQuebradas, margin, y);
      y += 5.5 * linhasQuebradas.length;
    });
    y += 2;

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Item', 'Valor']],
      body: [
        c.valores.oferta !== 0 ? ['Valor da oferta', fmt(c.valores.oferta)] : null,
        c.valores.sentenca !== 0 ? ['Valor fixado em sentença', fmt(c.valores.sentenca)] : null,
        (c.valores.oferta !== 0 || c.valores.sentenca !== 0) ? ['Diferença apurada', fmt(c.valores.diferenca)] : null,
        c.valores.benfeitoriasNominal > 0 ? ['Benfeitorias indenizáveis (valor nominal — a correção monetária deste valor já está somada na linha "Correção monetária" abaixo)', fmt(c.valores.benfeitoriasNominal)] : null,
        Math.abs(c.valores.correcao) > 0.004 ? ['Correção monetária (' + c.descricoes.correcao + ')', fmt(c.valores.correcao)] : null,
        c.valores.jurosComp > 0 ? ['Juros compensatórios (' + c.descricoes.jurosComp + ')', fmt(c.valores.jurosComp)] : null,
        c.valores.juros > 0 ? ['Juros moratórios (' + c.descricoes.juros + ')', fmt(c.valores.juros)] : null,
        c.valores.depositoCorrigido > 0 ? ['Depósito judicial corrigido (dedução) (' + c.descricoes.deposito + ')', '- ' + fmt(c.valores.depositoCorrigido)] : null,
        c.valores.honorVal > 0 ? ['Honorários sucumbenciais (' + c.descricoes.honor + ')', fmt(c.valores.honorVal)] : null,
        c.valores.custas > 0 ? ['Custas processuais', fmt(c.valores.custas)] : null,
        c.valores.honorContratualVal > 0 ? ['Honorários contratuais (informativo)', fmt(c.valores.honorContratualVal)] : null
      ].filter(Boolean),
      foot: [['Valor total devido', fmt(c.valores.total)]],
      headStyles: { fillColor: [22,35,63] },
      footStyles: { fillColor: [46,107,79], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9.5, overflow: 'linebreak' },
      // Coluna "Item" acumula a descrição jurídica completa (pode ser longa);
      // a coluna "Valor" precisa de largura fixa suficiente para o maior
      // valor monetário esperado, senão o autoTable quebra o número no meio
      // (ex.: "R$ 40.460" numa linha e ",20" na linha seguinte) ao tentar
      // encolher essa coluna para dar espaço à descrição.
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 34, halign: 'right' }
      }
    });

    let y2 = doc.lastAutoTable.finalY + 10;
    if(y2 > 250){ doc.addPage(); y2 = margin; }
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text('Memória de cálculo completa — mês a mês', margin, y2);
    y2 += 4;

    // Memória de cálculo completa: imprime TODAS as competências apuradas,
    // sem truncar linhas — é o detalhamento mês a mês que fundamenta o total.
    doc.autoTable({
      startY: y2,
      margin: { left: margin, right: margin },
      head: [['Competência', 'Índice do mês', 'Fator mensal', 'Fator acumulado', 'Valor corrigido', 'Fonte']],
      body: c.memoria.map(m => [
        m.competencia, fmtPct(m.taxa,4), m.fatorMensal.toFixed(6), m.fatorAcumulado.toFixed(6), fmt(m.valorCorrigido), m.fonte
      ]),
      headStyles: { fillColor: [22,35,63] },
      styles: { fontSize: 8 },
      didParseCell: function(data){
        if(data.section === 'body' && c.memoria[data.row.index] && c.memoria[data.row.index].estimado){
          data.cell.styles.textColor = [138,109,29];
        }
      }
    });

    let y3 = doc.lastAutoTable.finalY + 8;
    if(y3 > 260){ doc.addPage(); y3 = margin; }

    // --- Revisão técnica automática (auditoria) ---
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.setTextColor(22,35,63);
    doc.text('Revisão técnica automática (auditoria)', margin, y3);
    y3 += 5.5;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
    (c.auditoria || []).forEach(item => {
      const cor = item.nivel === 'erro' ? [138,51,36] : item.nivel === 'alerta' ? [138,109,29] : item.nivel === 'ok' ? [46,107,79] : [91,100,114];
      const prefixo = item.nivel === 'erro' ? '[ERRO] ' : item.nivel === 'alerta' ? '[ALERTA] ' : item.nivel === 'ok' ? '[OK] ' : '[INFO] ';
      doc.setTextColor(cor[0], cor[1], cor[2]);
      const linhasItem = doc.splitTextToSize(prefixo + item.msg, pageWidth - margin*2);
      if(y3 > pageHeight - 20){ doc.addPage(); y3 = margin; }
      doc.text(linhasItem, margin, y3);
      y3 += linhasItem.length * 4 + 2;
    });
    doc.setTextColor(0,0,0);
    y3 += 4;

    if(y3 > 260){ doc.addPage(); y3 = margin; }
    doc.setFont('helvetica','italic'); doc.setFontSize(8.5);
    doc.setTextColor(91,100,114);
    const dataGeracao = new Date();
    const disclaimer = 'Cálculo estimado para fins referenciais, com correção mês a mês e juros pro rata sobre o período informado. A metodologia oficial pode variar conforme a legislação aplicável e o entendimento jurisprudencial vigente. Fonte oficial das taxas: Banco Central do Brasil — Sistema Gerenciador de Séries Temporais (SGS). Gerado em ' + dataGeracao.toLocaleString('pt-BR') + '.';
    const disclaimerLinhas = doc.splitTextToSize(disclaimer, pageWidth - margin*2);
    doc.text(disclaimerLinhas, margin, y3);
    y3 += disclaimerLinhas.length * 3.9 + 8;
    doc.setTextColor(0,0,0);

    // --- Assinatura eletrônica e selo de verificação (com QR Code opcional) ---
    if(y3 > pageHeight - 48){ doc.addPage(); y3 = margin; }
    doc.setDrawColor(156,122,60); doc.setLineWidth(0.5);
    doc.line(margin, y3, pageWidth - margin, y3);
    y3 += 7;

    doc.setFont('helvetica','bold'); doc.setFontSize(10.5);
    doc.setTextColor(22,35,63);
    doc.text('Assinatura eletrônica e selo de verificação', margin, y3);
    y3 += 6;

    // Código de verificação: hash calculado a partir dos dados do próprio
    // demonstrativo (não é um certificado digital ICP-Brasil — é um selo de
    // conferência que permite checar se os números impressos foram alterados).
    const codigoVerificacao = formatarCodigoVerificacao(hashDocumento(JSON.stringify({
      proc: c.identificacao.numeroProcesso, aut: c.identificacao.expropriante, reu: c.identificacao.expropriado,
      adv: c.identificacao.advogadoNome, oab: c.identificacao.advogadoOAB,
      total: c.valores.total, dataBase: c.datas.dataBase, gerado: dataGeracao.toISOString()
    })));

    const qrSize = 26;
    const temQrLib = !!(window.QRCode && typeof window.QRCode.toDataURL === 'function');
    const larguraTexto = temQrLib ? (pageWidth - margin*2 - qrSize - 6) : (pageWidth - margin*2);

    doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
    doc.setTextColor(22,35,63);
    const yAssinaturaInicio = y3;
    const linhasAssinatura = [
      c.identificacao.advogadoNome || null,
      c.identificacao.advogadoOAB || null,
      'Documento gerado eletronicamente em ' + dataGeracao.toLocaleString('pt-BR') + '.',
      'Código de verificação: ' + codigoVerificacao
    ].filter(Boolean);
    linhasAssinatura.forEach(linha => { doc.text(linha, margin, y3); y3 += 5; });

    doc.setFont('helvetica','italic'); doc.setFontSize(7.6);
    doc.setTextColor(91,100,114);
    const notaAssinatura = 'Este código é calculado a partir dos próprios dados do demonstrativo e serve para conferir que os valores impressos não foram alterados após a emissão. Não substitui assinatura digital certificada (ICP-Brasil) quando esta for exigida pelo juízo.';
    const notaLinhas = doc.splitTextToSize(notaAssinatura, larguraTexto);
    doc.text(notaLinhas, margin, y3);
    y3 += notaLinhas.length * 3.4;
    doc.setTextColor(0,0,0);

    // QR Code de validação (opcional): traz o link informado pelo escritório
    // ou, na ausência dele, o próprio código de verificação para conferência manual.
    if(temQrLib){
      try{
        const conteudoQr = c.identificacao.urlValidacao
          || ('Demonstrativo de calculo\nProcesso: ' + (c.identificacao.numeroProcesso || 'N/A') + '\nCodigo de verificacao: ' + codigoVerificacao);
        const qrDataUrl = await window.QRCode.toDataURL(conteudoQr, { margin: 1, width: 200 });
        doc.addImage(qrDataUrl, 'PNG', pageWidth - margin - qrSize, yAssinaturaInicio - 4, qrSize, qrSize);
        doc.setFont('helvetica','normal'); doc.setFontSize(6.8);
        doc.setTextColor(91,100,114);
        doc.text('Escaneie para validar', pageWidth - margin - qrSize, yAssinaturaInicio - 4 + qrSize + 3.5, { align: 'left' });
        doc.setTextColor(0,0,0);
      }catch(errQr){
        // Sem QR Code disponível (ex.: sem internet para carregar a biblioteca):
        // o relatório segue válido apenas com o código de verificação textual acima.
      }
    }

    const nomeArquivo = 'calculo-desapropriacao-' + (c.identificacao.numeroProcesso ? c.identificacao.numeroProcesso.replace(/[^\d]/g,'').slice(0,20) : new Date().toISOString().slice(0,10)) + '.pdf';
    doc.save(nomeArquivo);
    toast('PDF gerado com sucesso.');
  }catch(err){
    toast('Erro ao gerar PDF: ' + err.message, true);
  }
}

$('btnPdf').addEventListener('click', gerarPdf);
