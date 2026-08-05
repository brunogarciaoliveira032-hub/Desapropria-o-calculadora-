/* ============================================================================
   TESTES-IA.JS — Seção "IA" do checklist da Fase 2.

   Roda sem dependências externas: `node tests/testes-ia.js`.

   Cobre os 5 itens pedidos:
     [IA-1] Encontrou todos os valores  (oferta, pericial, sentença, depósito)
     [IA-2] Encontrou datas             (oferta, imissão, sentença, depósito
                                          + validação lógica: data futura e
                                          ordem cronológica improvável)
     [IA-3] Encontrou índice            (camada forte em sentença/acórdão,
                                          fallback de menção solta, e alerta
                                          de índice ambíguo)
     [IA-4] Encontrou modalidade        (direta/indireta via tipoAcaoDetectado,
                                          e caso ambíguo sem vencedor claro)
     [IA-5] Encontrou juros             (compensatórios e moratórios, e caso
                                          de ausência sem quebrar o pipeline)

   Exercita js/classificadorExtrator.js (extrairCampos) e
   js/inteligenciaJuridica.js (aplicarInteligenciaJuridica) — o mesmo par de
   funções que painelConferencia.js chama no pipeline real — carregados via
   tests/loader.js, sem modificar nenhum arquivo de produção.
============================================================================ */

const assert = require('assert');
const { carregarContextoPipeline } = require('./loader');
const { criarArquivoPdfFake } = require('./mocks-pdf-ocr');
const fixturesBase = require('./fixtures');
const fixturesIa = require('./fixtures-ia');

let totalTestes = 0;
let totalFalhas = 0;

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

// Mesmo helper de tests/testes.js: roda o pipeline completo (leitura ->
// normalização -> classificação -> extração de campos -> inteligência
// jurídica) sobre um PDF fake, sem a parte de renderização de UI.
async function processarPdfFake(nomeArquivo, paginasDef){
  const sb = carregarContextoPipeline();
  const arquivo = criarArquivoPdfFake(nomeArquivo, paginasDef);
  const resultadoLeitura = await sb.lerUmPdf(arquivo);
  const campos = sb.extrairCampos(resultadoLeitura.paginas);
  sb.aplicarInteligenciaJuridica(campos, resultadoLeitura.paginas);
  return { campos };
}

/* ==========================================================================
   [IA-1] VALORES
========================================================================== */
async function suiteValores(){
  console.log('\n[IA-1] Encontrou todos os valores');
  const { campos } = await processarPdfFake('doc-base.pdf', fixturesBase.paginasPdfDigital());

  await teste('valor da oferta (R$ 380.000,00) extraído da petição, com confiança >= 0.6', () => {
    assert.ok(campos.valorOferta, 'valorOferta não foi extraído');
    assert.strictEqual(campos.valorOferta.valor, 380000);
    assert.ok(campos.valorOferta.confianca >= 0.6, `confiança baixa: ${campos.valorOferta.confianca}`);
  });

  await teste('valor pericial (R$ 450.000,00) extraído do laudo, distinto do valor da sentença', () => {
    assert.ok(campos.valorPericial, 'valorPericial não foi extraído');
    assert.strictEqual(campos.valorPericial.valor, 450000);
  });

  await teste('valor da sentença (R$ 520.000,00) extraído com confiança alta (camada 1, página de sentença)', () => {
    assert.ok(campos.valorSentenca, 'valorSentenca não foi extraído');
    assert.strictEqual(campos.valorSentenca.valor, 520000);
    assert.ok(campos.valorSentenca.confianca >= 0.7, `esperava confiança de camada 1: ${campos.valorSentenca.confianca}`);
  });

  await teste('valor do depósito judicial (R$ 380.000,00) extraído, com existeDeposito = true', () => {
    assert.ok(campos.existeDeposito && campos.existeDeposito.valor === true);
    assert.ok(campos.depositoValor, 'depositoValor não foi extraído');
    assert.strictEqual(campos.depositoValor.valor, 380000);
  });

  await teste('os quatro valores distintos (oferta/pericial/sentença/depósito) nunca são confundidos entre si', () => {
    const valores = [campos.valorOferta.valor, campos.valorPericial.valor, campos.valorSentenca.valor];
    assert.strictEqual(new Set(valores).size, 3, 'oferta, pericial e sentença deveriam ter três valores distintos');
  });
}

