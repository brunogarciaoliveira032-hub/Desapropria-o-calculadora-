/* ============================================================================
   IAFALLBACK.JS — Fallback por IA (LLM) para campos não localizados por
   regex/heurística ou encontrados com baixa confiança.

   POR QUE ISSO EXISTE: classificadorExtrator.js usa regex + proximidade de
   palavras-chave. Isso cobre bem redações previstas, mas cada vara/juiz/
   advogado escreve de um jeito diferente ("fixo a indenização em", "condeno
   ao pagamento de", "julgo procedente para fixar em"...) — não dá pra prever
   toda variação com regex. Este módulo manda o TRECHO relevante do PDF (não
   o processo inteiro) para a API da Anthropic e pede que o modelo tente
   achar os campos que ainda faltam, SÓ quando o usuário clica no botão —
   nunca automaticamente, porque isso envia texto do processo para fora do
   navegador.

   IMPORTANTE — ISTO NÃO É UMA DECISÃO AUTOMÁTICA DEFINITIVA:
   assim como o resto do pipeline (ver painelConferencia.js), o resultado da
   IA entra na tabela de conferência como sugestão, com confiança média-baixa
   fixa (0.55) e uma observação explícita — o advogado sempre confere antes
   de clicar em "Preencher formulário". Este módulo NUNCA sobrescreve um
   campo que já foi encontrado com confiança maior por regex.

   PRIVACIDADE: a chave de API fica só no localStorage deste navegador (não
   é enviada a lugar nenhum além da própria Anthropic, e só quando o usuário
   clica no botão de fallback). O texto enviado é limitado às páginas mais
   relevantes (classificadas como sentença/acórdão/laudo/depósito/petição) e
   truncado por tamanho (ver LIMITE_CHARS_TOTAL_IA) — não o processo inteiro.

   DEPENDE de: js/util.js ($, toast), classificadorExtrator.js (parseValorMoedaBR,
   parseDataBRParaIso). Consumido por painelConferencia.js, que chama
   renderizarAreaFallbackIA(campos, paginas) depois de montar a conferência.
============================================================================ */

const MODELO_IA_FALLBACK = 'claude-sonnet-4-6';
const LIMIAR_CONFIANCA_IA = 0.5; // campos ausentes OU com confiança abaixo disso entram no fallback
const LIMITE_CHARS_POR_PAGINA_IA = 1500;
const LIMITE_CHARS_TOTAL_IA = 9000; // teto do que é enviado por chamada, para custo/latência previsíveis
const CHAVE_LOCALSTORAGE_API_IA = 'da_chave_api_anthropic';

// Campos que vale a pena perguntar à IA, com a descrição que vai no prompt.
// Ficam de fora campos booleanos/estruturais (existeDeposito, índice) e os
// que dependem de configuração manual do escritório (juros, correção) —
// isso não é dado extraível do texto, é decisão jurídica do advogado.
const CAMPOS_ELEGIVEIS_IA = {
  numeroProcesso: 'Número do processo no padrão CNJ (formato NNNNNNN-DD.AAAA.J.TR.OOOO)',
  comarca: 'Comarca e vara onde tramita o processo',
  valorOferta: 'Valor da oferta administrativa/inicial feita pelo expropriante, em reais',
  valorSentenca: 'Valor final da indenização fixado em sentença, acórdão ou título executivo, em reais',
  valorPericial: 'Valor total concluído pelo laudo pericial, em reais',
  percentualHonor: 'Percentual de honorários advocatícios sucumbenciais fixado (só o número, sem o símbolo %)',
  dataOferta: 'Data em que a oferta foi feita, no formato dd/mm/aaaa',
  dataSentenca: 'Data em que a sentença foi proferida ou publicada, no formato dd/mm/aaaa',
  dataImissao: 'Data da imissão na posse (provisória ou definitiva), no formato dd/mm/aaaa'
};

const SYSTEM_PROMPT_IA = `Você lê trechos de peças processuais de ações de desapropriação (Brasil) e extrai dados factuais.
Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto antes ou depois, no formato:
{"idDoCampo": {"encontrado": true, "valor": "...", "trecho": "..."}, ...}
Regras:
- Um objeto por campo pedido, usando exatamente o id de campo informado como chave.
- Se o dado não aparecer no texto ou você não tiver certeza, responda {"encontrado": false} para aquele campo — NUNCA invente ou estime um valor.
- "trecho" deve ser uma cópia literal e curta (até 15 palavras) do texto de onde tirou o valor, para conferência humana.
- Valores monetários: só o número em formato brasileiro (ex: "3.725.000,00"), sem "R$".
- Percentuais: só o número (ex: "10").
- Datas: formato dd/mm/aaaa.`;

/* ------------------------------------------------------------------------
   1. CHAVE DE API (armazenada só no localStorage deste navegador)
------------------------------------------------------------------------ */
function obterChaveApiIA(){
  try{ return localStorage.getItem(CHAVE_LOCALSTORAGE_API_IA) || ''; }catch(e){ return ''; }
}

