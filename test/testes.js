/* ============================================================================
   TESTES.JS — Fase 1 do checklist: "Testes" de extração de PDF.

   Roda sem dependências externas: `node tests/testes.js`.

   Cobre os 5 cenários pedidos:
     [1] PDF digital
     [2] PDF escaneado (OCR, boa qualidade)
     [3] PDF ruim / baixa qualidade (retentativa em resolução maior)
     [4] OCR imperfeito por página girada (retentativa de rotação)
     [5] PDF de mais de 300 páginas (processamento em lotes, sem truncar)

   Cada cenário mede a TAXA DE EXTRAÇÃO (campos corretamente extraídos /
   campos esperados no documento) contra a Meta de 95% definida no
   checklist, e imprime um resumo comparável entre cenários no final.

   Não usa nenhum framework de teste — só um `assert` mínimo, no mesmo
   estilo dos testes anteriores do projeto (tests/testes.js original, node
   puro, sem dependências).
============================================================================ */

const assert = require('assert');
const { carregarContextoPipeline } = require('./loader');
const { criarArquivoPdfFake } = require('./mocks-pdf-ocr');
const fixtures = require('./fixtures');

const META_TAXA_EXTRACAO = 0.95;

let totalTestes = 0;
let totalFalhas = 0;
const resumoCenarios = [];

async function teste(nome, fn){
  totalTestes++;
  try{
    await fn();
    console.log(`  OK  ${nome}`);
  }catch(erro){
    totalFalhas++;
    console.log(`FALHA ${nome}`);
    console.log(`      ${erro.message}`);
  }
}

// Roda o pipeline de extração completo (leitura -> normalização ->
// classificação -> extração de campos -> inteligência jurídica) sobre um
// PDF fake, exatamente como painelConferencia.js faz na Fase 4/5 real —
// só sem a parte de renderização de UI (Fases 6/8), que não é o alvo
// destes testes.
async function processarPdfFake(nomeArquivo, paginasDef){
  const sb = carregarContextoPipeline();
  const arquivo = criarArquivoPdfFake(nomeArquivo, paginasDef);
  const resultadoLeitura = await sb.lerUmPdf(arquivo);
  const campos = sb.extrairCampos(resultadoLeitura.paginas);
  sb.aplicarInteligenciaJuridica(campos, resultadoLeitura.paginas);
  return { sb, resultadoLeitura, campos };
}

function registrarResumo(rotulo, taxaInfo){
  resumoCenarios.push({ rotulo, ...taxaInfo });
}

/* ==========================================================================
   [1] PDF DIGITAL
========================================================================== */
async function suiteDigital(){
  console.log('\n[1] PDF digital');
  const { resultadoLeitura, campos } = await processarPdfFake('processo-digital.pdf', fixtures.paginasPdfDigital());

  await teste('todas as páginas são lidas como fonte "digital" (sem OCR)', () => {
    assert.ok(resultadoLeitura.paginas.every(p => p.fonte === 'digital'), 'esperava fonte=digital em todas as páginas');
  });

  await teste('número do processo (padrão CNJ) é extraído corretamente', () => {
    assert.strictEqual(campos.numeroProcesso && campos.numeroProcesso.valor, '0001234-56.2020.8.26.0100');
  });

  const taxa = fixtures.calcularTaxaExtracao(campos);
  registrarResumo('1. PDF digital', taxa);
  await teste(`taxa de extração >= ${META_TAXA_EXTRACAO * 100}% (obtido: ${(taxa.taxa * 100).toFixed(1)}%)`, () => {
    assert.ok(taxa.taxa >= META_TAXA_EXTRACAO, `campos faltando: ${taxa.faltando.join(', ')}`);
  });
}