/* ==========================================================================
   [IA-2] DATAS
========================================================================== */
async function suiteDatas(){
  console.log('\n[IA-2] Encontrou datas');
  const { campos } = await processarPdfFake('doc-base.pdf', fixturesBase.paginasPdfDigital());

  await teste('data da oferta (10/03/2020) extraída em formato ISO', () => {
    assert.ok(campos.dataOferta, 'dataOferta não foi extraída');
    assert.strictEqual(campos.dataOferta.valor, '2020-03-10');
  });

  await teste('data da imissão na posse (15/01/2020) extraída', () => {
    assert.ok(campos.dataImissao, 'dataImissao não foi extraída');
    assert.strictEqual(campos.dataImissao.valor, '2020-01-15');
  });

  await teste('data da sentença (20/09/2021, "publicada em") extraída da página de sentença', () => {
    assert.ok(campos.dataSentenca, 'dataSentenca não foi extraída');
    assert.strictEqual(campos.dataSentenca.valor, '2021-09-20');
  });

  await teste('data do depósito judicial (12/03/2020) extraída', () => {
    assert.ok(campos.depositoData, 'depositoData não foi extraída');
    assert.strictEqual(campos.depositoData.valor, '2020-03-12');
  });

  await teste('data no futuro (erro de leitura) é sinalizada e tem a confiança reduzida, sem ser descartada', async () => {
    const { campos: camposFutura } = await processarPdfFake('doc-data-futura.pdf', fixturesIa.paginasDataFutura());
    assert.ok(camposFutura.dataOferta, 'dataOferta deveria continuar preenchida mesmo sendo suspeita');
    assert.strictEqual(camposFutura.dataOferta.valor, '2099-03-10');
    assert.ok(camposFutura.dataOferta.confianca <= 0.2, `esperava confiança reduzida: ${camposFutura.dataOferta.confianca}`);
    assert.ok(camposFutura._alertaDatas, 'esperava alerta de data no futuro');
  });

  await teste('ordem cronológica improvável (sentença antes da oferta) reduz a confiança de ambas as datas', async () => {
    const { campos: camposOrdem } = await processarPdfFake('doc-ordem.pdf', fixturesIa.paginasOrdemCronologicaImprovavel());
    assert.ok(camposOrdem.dataOferta && camposOrdem.dataSentenca, 'as duas datas deveriam ter sido extraídas');
    assert.ok(camposOrdem.dataSentenca.confianca <= 0.3, `esperava confiança reduzida na sentença: ${camposOrdem.dataSentenca.confianca}`);
    assert.ok(camposOrdem.dataOferta.confianca <= 0.3, `esperava confiança reduzida na oferta: ${camposOrdem.dataOferta.confianca}`);
    assert.ok(camposOrdem._alertaDatas, 'esperava alerta de ordem cronológica improvável');
  });
}

/* ==========================================================================
   [IA-3] ÍNDICE DE CORREÇÃO MONETÁRIA
========================================================================== */
async function suiteIndice(){
  console.log('\n[IA-3] Encontrou índice');
  const { campos } = await processarPdfFake('doc-base.pdf', fixturesBase.paginasPdfDigital());

  await teste('índice (IPCA-E) extraído da página de sentença com âncora de correção monetária, confiança >= 0.75', () => {
    assert.ok(campos.indice, 'indice não foi extraído');
    assert.strictEqual(campos.indice.valor, 'ipcae');
    assert.ok(campos.indice.confianca >= 0.75, `esperava confiança de camada 1: ${campos.indice.confianca}`);
  });

  await teste('índice mencionado só de passagem (fora de sentença/acórdão) cai para a camada de fallback, com confiança baixa e observação', async () => {
    const { campos: camposSolto } = await processarPdfFake('doc-indice-solto.pdf', fixturesIa.paginasIndiceSolto());
    assert.ok(camposSolto.indice, 'indice deveria ter sido extraído pelo fallback');
    assert.strictEqual(camposSolto.indice.valor, 'selic');
    assert.ok(camposSolto.indice.confianca <= 0.4, `esperava confiança de fallback: ${camposSolto.indice.confianca}`);
    assert.ok(camposSolto.indice.observacao, 'esperava observação explicando a origem fraca do dado');
  });

  await teste('mais de um índice mencionado na sentença gera alerta de ambiguidade e reduz a confiança', async () => {
    const { campos: camposAmbiguo } = await processarPdfFake('doc-indice-ambiguo.pdf', fixturesIa.paginasIndiceAmbiguo());
    assert.ok(camposAmbiguo._alertaIndiceAmbiguo, 'esperava alerta de índice ambíguo');
    assert.ok(camposAmbiguo.indice, 'indice ainda deveria estar preenchido (não é descartado, só marcado como incerto)');
    assert.ok(camposAmbiguo.indice.confianca <= 0.35, `esperava confiança reduzida por ambiguidade: ${camposAmbiguo.indice.confianca}`);
  });
}

