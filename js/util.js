/* ============================================================================
   UTIL.JS — Funções auxiliares genéricas
   Extraído do arquivo original "calculadora_desapropriacao-parte1-motor-por
   -tipo-1.html". Não há nenhuma alteração de lógica em relação ao código-
   fonte: as funções abaixo foram apenas movidas para este arquivo, mantidas
   como funções/consts globais (sem export/import de módulo ES6), para que
   continuem funcionando com o mesmo padrão de <script src="..."> usado hoje
   pelo restante do app.

   Este arquivo NÃO deve conter nenhuma regra jurídica ou de negócio (isso
   pertence a motor.js e aos módulos em /modulos). Aqui só entram helpers
   puramente técnicos: seleção de DOM, formatação, datas/competências,
   contagem de período, leitura de campos monetários e um hash simples
   usado no selo de verificação do PDF.
============================================================================ */

/* ------------------------------------------------------------------------
   1. SELEÇÃO DE DOM E FORMATAÇÃO
------------------------------------------------------------------------ */

const $ = id => document.getElementById(id);

const fmt = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const fmtPct = (v, casas) => (isFinite(v) ? v : 0).toLocaleString('pt-BR', {minimumFractionDigits:casas||2, maximumFractionDigits:casas||4}) + '%';
const fmtData = iso => {
  if(!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
};

// Lê um campo .money (formatado como "1.234.567,89") e devolve número puro
// (1234567.89). Usado por completar.js para ler oferta/sentença/benfeitorias/
// custas/honorários — antes chamado em vários lugares mas nunca definido.
function moneyValue(id){
  const bruto = ($(id) && $(id).value) || '';
  const numerico = bruto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(numerico);
  return isFinite(n) ? n : 0;
}

// Máscara de digitação estilo "caixa eletrônico": os 2 últimos dígitos
// digitados sempre são os centavos; o resto vira a parte inteira, com
// separador de milhar. Assim não tem como digitar um valor sem vírgula
// decimal por engano (ex.: "5000000" -> "50.000,00").
function formatarMoedaInput(input){
  let digitos = input.value.replace(/\D/g, '');
  if(!digitos){ input.value = ''; return; }
  digitos = digitos.replace(/^0+(?=\d)/, '');
  while(digitos.length < 3) digitos = '0' + digitos;
  const centavos = digitos.slice(-2);
  const inteiro = digitos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  input.value = inteiro + ',' + centavos;
}

// Máscara para OAB: mantém o que vier antes do primeiro dígito (ex.: "OAB/SP ")
// como prefixo, e agrupa os dígitos de 3 em 3 com ponto (ex.: "123.456").
function formatarOabInput(input){
  const valor = input.value;
  const pos = valor.search(/\d/);
  const prefixo = pos === -1 ? valor : valor.slice(0, pos);
  let digitos = (pos === -1 ? '' : valor.slice(pos)).replace(/\D/g, '');
  digitos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  input.value = prefixo + digitos;
}

/* ------------------------------------------------------------------------
   2. CONTROLE DE EXECUÇÃO / FEEDBACK NA TELA
------------------------------------------------------------------------ */

// Debounce simples: evita recalcular a cada tecla digitada, melhorando
// o desempenho em formulários com vários campos reativos.
function debounce(fn, wait){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Exibe uma notificação temporária (toast) — usado nas exportações e em
// outras rotinas (salvar processo, backup/restauração etc.).
function toast(msg, isErr){
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 4200);
}

/* ------------------------------------------------------------------------
   3. DATAS E COMPETÊNCIAS (mês/ano)
------------------------------------------------------------------------ */

// Retorna {ano, mes} (mes 1-12) a partir de uma data ISO (yyyy-mm-dd).
function parseAnoMes(iso){
  const d = new Date(iso + 'T00:00:00');
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

// Gera a lista de competências (mês/ano) entre duas datas, seguindo a
// convenção de que a correção incide a partir do mês seguinte ao termo
// inicial (prática usual em cálculos judiciais), salvo quando o usuário
// marcar a opção "incluir o mês inicial".
function listarCompetencias(dataIniIso, dataFimIso, incluirMesInicial){
  if(!dataIniIso || !dataFimIso) return [];
  let ini = parseAnoMes(dataIniIso);
  const fim = parseAnoMes(dataFimIso);
  if(!incluirMesInicial){
    ini.mes += 1;
    if(ini.mes > 12){ ini.mes = 1; ini.ano += 1; }
  }
  const lista = [];
  let ano = ini.ano, mes = ini.mes;
  // Proteção contra períodos absurdamente longos (evita loop custoso).
  let guard = 0;
  while((ano < fim.ano || (ano === fim.ano && mes <= fim.mes)) && guard < 1200){
    lista.push({ ano, mes });
    mes += 1;
    if(mes > 12){ mes = 1; ano += 1; }
    guard++;
  }
  return lista;
}

function competenciaLabel(c){
  const meses = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  return meses[c.mes - 1] + '/' + c.ano;
}

// Converte data ISO (yyyy-mm-dd) para o formato dd/mm/aaaa exigido pela API do Bacen.
function isoParaBcb(iso){
  const [a,m,d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function monthsBetween(d1, d2){
  if(!d1 || !d2) return null;
  const a = new Date(d1), b = new Date(d2);
  if(isNaN(a) || isNaN(b)) return null;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  months += (b.getDate() - a.getDate()) / 30;
  return Math.max(0, Math.round(months * 10) / 10);
}

/* ------------------------------------------------------------------------
   4. CONTAGEM DE PERÍODO (usado no cálculo de juros compensatórios e
      moratórios — a regra de negócio de QUANDO/COMO aplicar cada critério
      fica em motor.js; aqui só está a matemática pura de contagem)

   contarPeriodo(inicio, fim, criterio) suporta dois critérios,
   configuráveis pelo usuário (campo "Critério de contagem de tempo para
   os juros", Art. 4º):

     - 'pro_rata_die' (padrão): dias corridos ÷ 365. Não agrupa por mês —
        cada dia vale exatamente 1/365 de ano. É o critério mais preciso e
        o mais defensável em cálculo judicial, por não depender de nenhuma
        convenção contratual/bancária.
     - 'mes_comercial': convenção 30/360 (mercado financeiro/US NASD) — cada
        mês vale 30 dias e o ano vale 360, incluindo o resíduo de dias.
        Mantido como opção para os casos em que a sentença/título determine
        essa convenção.

   Retorna { fracaoAno, desc, dias } — fracaoAno é o período em ANOS (fração),
   para ser multiplicado pela taxa anual de juros em motor.js; desc é um
   resumo textual do período (usado na memória de cálculo); dias é a
   contagem de dias usada no critério escolhido. Se `inicio`/`fim` forem
   inválidos ou fim <= início, devolve 0 (falsy) — motor.js trata esse caso
   como "sem período a considerar" via `if(!periodo || ...)`.
------------------------------------------------------------------------ */
function contarPeriodo(inicio, fim, criterio){
  if(!inicio || !fim) return 0;
  const d1 = new Date(inicio + 'T00:00:00');
  const d2 = new Date(fim + 'T00:00:00');
  if(isNaN(d1) || isNaN(d2)) return 0;
  if(d2 <= d1) return 0;

  if(criterio === 'mes_comercial'){
    let anos1 = d1.getFullYear(), meses1 = d1.getMonth(), dias1 = d1.getDate();
    let anos2 = d2.getFullYear(), meses2 = d2.getMonth(), dias2 = d2.getDate();
    if(dias1 === 31) dias1 = 30;
    if(dias2 === 31 && dias1 === 30) dias2 = 30;
    const diasTotais = (anos2 - anos1) * 360 + (meses2 - meses1) * 30 + (dias2 - dias1);
    return { fracaoAno: diasTotais / 360, dias: diasTotais, desc: `${diasTotais} dias (mês comercial 30/360)` };
  }

  const msPorDia = 24 * 60 * 60 * 1000;
  const diasCorridos = Math.round((d2 - d1) / msPorDia);
  return { fracaoAno: diasCorridos / 365, dias: diasCorridos, desc: `${diasCorridos} dias corridos` };
}