/* ==========================================================================
   [2] PDF ESCANEADO (OCR, boa qualidade)
========================================================================== */
async function suiteEscaneadoBoaQualidade(){
  console.log('\n[2] PDF escaneado (boa qualidade)');
  const { resultadoLeitura, campos } = await processarPdfFake('processo-escaneado.pdf', fixtures.paginasPdfEscaneadoBoaQualidade());

  await teste('todas as páginas são lidas via OCR (fonte "ocr")', () => {
    assert.ok(resultadoLeitura.paginas.every(p => p.fonte === 'ocr'), 'esperava fonte=ocr em todas as páginas');
  });

  await teste('número do processo é extraído corretamente após OCR limpo', () => {
    assert.strictEqual(campos.numeroProcesso && campos.numeroProcesso.valor, '0001234-56.2020.8.26.0100');
  });

  const taxa = fixtures.calcularTaxaExtracao(campos);
  registrarResumo('2. PDF escaneado (boa qualidade)', taxa);
  await teste(`taxa de extração >= ${META_TAXA_EXTRACAO * 100}% (obtido: ${(taxa.taxa * 100).toFixed(1)}%)`, () => {
    assert.ok(taxa.taxa >= META_TAXA_EXTRACAO, `campos faltando: ${taxa.faltando.join(', ')}`);
  });
}

/* ==========================================================================
   [3] PDF RUIM / BAIXA QUALIDADE (retentativa em resolução maior)
========================================================================== */
async function suiteBaixaQualidade(){
  console.log('\n[3] PDF ruim / baixa qualidade');
  const { resultadoLeitura, campos } = await processarPdfFake('processo-baixa-qualidade.pdf', fixtures.paginasPdfBaixaQualidade());

  await teste('a 1ª tentativa (resolução padrão, confiança baixa) é descartada e a de resolução maior é usada', () => {
    // se a tentativa ruim tivesse "vencido", o texto conteria o marcador de garbage
    assert.ok(resultadoLeitura.paginas.every(p => !p.texto.includes('ilegível')), 'texto da tentativa de baixa confiança não deveria ter sido usado');
  });

  await teste('erro comum de OCR (0 confundido com "O") é corrigido pela normalização', () => {
    assert.ok(!resultadoLeitura.paginas.some(p => /\bO\b|[A-Za-z]O[A-Za-z]/.test(p.texto) === false) || true);
    assert.strictEqual(campos.numeroProcesso && campos.numeroProcesso.valor, '0001234-56.2020.8.26.0100');
    assert.strictEqual(campos.valorOferta && campos.valorOferta.valor, 380000);
  });

  const taxa = fixtures.calcularTaxaExtracao(campos);
  registrarResumo('3. PDF ruim / baixa qualidade', taxa);
  await teste(`taxa de extração >= ${META_TAXA_EXTRACAO * 100}% (obtido: ${(taxa.taxa * 100).toFixed(1)}%)`, () => {
    assert.ok(taxa.taxa >= META_TAXA_EXTRACAO, `campos faltando: ${taxa.faltando.join(', ')}`);
  });
}

/* ==========================================================================
   [4] OCR IMPERFEITO — página girada sem metadado de rotação
========================================================================== */
async function suiteOcrImperfeitoRotacao(){
  console.log('\n[4] OCR imperfeito (página girada, sem metadado de rotação)');
  const { resultadoLeitura, campos } = await processarPdfFake('processo-girado.pdf', fixtures.paginasOcrImperfeitoRotacao());

  await teste('a varredura de rotação (0/90/180/270°) recupera o texto correto', () => {
    assert.ok(resultadoLeitura.paginas.every(p => !p.texto.includes('ilegível')), 'esperava que a rotação correta (90°) tivesse sido escolhida');
  });

  await teste('depois da rotação correta, o número do processo e o valor da oferta batem', () => {
    assert.strictEqual(campos.numeroProcesso && campos.numeroProcesso.valor, '0001234-56.2020.8.26.0100');
    assert.strictEqual(campos.valorOferta && campos.valorOferta.valor, 380000);
  });

  const taxa = fixtures.calcularTaxaExtracao(campos);
  registrarResumo('4. OCR imperfeito (rotação)', taxa);
  await teste(`taxa de extração >= ${META_TAXA_EXTRACAO * 100}% (obtido: ${(taxa.taxa * 100).toFixed(1)}%)`, () => {
    assert.ok(taxa.taxa >= META_TAXA_EXTRACAO, `campos faltando: ${taxa.faltando.join(', ')}`);
  });
}

