/* ============================================================================
   CLASSIFICADOREXTRATOR.JS — Classificação de peças (Fase 3) e extração de
   campos (Fase 4).

   ENTRADA: paginas = [{numero, texto, fonte}, ...] (uma por página, de um ou
   mais PDFs já concatenados por lerUmPdf()/painelConferencia.js — cada
   página guarda de qual arquivo/número ela veio, ver campo `origem`).

   SAÍDA:
     classificarPaginas(paginas) -> anota cada página com `.tipos` (lista de
       peças processuais que aquela página parece conter).
     extrairCampos(paginas) -> { campoId: {valor, confianca, pagina, trecho} }

   Nenhuma extração aqui é jurídica no sentido de "decidir o que é correto" —
   isso é papel de inteligenciaJuridica.js. Este arquivo só localiza padrões
   textuais (regex + proximidade a palavras-chave) e atribui uma confiança
   honesta: mesmo o padrão mais forte (nº CNJ) não passa de 0.95, porque
   texto de OCR pode ter erro de reconhecimento de caractere.
============================================================================ */

/* ------------------------------------------------------------------------
   1. CLASSIFICAÇÃO DE PEÇAS (Fase 3)
------------------------------------------------------------------------ */
const PALAVRAS_CLASSIFICACAO = {
  // Lista ampliada: as 4 frases originais eram todas variações do mesmo
  // estilo formal ("vem, respeitosamente..."), o que deixava de fora
  // aberturas igualmente comuns em petições de desapropriação, como
  // "propõe/promove/ajuíza a presente ação ... em face de". Sem cobrir
  // essas variações, a página nunca era classificada como petição
  // inicial e expropriante/expropriado ficavam vazios sem qualquer aviso
  // — mesmo com uma petição perfeitamente válida.
  peticaoInicial: [
    'petição inicial', 'vem, respeitosamente', 'requer a citação', 'dos fatos e fundamentos',
    'propõe a presente ação', 'promove a presente ação', 'ajuíza a presente ação',
    'vem propor a presente ação', 'ação de desapropriação direta em face de',
    'ação de desapropriação indireta em face de'
  ],
  contestacao: ['contestação', 'em sede de contestação', 'impugna os termos da inicial'],
  laudoPericial: ['laudo pericial', 'perito judicial', 'quesitos', 'metodologia avaliatória', 'nbr 14.653', 'nbr 14653'],
  sentenca: ['vistos, etc', 'vistos.', 'ante o exposto, julgo', 'dispositivo', 'sentença', 'homologo'],
  acordao: ['acórdão', 'relator(a)', 'turma julgadora', 'dou provimento', 'nego provimento', 'câmara de direito público'],
  depositoJudicial: ['depósito judicial', 'guia de depósito', 'comprovante de depósito', 'levantamento do depósito'],
  matriculaImovel: ['matrícula', 'cartório de registro de imóveis', 'ônus e alienações', 'certidão de inteiro teor']
};

const ROTULOS_CLASSIFICACAO = {
  peticaoInicial: 'Petição inicial',
  contestacao: 'Contestação',
  laudoPericial: 'Laudo pericial',
  sentenca: 'Sentença',
  acordao: 'Acórdão',
  depositoJudicial: 'Depósito judicial',
  matriculaImovel: 'Matrícula do imóvel'
};

function classificarPaginas(paginas){
  paginas.forEach(p => {
    const texto = (p.texto || '').toLowerCase();
    p.tipos = Object.keys(PALAVRAS_CLASSIFICACAO).filter(tipo =>
      PALAVRAS_CLASSIFICACAO[tipo].some(palavra => texto.includes(palavra))
    );
  });
  return paginas;
}

// Devolve as páginas cujo tipo classificado inclui algum dos tipos pedidos.
function paginasDoTipo(paginas, ...tipos){
  return paginas.filter(p => (p.tipos || []).some(t => tipos.includes(t)));
}