/* ==========================================================================
   [IA-4] MODALIDADE (DESAPROPRIAÇÃO DIRETA x INDIRETA)
========================================================================== */
async function suiteModalidade(){
  console.log('\n[IA-4] Encontrou modalidade');

  await teste('marcadores fortes e concordantes de desapropriação DIRETA (decreto de utilidade pública, DL 3.365/41, depósito prévio) são detectados', async () => {
    const { campos } = await processarPdfFake('doc-direta.pdf', fixturesIa.paginasModalidadeDireta());
    assert.ok(campos.tipoAcaoDetectado, 'tipoAcaoDetectado não foi definido');
    assert.strictEqual(campos.tipoAcaoDetectado.valor, 'desapropriacao');
    assert.ok(campos.tipoAcaoDetectado.confianca > 0, 'confiança deveria ser positiva');
  });

  await teste('marcadores fortes e concordantes de desapropriação INDIRETA (apossamento administrativo) são detectados', async () => {
    const { campos } = await processarPdfFake('doc-indireta.pdf', fixturesIa.paginasModalidadeIndireta());
    assert.ok(campos.tipoAcaoDetectado, 'tipoAcaoDetectado não foi definido');
    assert.strictEqual(campos.tipoAcaoDetectado.valor, 'indenizacao');
  });

  await teste('sinais equilibrados dos dois lados NÃO arriscam um palpite — ficam marcados como ambíguos', async () => {
    const { campos } = await processarPdfFake('doc-ambigua.pdf', fixturesIa.paginasModalidadeAmbigua());
    assert.strictEqual(campos.tipoAcaoDetectado, undefined, 'não deveria "chutar" um lado quando o placar está equilibrado');
    assert.ok(campos._alertaTipoAcaoAmbiguo, 'esperava alerta de tipo de ação ambíguo');
  });
}

/* ==========================================================================
   [IA-5] JUROS (COMPENSATÓRIOS E MORATÓRIOS)
========================================================================== */
async function suiteJuros(){
  console.log('\n[IA-5] Encontrou juros');
  const { campos } = await processarPdfFake('doc-base.pdf', fixturesBase.paginasPdfDigital());

  await teste('juros compensatórios (6,00% a.a.) extraídos da sentença', () => {
    assert.ok(campos.faixaCompTaxa, 'faixaCompTaxa não foi extraído');
    assert.strictEqual(campos.faixaCompTaxa.valor, 6);
  });

  await teste('juros moratórios (1,00% a.m.) extraídos da sentença, sem confundir com os compensatórios', () => {
    assert.ok(campos.faixaMoraTaxa, 'faixaMoraTaxa não foi extraído');
    assert.strictEqual(campos.faixaMoraTaxa.valor, 1);
    assert.notStrictEqual(campos.faixaMoraTaxa.valor, campos.faixaCompTaxa.valor);
  });

  await teste('sentença sem menção a juros deixa os campos ausentes, sem quebrar o pipeline nem inventar valor', async () => {
    const { campos: camposSemJuros } = await processarPdfFake('doc-sem-juros.pdf', fixturesIa.paginasSentencaSemJuros());
    assert.strictEqual(camposSemJuros.faixaCompTaxa, undefined);
    assert.strictEqual(camposSemJuros.faixaMoraTaxa, undefined);
    // o resto da sentença (valor da indenização) deve continuar extraído normalmente
    assert.ok(camposSemJuros.valorSentenca, 'valorSentenca deveria continuar sendo extraído mesmo sem juros na peça');
  });
}

/* ==========================================================================
   ORQUESTRAÇÃO
========================================================================== */
async function main(){
  console.log('=== Testes de extração por IA — Seção "IA" do checklist ===');

  await suiteValores();
  await suiteDatas();
  await suiteIndice();
  await suiteModalidade();
  await suiteJuros();

  console.log(`\n=== ${totalTestes} teste(s), ${totalTestes - totalFalhas} passaram, ${totalFalhas} falharam ===`);
  process.exit(totalFalhas > 0 ? 1 : 0);
}

main().catch(erro => {
  console.error('ERRO INESPERADO NA SUÍTE DE TESTES:', erro);
  process.exit(1);
});