function salvarChaveApiIA(chave){
  try{
    const limpa = (chave || '').trim();
    if(limpa) localStorage.setItem(CHAVE_LOCALSTORAGE_API_IA, limpa);
    else localStorage.removeItem(CHAVE_LOCALSTORAGE_API_IA);
    return true;
  }catch(e){
    toast('Não foi possível salvar a chave neste navegador (armazenamento local indisponível).', true);
    return false;
  }
}

/* ------------------------------------------------------------------------
   2. CHAMADA À API DA ANTHROPIC
------------------------------------------------------------------------ */
async function chamarAnthropicIA(promptUsuario, apiKey){
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true' // chamada feita direto do navegador do usuário, com a própria chave dele
    },
    body: JSON.stringify({
      model: MODELO_IA_FALLBACK,
      max_tokens: 1200,
      system: SYSTEM_PROMPT_IA,
      messages: [{ role: 'user', content: promptUsuario }]
    })
  });

  if(!resposta.ok){
    const corpo = await resposta.text().catch(() => '');
    let motivo = `HTTP ${resposta.status}`;
    if(resposta.status === 401) motivo = 'chave de API inválida ou não autorizada';
    else if(resposta.status === 429) motivo = 'limite de uso da API atingido — tente novamente em instantes';
    throw new Error(`${motivo}${corpo ? ' — ' + corpo.slice(0, 200) : ''}`);
  }

  const dados = await resposta.json();
  return (dados.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

/* ------------------------------------------------------------------------
   3. MONTAGEM DO TRECHO ENVIADO (prioriza páginas relevantes, com teto)
------------------------------------------------------------------------ */
function montarExcertoParaIA(paginas){
  const tiposPrioritarios = ['sentenca', 'acordao', 'laudoPericial', 'depositoJudicial', 'peticaoInicial'];
  let relevantes = paginas.filter(p => (p.tipos || []).some(t => tiposPrioritarios.includes(t)));
  if(!relevantes.length) relevantes = paginas.slice(0, 5); // nada classificado — usa as primeiras páginas como aproximação

  let total = 0;
  const partes = [];
  for(const p of relevantes){
    const texto = (p.texto || '').slice(0, LIMITE_CHARS_POR_PAGINA_IA);
    if(!texto) continue;
    if(total + texto.length > LIMITE_CHARS_TOTAL_IA) break;
    partes.push(`[Página ${p.numero}${p.arquivo ? ' — ' + p.arquivo : ''}]\n${texto}`);
    total += texto.length;
  }
  return partes.join('\n\n');
}

/* ------------------------------------------------------------------------
   4. CONVERSÃO DO VALOR DEVOLVIDO PELA IA PARA O TIPO DO CAMPO
------------------------------------------------------------------------ */
function converterValorIAParaCampo(id, valorBruto){
  const camposMoeda = ['valorOferta', 'valorSentenca', 'valorPericial'];
  const camposData = ['dataOferta', 'dataSentenca', 'dataImissao'];
  if(camposMoeda.includes(id)) return parseValorMoedaBR(valorBruto);
  if(camposData.includes(id)) return parseDataBRParaIso(valorBruto);
  if(id === 'percentualHonor'){
    const n = parseFloat(String(valorBruto).replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  const texto = String(valorBruto || '').trim();
  return texto || null;
}

/* ------------------------------------------------------------------------
   5. QUAIS CAMPOS ESTÃO PENDENTES (ausentes ou com confiança baixa)
------------------------------------------------------------------------ */
function calcularPendentesIA(campos){
  return Object.keys(CAMPOS_ELEGIVEIS_IA).filter(id => {
    const atual = campos[id];
    return !atual || (typeof atual.confianca === 'number' && atual.confianca < LIMIAR_CONFIANCA_IA);
  });
}

/* ------------------------------------------------------------------------
   6. ORQUESTRAÇÃO: pergunta à IA e mescla no objeto `campos`
   NUNCA sobrescreve um campo já preenchido com confiança >= LIMIAR — só
   completa o que falta ou está fraco. Retorna um resumo do que aconteceu
   para a UI decidir a mensagem a mostrar.
------------------------------------------------------------------------ */
async function aplicarFallbackIA(campos, paginas){
  const apiKey = obterChaveApiIA();
  if(!apiKey) return { usado: false, motivo: 'sem_chave' };

  const pendentes = calcularPendentesIA(campos);
  if(!pendentes.length) return { usado: false, motivo: 'nada_pendente' };

  const excerto = montarExcertoParaIA(paginas);
  if(!excerto) return { usado: false, motivo: 'sem_texto' };

  const listaCampos = pendentes.map(id => `- ${id}: ${CAMPOS_ELEGIVEIS_IA[id]}`).join('\n');
  const promptUsuario = `Campos a extrair (responda só para estes ids):\n${listaCampos}\n\nTrecho das peças processuais:\n"""\n${excerto}\n"""`;

  let textoResposta;
  try{
    textoResposta = await chamarAnthropicIA(promptUsuario, apiKey);
  }catch(erro){
    console.error(erro);
    toast('Falha ao consultar a IA: ' + erro.message, true);
    return { usado: false, motivo: 'erro_api', erro: String(erro.message || erro) };
  }

  let json;
  try{
    const limpo = textoResposta.replace(/```json|```/g, '').trim();
    json = JSON.parse(limpo);
  }catch(erro){
    console.error('Resposta da IA não é JSON válido:', textoResposta);
    toast('A IA respondeu em formato inesperado — nenhum campo foi preenchido a partir dela.', true);
    return { usado: false, motivo: 'json_invalido' };
  }

  let preenchidos = 0;
  pendentes.forEach(id => {
    const r = json[id];
    if(!r || !r.encontrado || r.valor === undefined || r.valor === null || r.valor === '') return;
    const valorConvertido = converterValorIAParaCampo(id, r.valor);
    if(valorConvertido === null || valorConvertido === undefined) return;
    campos[id] = {
      valor: valorConvertido,
      confianca: 0.55,
      fonte: 'ia',
      trecho: r.trecho ? String(r.trecho) : '(sem trecho devolvido pela IA)',
      observacao: `Sugerido pela IA (${MODELO_IA_FALLBACK}) — a extração por padrões não encontrou este campo com confiança suficiente. Confira com atenção antes de preencher o formulário.`
    };
    preenchidos++;
  });

  return { usado: true, preenchidos, tentados: pendentes.length };
}

/* ------------------------------------------------------------------------
   7. UI: bloco de configuração da chave + botão de fallback na conferência
------------------------------------------------------------------------ */
function atualizarStatusChaveIA(configurada){
  const status = $('statusChaveIA');
  if(!status) return;
  status.textContent = configurada
    ? '✓ Chave configurada neste navegador.'
    : 'Nenhuma chave configurada — o fallback por IA fica desativado até você configurar uma.';
}

function renderizarAreaFallbackIA(campos, paginas){
  const container = $('areaFallbackIA');
  if(!container) return;

  const pendentes = calcularPendentesIA(campos);
  if(!pendentes.length){
    container.innerHTML = '';
    return;
  }

  const chave = obterChaveApiIA();
  const rotulos = pendentes.map(id => CAMPOS_ELEGIVEIS_IA[id].split(',')[0]).join(', ');

  if(!chave){
    container.innerHTML = `<p class="aviso-ia">${pendentes.length} campo(s) não localizado(s) ou com baixa confiança (${escaparHtml(rotulos)}). Configure uma chave de API da Anthropic no bloco acima para tentar completá-los com IA.</p>`;
    return;
  }

  container.innerHTML = `
    <p class="aviso-ia">${pendentes.length} campo(s) não localizado(s) ou com baixa confiança (${escaparHtml(rotulos)}).</p>
    <button type="button" id="btnFallbackIA">Tentar completar com IA</button>
  `;

  $('btnFallbackIA').addEventListener('click', async () => {
    const botao = $('btnFallbackIA');
    botao.disabled = true;
    const textoOriginal = botao.textContent;
    botao.textContent = 'Consultando IA…';

    const resultado = await aplicarFallbackIA(campos, paginas);

    botao.disabled = false;
    botao.textContent = textoOriginal;

    if(resultado.usado){
      toast(`IA sugeriu valor para ${resultado.preenchidos} de ${resultado.tentados} campo(s) pendente(s). Confira antes de preencher o formulário.`);
      if(typeof reexibirAposFallbackIA === 'function') reexibirAposFallbackIA(campos);
      renderizarAreaFallbackIA(campos, paginas);
    } else if(resultado.motivo === 'sem_chave' || resultado.motivo === 'nada_pendente'){
      renderizarAreaFallbackIA(campos, paginas);
    }
    // erro_api e json_invalido já mostraram toast dentro de aplicarFallbackIA
  });
}

/* ------------------------------------------------------------------------
   8. LIGAÇÃO COM A UI (campo de chave de API)
------------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', function(){
  const input = $('chaveApiIA');
  const btnSalvar = $('btnSalvarChaveIA');
  const btnLimpar = $('btnLimparChaveIA');
  if(!input || !btnSalvar || !btnLimpar) return; // bloco de UI ainda não existe nesta versão do index.html

  const chaveAtual = obterChaveApiIA();
  if(chaveAtual) input.value = chaveAtual;
  atualizarStatusChaveIA(!!chaveAtual);

  btnSalvar.addEventListener('click', () => {
    const ok = salvarChaveApiIA(input.value);
    if(ok){
      atualizarStatusChaveIA(!!input.value.trim());
      toast(input.value.trim() ? 'Chave salva neste navegador.' : 'Chave removida.');
    }
  });

  btnLimpar.addEventListener('click', () => {
    input.value = '';
    salvarChaveApiIA('');
    atualizarStatusChaveIA(false);
    toast('Chave removida.');
  });
});