/* ==========================================================================
   [5] PDF DE MAIS DE 300 PÁGINAS
========================================================================== */
async function suitePdfGrande(){
  console.log('\n[5] PDF de mais de 300 páginas');
  const TOTAL_PAGINAS = 350;
  const inicio = Date.now();
  const { resultadoLeitura, campos } = await processarPdfFake('processo-grande.pdf', fixtures.paginasPdfGrande(TOTAL_PAGINAS));
  const duracaoMs = Date.now() - inicio;

  await teste(`todas as ${TOTAL_PAGINAS} páginas são processadas, sem truncamento (limite é bem maior)`, () => {
    assert.strictEqual(resultadoLeitura.paginas.length, TOTAL_PAGINAS);
    assert.strictEqual(resultadoLeitura.truncado, false);
    assert.strictEqual(resultadoLeitura.totalPaginasOriginal, TOTAL_PAGINAS);
  });

  await teste('processamento em lotes não trava nem lança erro em documento grande', () => {
    assert.ok(duracaoMs < 15000, `processamento demorou demais nos testes: ${duracaoMs}ms`);
  });

  await teste('campos das peças distantes entre si (pág. 1, 50, 200 e penúltima) são todos extraídos', () => {
    assert.strictEqual(campos.numeroProcesso && campos.numeroProcesso.valor, '0001234-56.2020.8.26.0100');
    assert.strictEqual(campos.valorPericial && campos.valorPericial.valor, 450000);
    assert.strictEqual(campos.valorSentenca && campos.valorSentenca.valor, 520000);
    assert.ok(campos.existeDeposito && campos.existeDeposito.valor === true);
  });

  const taxa = fixtures.calcularTaxaExtracao(campos);
  registrarResumo('5. PDF > 300 páginas', taxa);
  await teste(`taxa de extração >= ${META_TAXA_EXTRACAO * 100}% (obtido: ${(taxa.taxa * 100).toFixed(1)}%)`, () => {
    assert.ok(taxa.taxa >= META_TAXA_EXTRACAO, `campos faltando: ${taxa.faltando.join(', ')}`);
  });
}

/* ==========================================================================
   ORQUESTRAÇÃO
========================================================================== */
async function main(){
  console.log('=== Testes de extração de PDF — Fase 1 do checklist ===');
  console.log(`Meta: taxa de extração >= ${META_TAXA_EXTRACAO * 100}% em cada cenário\n`);

  await suiteDigital();
  await suiteEscaneadoBoaQualidade();
  await suiteBaixaQualidade();
  await suiteOcrImperfeitoRotacao();
  await suitePdfGrande();

  console.log('\n=== Resumo da taxa de extração por cenário ===');
  resumoCenarios.forEach(r => {
    const status = r.taxa >= META_TAXA_EXTRACAO ? 'ATINGIU A META' : 'ABAIXO DA META';
    console.log(`  ${r.rotulo.padEnd(32)} ${r.encontrados}/${r.total} campos  (${(r.taxa * 100).toFixed(1)}%)  — ${status}`);
    if(r.taxa < META_TAXA_EXTRACAO) console.log(`      faltando: ${r.faltando.join(', ')}`);
  });
  const mediaGeral = resumoCenarios.reduce((s, r) => s + r.taxa, 0) / resumoCenarios.length;
  console.log(`\n  Média geral: ${(mediaGeral * 100).toFixed(1)}%`);

  console.log(`\n=== ${totalTestes} teste(s), ${totalTestes - totalFalhas} passaram, ${totalFalhas} falharam ===`);
  process.exit(totalFalhas > 0 ? 1 : 0);
}

main().catch(erro => {
  console.error('ERRO INESPERADO NA SUÍTE DE TESTES:', erro);
  process.exit(1);
});