/* ------------------------------------------------------------------------
   2. HELPERS DE PARSING (moeda, data, percentual em pt-BR)
------------------------------------------------------------------------ */
function parseValorMoedaBR(str){
  if(!str) return null;
  const limpo = String(str).replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isFinite(n) ? n : null;
}

// Espelha parseValorMoedaBR, mas para percentuais (ex.: "6,5" ou "6.5" -> 6.5).
// Usado nos três trechos abaixo que extraem taxas/percentuais de juros e
// honorários — antes chamavam parseFloat() direto, sem tratar NaN (ver
// CORREÇÃO — prioridade crítica: validação de valores numéricos).
function parsePercentualBR(str){
  if(!str) return null;
  const n = parseFloat(String(str).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function formatarValorParaCampoMoeda(n){
  return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseDataBRParaIso(str){
  const m = String(str).match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if(!m) return null;
  const [, d, mes, a] = m;
  const dia = d.padStart(2, '0'), mesN = mes.padStart(2, '0');
  if(+mesN < 1 || +mesN > 12 || +dia < 1 || +dia > 31) return null;
  return `${a}-${mesN}-${dia}`;
}

// Procura o primeiro casamento de `regexValor` dentro de uma janela de
// `janela` caracteres a partir do fim de QUALQUER casamento de `regexAncora`
// no texto — não só o primeiro. Isso importa porque a mesma palavra-âncora
// (ex.: "honorários sucumbenciais") pode aparecer antes, num trecho
// narrativo sem valor por perto, e de novo mais adiante já associada ao
// valor real (ex.: na tabela da sentença). Parar na primeira ocorrência sem
// valor perdia o campo por completo mesmo com o dado presente na página.
function buscarProximo(texto, regexAncora, regexValor, janela){
  const global = new RegExp(regexAncora.source, regexAncora.flags.includes('g') ? regexAncora.flags : regexAncora.flags + 'g');
  let ma;
  while((ma = global.exec(texto)) !== null){
    const inicio = ma.index + ma[0].length;
    const trecho = texto.slice(inicio, inicio + janela);
    const mv = regexValor.exec(trecho);
    if(mv){
      return { valorBruto: mv[1] !== undefined ? mv[1] : mv[0], trecho: (ma[0] + trecho.slice(0, mv.index + mv[0].length)).slice(-160) };
    }
    if(ma.index === global.lastIndex) global.lastIndex++; // evita loop infinito em casamento de tamanho zero
  }
  return null;
}

function formatarDataIsoParaBR(iso){
  if(!iso) return '';
  const [a, m, d] = String(iso).split('-');
  return (a && m && d) ? `${d}/${m}/${a}` : String(iso);
}

// Igual a buscarProximo(), mas devolve TODAS as ocorrências (não só a
// primeira) — usado pela detecção de duplicidade/divergência de valores
// (inteligenciaJuridica.js), que precisa saber se o mesmo campo aparece com
// valores diferentes em páginas diferentes, não só o primeiro valor achado.
function buscarTodosProximos(texto, regexAncora, regexValor, janela){
  const resultados = [];
  const global = new RegExp(regexAncora.source, regexAncora.flags.includes('g') ? regexAncora.flags : regexAncora.flags + 'g');
  let ma;
  while((ma = global.exec(texto)) !== null){
    const inicio = ma.index + ma[0].length;
    const trecho = texto.slice(inicio, inicio + janela);
    const mv = regexValor.exec(trecho);
    if(mv){
      resultados.push({ valorBruto: mv[1] !== undefined ? mv[1] : mv[0], trecho: (ma[0] + trecho.slice(0, mv.index + mv[0].length)).slice(-160) });
    }
    if(ma.index === global.lastIndex) global.lastIndex++; // evita loop infinito em casamento de tamanho zero
  }
  return resultados;
}

// Detecta páginas com conteúdo praticamente idêntico entre os PDFs
// anexados nesta leva — sinal de que o mesmo arquivo foi anexado duas
// vezes por engano, ou que duas cópias do mesmo documento foram incluídas.
// Páginas muito curtas (capa, ficha de protocolo) são ignoradas para evitar
// falso positivo — o limiar de 200 caracteres normalizados é arbitrário,
// mas suficiente para não pegar página quase vazia.
function detectarPaginasDuplicadas(paginas){
  const normalizar = texto => (texto || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vistos = new Map(); // texto normalizado -> primeira página que teve esse texto
  const grupos = [];
  paginas.forEach(p => {
    const norm = normalizar(p.texto);
    if(norm.length < 200) return;
    if(vistos.has(norm)){
      const original = vistos.get(norm);
      let grupo = grupos.find(g => g.original === original);
      if(!grupo){ grupo = { original, duplicadas: [] }; grupos.push(grupo); }
      grupo.duplicadas.push(p);
    } else {
      vistos.set(norm, p);
    }
  });
  return grupos;
}

/* ------------------------------------------------------------------------
   3. REGEX DE CAMPOS ISOLADOS (não dependem de âncora textual)
------------------------------------------------------------------------ */
const REGEX_NUMERO_PROCESSO = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/;
const REGEX_VALOR_RS = /R\$\s?([\d.]{1,15},\d{2})/;
const REGEX_PERCENTUAL = /(\d{1,3}(?:,\d{1,4})?)\s?%/;
const REGEX_DATA = /(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/;
// CORREÇÃO: o \b original nunca casava depois de "m²", porque "²" não é
// caractere de palavra (\w) para o motor de regex do JS — então "m²," ou
// "m² " (a forma mais comum de escrever área em documentos jurídicos/
// imobiliários brasileiros, mais comum até que "m2") nunca batia com essa
// regex, e areaImovel ficava sempre sem valor. Trocado por um lookahead
// negativo que só bloqueia quando o próximo caractere é letra/dígito
// (evita grudar em "m²s" de algum plural estranho) sem depender de \b.
const REGEX_AREA = /(?:área(?: total)? de)\s*([\d.]+,\d{2}|\d+)\s?(m²|m2|hectares|ha)(?![a-zà-ÿ0-9])/i;

// Nome de índice de correção monetária — ordem importa: "ipca-e"/"ipcae"
// precisam ser testados ANTES de "ipca" solto, senão a alternância de regex
// já casaria com o prefixo "ipca" de "ipca-e" e nunca chegaria a "ipca-e".
const REGEX_NOME_INDICE = /(ipca-e|ipcae|inpc|ipca|selic)/i;
function normalizarNomeIndice(bruto){
  const t = String(bruto || '').toLowerCase();
  if(/ipca-e|ipcae/.test(t)) return 'ipcae';
  if(/inpc/.test(t)) return 'inpc';
  if(/ipca/.test(t)) return 'ipca';
  if(/selic/.test(t)) return 'selic';
  return null;
}

/* ------------------------------------------------------------------------
   4. EXTRAÇÃO DE CAMPOS (Fase 4)
   Cada extrator devolve {valor, confianca (0-1), pagina, trecho} ou null.
   `pagina` é o objeto {numero, arquivo} da página onde o campo foi achado,
   para a Fase 6 (conferência) permitir "ver página de origem".
------------------------------------------------------------------------ */
function extrairCampos(paginas){
  classificarPaginas(paginas);
  const campos = {};

  const definir = (id, resultado) => { if(resultado && resultado.valor !== null && resultado.valor !== undefined && resultado.valor !== '') campos[id] = resultado; };

  // --- Duplicidade de páginas (mesmo conteúdo repetido entre os PDFs anexados) ---
  const gruposDuplicados = detectarPaginasDuplicadas(paginas);
  if(gruposDuplicados.length){
    const detalhes = gruposDuplicados.map(g => {
      const nomesDup = g.duplicadas.map(p => `${p.arquivo || ''} pág. ${p.numero}`).join(', ');
      return `pág. ${g.original.numero} de "${g.original.arquivo || ''}" ≈ ${nomesDup}`;
    }).join('; ');
    campos._alertaPaginasDuplicadas = {
      mensagem: `${gruposDuplicados.reduce((n,g)=>n+g.duplicadas.length,0)} página(s) com conteúdo idêntico a outra já processada — possível arquivo anexado duas vezes (${detalhes}). Duplicidade não é removida automaticamente; confira antes de prosseguir.`
    };
  }

  // --- Número do processo (padrão CNJ) — regex bem específica, alta confiança ---
  for(const p of paginas){
    const m = REGEX_NUMERO_PROCESSO.exec(p.texto || '');
    if(m){ definir('numeroProcesso', { valor: m[1], confianca: 0.95, pagina: p, trecho: contexto(p.texto, m.index, 60) }); break; }
  }

  // --- Comarca / Vara ---
  for(const p of paginas){
    const m = /(?:comarca de|vara (?:única|cível|de fazenda pública|de fazenda))\s*(?:d[eo])?\s*([A-ZÀ-Ú][^\n,.;]{2,60})/i.exec(p.texto || '');
    if(m){ definir('comarca', { valor: (m[0]).trim().replace(/\s+/g, ' '), confianca: 0.6, pagina: p, trecho: contexto(p.texto, m.index, 80) }); break; }
  }

  // --- Autor / Réu (só em petição inicial, para reduzir falso positivo) ---
  const paginasPeticao = paginasDoTipo(paginas, 'peticaoInicial');
  for(const p of paginasPeticao){
    // Ampliado para também reconhecer o nome da parte seguido de
    // "propõe/promove/ajuíza a presente ação" — não só o estilo
    // "vem, respeitosamente" / "pessoa jurídica ... representad[a/o]".
    const mAutor = /(?:^|\.)\s*([A-ZÀ-Ú][A-ZÀ-Ú \-\.]{4,80}),?\s+(?:pessoa jurídica|neste ato representad|vem,? respeitosamente|prop[õo]e a presente a[çc][ãa]o|promove a presente a[çc][ãa]o|aj[uú]za a presente a[çc][ãa]o)/i.exec(p.texto || '');
    if(mAutor){ definir('expropriante', { valor: mAutor[1].trim(), confianca: 0.4, pagina: p, trecho: contexto(p.texto, mAutor.index, 80) }); }
    const mReu = /em face de\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 \-\.]{4,80})[,.]/.exec(p.texto || '');
    if(mReu){ definir('expropriado', { valor: mReu[1].trim(), confianca: 0.45, pagina: p, trecho: contexto(p.texto, mReu.index, 80) }); }
    if(campos.expropriante && campos.expropriado) break;
  }

  // Rede de segurança contra lacuna silenciosa: mesmo com a classificação e
  // os regex acima ampliados, sempre vai existir alguma redação de petição
  // que foge do padrão previsto. Em vez de deixar expropriante/expropriado
  // vazios sem qualquer sinal — o que só é percebido se o advogado conferir
  // campo por campo — avisa explicitamente que a extração automática não
  // achou as partes e que o preenchimento manual é necessário.
  if(!campos.expropriante || !campos.expropriado){
    const faltando = [];
    if(!campos.expropriante) faltando.push('expropriante (autor)');
    if(!campos.expropriado) faltando.push('expropriado (réu)');
    campos._alertaPartesNaoIdentificadas = {
      mensagem: `Não foi possível identificar automaticamente: ${faltando.join(' e ')}. A extração de partes depende do reconhecimento da petição inicial e de padrões de redação específicos — confira e preencha manualmente antes de calcular.`
    };
  }

  // --- Valor da oferta ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /oferta(?:\s+administrativa|\s+inicial)?/i, REGEX_VALOR_RS, 120);
    if(r){ definir('valorOferta', { valor: parseValorMoedaBR(r.valorBruto), confianca: 0.65, pagina: p, trecho: r.trecho }); break; }
  }

  // --- Valor pericial (informativo — some para a inteligência jurídica comparar) ---
  const paginasLaudo = paginasDoTipo(paginas, 'laudoPericial');
  const anchorsPericial = [
    /valor (?:da )?(?:indenização|avaliação)/i,
    /concluiu .{0,20}(?:indenização|avaliação) de/i
  ];
  for(const p of paginasLaudo){
    for(const ancora of anchorsPericial){
      const r = buscarProximo(p.texto || '', ancora, REGEX_VALOR_RS, 100);
      if(r){ definir('valorPericial', { valor: parseValorMoedaBR(r.valorBruto), confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
    }
    if(campos.valorPericial) break;
  }
  // Fallback amplo: "Indenização R$X" sem verbo nenhum na frente (comum em
  // tabelas-resumo). Janela curta (40) e confiança baixa porque, sem um
  // verbo/âncora mais específico, o risco de pegar o número errado é maior.
  if(!campos.valorPericial){
    for(const p of paginasLaudo){
      const r = buscarProximo(p.texto || '', /\bindeniza[çc][ãa]o\b\s*(?:de\s*)?/i, REGEX_VALOR_RS, 40);
      if(r){
        definir('valorPericial', {
          valor: parseValorMoedaBR(r.valorBruto), confianca: 0.4, pagina: p, trecho: r.trecho,
          observacao: 'Encontrado por padrão amplo dentro da seção de laudo pericial — confirme se é de fato a conclusão de valor do laudo.'
        });
        break;
      }
    }
  }

  // --- Valor da sentença / indenização fixada ---
  // Camada 1 (alta confiança): só nas páginas classificadas como
  // sentença/acórdão, com âncoras específicas de dispositivo judicial.
  const paginasSentenca = paginasDoTipo(paginas, 'sentenca');
  const anchorsIndenizacao = [
    /fixo a indenização em/i,
    /condeno .{0,40} ao pagamento de/i,
    /valor da indenização/i,
    /arbitro o valor da indenização em/i,
    /indeniza[çc][ãa]o .{0,20}(?:foi )?fixada em/i,
    /indeniza[çc][ãa]o .{0,20}arbitrada em/i
  ];
  for(const p of paginasSentenca){
    for(const ancora of anchorsIndenizacao){
      const r = buscarProximo(p.texto || '', ancora, REGEX_VALOR_RS, 100);
      if(r){ definir('valorSentenca', { valor: parseValorMoedaBR(r.valorBruto), confianca: 0.75, pagina: p, trecho: r.trecho }); break; }
    }
    if(campos.valorSentenca) break;
  }

  // Camada 2 (fallback, confiança mais baixa): muitos documentos — sobretudo
  // resumos e tabelas pré-sentença — registram o valor da indenização sem
  // usar a palavra "sentença" em lugar nenhum, então a página nunca é
  // classificada como `sentenca` e a Camada 1 acima nunca roda. Aqui
  // varremos TODAS as páginas com âncoras mais genéricas. Confiança bem mais
  // baixa e observação explícita, porque sem o contexto de página de
  // sentença o risco de pegar um valor mencionado de passagem (não o final)
  // é maior.
  if(!campos.valorSentenca){
    const anchorsIndenizacaoAmplo = [
      /concluiu .{0,20}indeniza[çc][ãa]o de/i,
      /\bindeniza[çc][ãa]o\b\s*(?:de\s*)?/i
    ];
    for(const p of paginas){
      for(const ancora of anchorsIndenizacaoAmplo){
        const r = buscarProximo(p.texto || '', ancora, REGEX_VALOR_RS, 40);
        if(r){
          definir('valorSentenca', {
            valor: parseValorMoedaBR(r.valorBruto), confianca: 0.4, pagina: p, trecho: r.trecho,
            observacao: 'Encontrado por padrão amplo — a página não foi classificada como sentença/acórdão. Confira manualmente se este é de fato o valor final da indenização.'
          });
          break;
        }
      }
      if(campos.valorSentenca) break;
    }
  }

  // --- Data da oferta / sentença / imissão na posse ---
  definir('dataOferta', extrairDataProxima(paginas, /oferta/i, 0.55));
  definir('dataImissao', extrairDataProxima(paginas, /imissão (?:provisória |definitiva )?na posse/i, 0.6));
  definir('dataSentenca', extrairDataProxima(paginasSentenca.length ? paginasSentenca : paginas, /(?:sentença proferida em|publicada em)/i, 0.5));

  // --- Área do imóvel (informativo — sem campo correspondente no formulário atual) ---
  for(const p of paginas){
    const m = REGEX_AREA.exec(p.texto || '');
    if(m){ definir('areaImovel', { valor: `${m[1]} ${m[2]}`, confianca: 0.55, pagina: p, trecho: contexto(p.texto, m.index, 60), semCampoNoFormulario: true }); break; }
  }

  // --- Índice de correção monetária ---
  // CORREÇÃO (Fase 2 do checklist — reconhecimento automático de índice):
  // a versão anterior pegava a PRIMEIRA menção a IPCA/IPCA-E/INPC/Selic em
  // QUALQUER página, na ordem em que elas aparecem no documento — inclusive
  // menções de passagem (ex.: petição inicial pedindo "juros e correção
  // pelos índices oficiais, atualmente Selic") que não são o índice de
  // fato FIXADO no processo. Agora, igual ao padrão já usado para
  // valorSentenca, a extração roda em duas camadas.
  //
  // Camada 1 (alta confiança): só nas páginas de sentença/acórdão — que é
  // onde o índice de correção realmente aplicável ao processo costuma ser
  // fixado — e só quando o nome do índice aparece perto de uma âncora que
  // efetivamente fala de correção monetária (não basta a palavra aparecer
  // solta na página).
  const paginasSentencaOuAcordao = paginasDoTipo(paginas, 'sentenca', 'acordao');
  const ancorasIndiceForte = [
    /corre[çc][ãa]o\s+monet[áa]ria(?:\s+(?:pel[oa]|com base n[oa]|conforme|de acordo com|utilizando))?/i,
    /atualiza[çc][ãa]o\s+monet[áa]ria(?:\s+(?:pel[oa]|com base n[oa]))?/i,
    /corrigid[oa]s?\s+(?:monetariamente\s+)?pel[oa]/i,
    /atualizad[oa]s?\s+(?:monetariamente\s+)?pel[oa]/i,
    /[íi]ndice\s+(?:oficial\s+)?de\s+corre[çc][ãa]o(?:\s+monet[áa]ria)?/i
  ];
  for(const p of paginasSentencaOuAcordao){
    for(const ancora of ancorasIndiceForte){
      const r = buscarProximo(p.texto || '', ancora, REGEX_NOME_INDICE, 40);
      if(r){
        const indiceAchado = normalizarNomeIndice(r.valorBruto);
        if(indiceAchado){ definir('indice', { valor: indiceAchado, confianca: 0.75, pagina: p, trecho: r.trecho }); break; }
      }
    }
    if(campos.indice) break;
  }

  // Camada 2 (fallback, confiança mais baixa): primeira menção ao nome do
  // índice em qualquer página, sem âncora de correção monetária por perto —
  // mesmo comportamento (mais fraco) que a versão anterior tinha para todos
  // os casos. Só roda se a Camada 1 não achou nada.
  if(!campos.indice){
    for(const p of paginas){
      const m = REGEX_NOME_INDICE.exec(p.texto || '');
      if(m){
        const indiceAchado = normalizarNomeIndice(m[1]);
        if(indiceAchado){
          definir('indice', {
            valor: indiceAchado, confianca: 0.4, pagina: p, trecho: contexto(p.texto, m.index, 60),
            observacao: 'Encontrado por menção solta ao nome do índice, fora de página de sentença/acórdão e sem âncora de "correção monetária" por perto — confirme se é de fato o índice fixado no processo.'
          });
          break;
        }
      }
    }
  }

  // --- Juros compensatórios (% a.a.) ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /juros compensat[óo]rios/i, REGEX_PERCENTUAL, 60);
    if(r){
      const valor = parsePercentualBR(r.valorBruto);
      // CORREÇÃO (prioridade crítica): parseFloat() sem validação de NaN
      // podia gravar um valor inválido no campo (ex.: trecho de regex com
      // formato inesperado) e propagá-lo silenciosamente até a conferência
      // e o cálculo. Se não der para converter, a extração é descartada
      // (equivalente a "não encontrado") em vez de guardar um NaN.
      if(valor !== null){ definir('faixaCompTaxa', { valor, confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
    }
  }

  // --- Juros moratórios (% a.a.) ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /juros morat[óo]rios/i, REGEX_PERCENTUAL, 60);
    if(r){
      const valor = parsePercentualBR(r.valorBruto);
      if(valor !== null){ definir('faixaMoraTaxa', { valor, confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
    }
  }

  // --- Honorários sucumbenciais (%) ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /honorários (?:advocatícios|sucumbenciais)/i, REGEX_PERCENTUAL, 60);
    if(r){
      const valor = parsePercentualBR(r.valorBruto);
      if(valor !== null){ definir('percentualHonor', { valor, confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
    }
  }

  // --- Depósito judicial (existência + valor + data) ---
  const paginasDeposito = paginasDoTipo(paginas, 'depositoJudicial');
  if(paginasDeposito.length){
    const p = paginasDeposito[0];
    definir('existeDeposito', { valor: true, confianca: 0.7, pagina: p, trecho: contexto(p.texto, 0, 100) });
    const rValor = buscarProximo(p.texto || '', /dep[óo]sito(?: judicial)?/i, REGEX_VALOR_RS, 100);
    if(rValor) definir('depositoValor', { valor: parseValorMoedaBR(rValor.valorBruto), confianca: 0.55, pagina: p, trecho: rValor.trecho });
    const rData = buscarProximo(p.texto || '', /dep[óo]sito(?: judicial)?/i, REGEX_DATA, 80);
    if(rData){
      const isoDeposito = parseDataBRParaIso(rData.valorBruto);
      if(isoDeposito) definir('depositoData', { valor: isoDeposito, confianca: 0.45, pagina: p, trecho: rData.trecho });
    }
  }

  // --- Todos os candidatos (Fase 1, seção "Extração") ---
  // Diferente dos campos acima (melhor palpite por âncora), isto é a lista
  // completa de todo valor/data/percentual/nº de processo achado no
  // documento, tenha ou não batido com alguma âncora — ver
  // extratorCandidatos.js. Guardado à parte (não é um "campo" do
  // formulário) para a conferência manual poder mostrar "outros valores
  // encontrados no documento" além do que foi preenchido automaticamente.
  if(typeof extrairTodosCandidatos === 'function') campos._candidatos = extrairTodosCandidatos(paginas);

  return campos;
}

// Devolve {valor (ISO yyyy-mm-dd), confianca, pagina, trecho} da primeira
// data encontrada perto de `regexAncora`, varrendo `paginas` em ordem, ou
// null se nenhuma página tiver casamento (quem chama decide o que fazer —
// ver `definir()` em extrairCampos, que ignora resultado null).
function extrairDataProxima(paginas, regexAncora, confiancaBase){
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', regexAncora, REGEX_DATA, 80);
    if(r){
      const iso = parseDataBRParaIso(r.valorBruto);
      if(iso) return { valor: iso, confianca: confiancaBase, pagina: p, trecho: r.trecho };
    }
  }
  return null;
}

function contexto(texto, indice, raio){
  if(!texto) return '';
  const ini = Math.max(0, indice - raio);
  const fim = Math.min(texto.length, indice + raio);
  return (ini > 0 ? '…' : '') + texto.slice(ini, fim).trim() + (fim < texto.length ? '…' : '');
}
