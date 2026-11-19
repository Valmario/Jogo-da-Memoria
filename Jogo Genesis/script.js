'use strict';

/*
 * Jogo da Memória (estilo Genius): interface e fluxo da partida.
 * As regras puras (sorteio, velocidade, estatísticas...) ficam em logica.js.
 */

const L = window.JogoLogica;

/* =========================================================
   Armazenamento local (com proteção contra navegador bloqueado)
   ========================================================= */

const PREFIXO = 'jogo-da-memoria:';

const armazenar = {
    ler(chave, padrao) {
        try {
            const bruto = localStorage.getItem(PREFIXO + chave);
            return bruto === null ? padrao : JSON.parse(bruto);
        } catch {
            return padrao;
        }
    },
    gravar(chave, valor) {
        try {
            localStorage.setItem(PREFIXO + chave, JSON.stringify(valor));
        } catch {
            /* sem armazenamento disponível: o jogo segue, só não guarda os dados */
        }
    },
    apagar(chave) {
        try {
            localStorage.removeItem(PREFIXO + chave);
        } catch {
            /* idem */
        }
    },
};

/* =========================================================
   Elementos da página
   ========================================================= */

const $ = (id) => document.getElementById(id);

const tabuleiro = $('tabuleiro');
const centro = $('centro');
const elPontos = $('pontos');
const elRotulo = $('rotulo-pontos');
const elRecorde = $('recorde');
const linhaRecorde = $('linha-recorde');
const elStatus = $('status');
const elInfoModo = $('info-modo');
const btnIniciar = $('btn-iniciar');
const btnSom = $('btn-som');
const barraTempo = $('barra-tempo');
const elConfete = $('confete');

const dlgConfig = $('dlg-config');
const dlgStats = $('dlg-stats');
const selModo = $('sel-modo');
const selDificuldade = $('sel-dificuldade');
const selCores = $('sel-cores');
const selTema = $('sel-tema');
const selTimbre = $('sel-timbre');
const rngVolume = $('rng-volume');
const chkVibracao = $('chk-vibracao');
const chkTempo = $('chk-tempo');

/* =========================================================
   Estado
   ========================================================= */

let config = L.normalizarConfig(armazenar.ler('config', {}));
let stats = L.normalizarStats(armazenar.ler('stats', null));
let ranking = L.normalizarRanking(armazenar.ler('ranking', []));

const estado = {
    sequencia: [],           // nomes das cores sorteadas, na ordem
    layout: [],              // cores do tabuleiro atual (ordem horária)
    posicao: 0,              // quantas cores o jogador já acertou nesta rodada
    aceitandoEntrada: false, // só aceita toques na vez do jogador
    jogando: false,
    pontos: 0,
    pontosJ: [0, 0],         // placar do modo dois jogadores
    jogadorAtual: 1,
    partida: 0,              // identifica a partida (cancela timers de partidas antigas)
    inicioVez: 0,            // para medir o tempo de reação
    timerJogada: null,
};

let pads = [];

/* =========================================================
   Utilidades
   ========================================================= */

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function vibrar(padrao) {
    if (config.vibracao && typeof navigator.vibrate === 'function') navigator.vibrate(padrao);
}

function criar(tag, atributos = {}, ...filhos) {
    const el = document.createElement(tag);
    for (const [chave, valor] of Object.entries(atributos)) {
        if (chave === 'texto') el.textContent = valor;
        else el.setAttribute(chave, valor);
    }
    el.append(...filhos);
    return el;
}

const recordeAtual = () => stats.recordes[L.chaveRecorde(config.modo, config.dificuldade)] || 0;
const letraDaCor = (nome) => Object.keys(L.TECLAS_LETRA).find((k) => L.TECLAS_LETRA[k] === nome);

/* =========================================================
   Som (Web Audio)
   ========================================================= */

let contextoAudio = null;
let ganhoMestre = null;

function aplicarVolume() {
    if (ganhoMestre) ganhoMestre.gain.value = (config.volume / 100) * 0.35;
}

function garantirAudio() {
    try {
        if (!contextoAudio) {
            const Contexto = window.AudioContext || window.webkitAudioContext;
            if (!Contexto) return null;
            contextoAudio = new Contexto();
            ganhoMestre = contextoAudio.createGain();
            ganhoMestre.connect(contextoAudio.destination);
            aplicarVolume();
        }
        if (contextoAudio.state === 'suspended') contextoAudio.resume();
        return contextoAudio;
    } catch {
        return null;
    }
}

// Toca uma nota somando os harmônicos do timbre escolhido.
function tocarNota(frequencia, duracaoMs, { timbre = config.timbre, atrasoMs = 0 } = {}) {
    if (!config.som) return;
    const ctx = garantirAudio();
    if (!ctx) return;

    try {
        const t = L.TIMBRES[timbre] || L.TIMBRES.suave;
        const inicio = ctx.currentTime + atrasoMs / 1000;
        const fim = inicio + duracaoMs / 1000;

        for (const parcial of t.parciais) {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            const pico = parcial.ganho * 0.5;

            osc.type = parcial.tipo;
            osc.frequency.value = frequencia * parcial.razao;

            env.gain.setValueAtTime(0.0001, inicio);
            env.gain.exponentialRampToValueAtTime(pico, inicio + t.ataque);
            if (t.decai) {
                env.gain.exponentialRampToValueAtTime(0.0001, fim);
            } else {
                env.gain.setValueAtTime(pico, Math.max(inicio + t.ataque, fim - t.liberacao));
                env.gain.exponentialRampToValueAtTime(0.0001, fim);
            }

            osc.connect(env).connect(ganhoMestre);
            osc.start(inicio);
            osc.stop(fim + 0.05);
        }
    } catch {
        /* sem áudio: o jogo segue em silêncio */
    }
}

const tocarAcorde = (frequencias, duracaoMs) => frequencias.forEach((f) => tocarNota(f, duracaoMs));

function somAcerto() {
    tocarNota(523, 120);
    tocarNota(659, 180, { atrasoMs: 110 });
}

function somMarco() {
    tocarAcorde([523, 659, 784], 800);
}

function somErro() {
    tocarNota(110, 600, { timbre: 'retro' });
    tocarNota(117, 600, { timbre: 'retro' });
}

const somTique = () => tocarNota(1200, 40, { timbre: 'retro' });

/* =========================================================
   Tabuleiro
   ========================================================= */

// Cria os botões coloridos para `n` cores (4, 6 ou 8), em fatias do círculo.
function montarTabuleiro(n) {
    pads.forEach((pad) => pad.remove());
    estado.layout = L.LAYOUTS[n].slice();

    pads = estado.layout.map((nome, indice) => {
        const cor = L.CORES[nome];
        const letra = letraDaCor(nome);
        const teclas = letra ? `${indice + 1} ou ${letra.toUpperCase()}` : `${indice + 1}`;
        const pos = L.centroSetor(indice, n);

        const pad = criar('button', {
            class: 'pad',
            type: 'button',
            'data-cor': nome,
            'aria-label': `${cor.rotulo} (tecla ${teclas})`,
        });
        pad.style.setProperty('--cor', `var(--c-${nome})`);
        pad.style.setProperty('--cor-acesa', `var(--c-${nome}-aceso)`);
        pad.style.clipPath = `polygon(${L.pontosPoligono(indice, n)})`;

        const simbolo = criar('span', { class: 'simbolo', 'aria-hidden': 'true', texto: cor.simbolo });
        simbolo.style.left = `${pos.x}%`;
        simbolo.style.top = `${pos.y}%`;
        pad.append(simbolo);

        pad.addEventListener('click', () => jogada(indice));
        tabuleiro.insertBefore(pad, centro);
        return pad;
    });
}

// Acende uma cor (com som) durante `duracao` ms.
async function acender(indice, duracao) {
    const pad = pads[indice];
    if (!pad) return;
    pad.classList.add('aceso');
    tocarNota(L.CORES[estado.layout[indice]].frequencia, duracao);
    await esperar(duracao);
    pad.classList.remove('aceso');
}

function atualizarBloqueio() {
    tabuleiro.classList.toggle('bloqueado', !estado.aceitandoEntrada);
}

/* =========================================================
   Textos e placar
   ========================================================= */

function definirStatus(texto) {
    elStatus.textContent = texto;
}

function dicaTeclas() {
    return `Teclas: 1 a ${estado.layout.length} (sentido horário, a partir do topo) ou Q, W, A e S.`;
}

function atualizarInfo() {
    const modo = L.MODOS[config.modo];
    const dif = L.DIFICULDADES[config.dificuldade];
    const cores = config.cores === 'crescente' ? 'cores crescentes' : `${config.cores} cores`;
    elInfoModo.textContent = `${modo.rotulo} · ${dif.rotulo} · ${cores} — ${modo.descricao}`;
}

function atualizarPlacar() {
    if (config.modo === 'dois') {
        elRotulo.textContent = 'J1 × J2';
        elPontos.textContent = `${estado.pontosJ[0]} × ${estado.pontosJ[1]}`;
        elPontos.classList.add('duplo');
        linhaRecorde.hidden = true;
    } else {
        elRotulo.textContent = 'Pontos';
        elPontos.textContent = estado.pontos;
        elPontos.classList.remove('duplo');
        linhaRecorde.hidden = false;
        elRecorde.textContent = recordeAtual();
    }
}

function pulsarPlacar() {
    elPontos.classList.remove('pulsar');
    void elPontos.offsetWidth; // reinicia a animação
    elPontos.classList.add('pulsar');
}

/* =========================================================
   Limite de tempo por jogada
   ========================================================= */

function pararTimerJogada() {
    clearTimeout(estado.timerJogada);
    estado.timerJogada = null;
    barraTempo.hidden = true;
}

function iniciarTimerJogada() {
    pararTimerJogada();
    const ms = L.DIFICULDADES[config.dificuldade].tempoLimite;
    const partida = estado.partida;

    const barra = barraTempo.firstElementChild;
    barraTempo.hidden = false;
    barra.style.animation = 'none';
    void barra.offsetWidth;
    barra.style.animation = `encolher ${ms}ms linear forwards`;

    estado.timerJogada = setTimeout(() => {
        if (partida === estado.partida && estado.aceitandoEntrada) fimDeJogo('tempo');
    }, ms);
}

// Marca o início da vez do jogador (reação + limite de tempo).
function iniciarVez() {
    estado.inicioVez = performance.now();
    if (config.limiteTempo) iniciarTimerJogada();
}

/* =========================================================
   Fluxo da partida
   ========================================================= */

function mensagemObserve() {
    if (config.modo === 'dois') return `Jogador ${estado.jogadorAtual}: observe a sequência…`;
    if (config.modo === 'reverso') return 'Observe… você vai repetir ao contrário.';
    return 'Observe a sequência…';
}

function mensagemVez() {
    if (config.modo === 'dois') return `Jogador ${estado.jogadorAtual}, sua vez!`;
    if (config.modo === 'reverso') return 'Sua vez! Repita ao contrário.';
    if (config.modo === 'sempistas') return 'Sua vez! (as cores não acendem)';
    return 'Sua vez!';
}

async function mostrarSequencia(partida, novasCores) {
    estado.aceitandoEntrada = false;
    atualizarBloqueio();
    definirStatus(novasCores ? '✨ Novas cores no tabuleiro! Observe…' : mensagemObserve());

    // Quanto maior o nível, mais rápida a exibição (exceto fácil e ritmo).
    const { duracao, pausa } = L.velocidade(config.dificuldade, estado.sequencia.length, config.modo);

    await esperar(novasCores ? 1300 : 700);
    if (partida !== estado.partida) return;

    // Modo ritmo: três batidas de metrônomo na mesma cadência da sequência.
    if (config.modo === 'ritmo') {
        for (let i = 0; i < 3; i++) {
            somTique();
            await esperar(duracao + pausa);
            if (partida !== estado.partida) return;
        }
    }

    for (const nome of estado.sequencia) {
        if (partida !== estado.partida) return;
        await acender(estado.layout.indexOf(nome), duracao);
        await esperar(pausa);
    }
    if (partida !== estado.partida) return;

    estado.posicao = 0;
    estado.aceitandoEntrada = true;
    atualizarBloqueio();
    definirStatus(mensagemVez());
    iniciarVez();
}

function proximaRodada() {
    const nivel = estado.sequencia.length + 1;
    const n = L.quantidadeCores(config.cores, nivel);

    let novasCores = false;
    if (n !== estado.layout.length) {
        montarTabuleiro(n);
        novasCores = true;
    }

    const pesos = config.modo === 'treino' ? L.pesosTreino(stats.cores, estado.layout) : null;
    estado.sequencia.push(L.sortearCor(estado.layout, pesos));
    mostrarSequencia(estado.partida, novasCores);
}

function rodadaConcluida() {
    const partida = estado.partida;
    estado.aceitandoEntrada = false;
    pararTimerJogada();
    atualizarBloqueio();

    let marco = null;
    if (config.modo === 'dois') {
        estado.pontosJ[estado.jogadorAtual - 1]++;
        estado.jogadorAtual = estado.jogadorAtual === 1 ? 2 : 1;
    } else {
        estado.pontos = estado.sequencia.length;
        marco = L.mensagemMarco(estado.pontos);
    }

    atualizarPlacar();
    pulsarPlacar();
    vibrar(40);

    if (marco) {
        somMarco();
        definirStatus(marco);
    } else {
        somAcerto();
        definirStatus('Acertou! Próximo nível…');
    }

    setTimeout(() => {
        if (partida === estado.partida && estado.jogando) proximaRodada();
    }, marco ? 1800 : 900);
}

function fimDeJogo(motivo) {
    const esperada = L.corEsperada(estado.sequencia, estado.posicao, config.modo);

    estado.jogando = false;
    estado.aceitandoEntrada = false;
    pararTimerJogada();
    atualizarBloqueio();

    somErro();
    vibrar([100, 60, 200]);
    tabuleiro.classList.add('erro');
    setTimeout(() => tabuleiro.classList.remove('erro'), 600);

    const prefixo = motivo === 'tempo' ? '⏱️ Tempo esgotado! ' : '';
    let mensagem;
    let novoRecorde = false;

    if (config.modo === 'dois') {
        const vencedor = estado.jogadorAtual === 1 ? 2 : 1;
        mensagem = `${prefixo}Jogador ${vencedor} venceu! (${estado.pontosJ[0]} × ${estado.pontosJ[1]})`;
    } else {
        if (motivo === 'tempo') L.registrarJogada(stats, esperada, false, 0);

        novoRecorde = L.registrarPartida(stats, {
            pontos: estado.pontos,
            modo: config.modo,
            dificuldade: config.dificuldade,
        });

        if (estado.pontos > 0) {
            ranking = L.adicionarAoRanking(ranking, {
                pontos: estado.pontos,
                modo: config.modo,
                dificuldade: config.dificuldade,
                data: new Date().toISOString(),
            });
            armazenar.gravar('ranking', ranking);
        }
        armazenar.gravar('stats', stats);

        mensagem = novoRecorde
            ? `${prefixo}Fim de jogo! Novo recorde: ${estado.pontos} 🎉`
            : `${prefixo}Fim de jogo! Você fez ${estado.pontos} ponto(s).`;
    }

    atualizarPlacar();
    definirStatus(mensagem);
    atualizarControles();
    if (novoRecorde) {
        somMarco();
        confete();
    }

    btnIniciar.textContent = 'Jogar de novo';
    btnIniciar.disabled = false;
    btnIniciar.focus();
}

async function contagemRegressiva(partida) {
    elRotulo.textContent = 'Prepare-se';
    elPontos.classList.remove('duplo');
    linhaRecorde.hidden = true;

    for (const n of [3, 2, 1]) {
        elPontos.textContent = n;
        definirStatus(`Começando em ${n}…`);
        somTique();
        await esperar(700);
        if (partida !== estado.partida) return false;
    }
    return true;
}

async function iniciarJogo() {
    estado.partida++;
    const partida = estado.partida;

    estado.sequencia = [];
    estado.posicao = 0;
    estado.pontos = 0;
    estado.pontosJ = [0, 0];
    estado.jogadorAtual = 1;
    estado.jogando = true;
    estado.aceitandoEntrada = false;

    btnIniciar.disabled = true;
    btnIniciar.textContent = 'Jogando…';
    montarTabuleiro(L.quantidadeCores(config.cores, 1));
    atualizarBloqueio();
    atualizarControles();

    const continuar = await contagemRegressiva(partida);
    if (!continuar) return;

    atualizarPlacar();
    proximaRodada();
}

// Chamado a cada toque (ou tecla) do jogador. `indice` = posição no tabuleiro.
function jogada(indice) {
    if (!estado.aceitandoEntrada) return;

    const nome = estado.layout[indice];
    const esperada = L.corEsperada(estado.sequencia, estado.posicao, config.modo);
    const acertou = nome === esperada;
    const tempo = performance.now() - estado.inicioVez;

    pararTimerJogada();
    vibrar(30);

    // Modo "sem pistas": só o som confirma o toque.
    if (config.modo === 'sempistas') tocarNota(L.CORES[nome].frequencia, 200);
    else acender(indice, 200);

    if (config.modo !== 'dois') L.registrarJogada(stats, esperada, acertou, tempo);

    if (!acertou) {
        fimDeJogo('erro');
        return;
    }

    estado.posicao++;
    if (estado.posicao === estado.sequencia.length) rodadaConcluida();
    else iniciarVez();
}

/* =========================================================
   Confete (novo recorde)
   ========================================================= */

function confete() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const contexto = elConfete.getContext && elConfete.getContext('2d');
    if (!contexto) return;

    elConfete.width = window.innerWidth;
    elConfete.height = window.innerHeight;
    elConfete.hidden = false;

    const paleta = ['#ff5252', '#4dff88', '#fff04d', '#5a8bff', '#ff9f43', '#c08bff'];
    const pecas = Array.from({ length: 140 }, () => ({
        x: Math.random() * elConfete.width,
        y: -20 - Math.random() * elConfete.height * 0.4,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        tamanho: 5 + Math.random() * 6,
        cor: paleta[Math.floor(Math.random() * paleta.length)],
    }));
    const fim = performance.now() + 2600;

    (function quadro(agora) {
        contexto.clearRect(0, 0, elConfete.width, elConfete.height);
        for (const p of pecas) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            contexto.fillStyle = p.cor;
            contexto.fillRect(p.x, p.y, p.tamanho, p.tamanho * 0.6);
        }
        if (agora < fim) {
            requestAnimationFrame(quadro);
        } else {
            contexto.clearRect(0, 0, elConfete.width, elConfete.height);
            elConfete.hidden = true;
        }
    })(performance.now());
}

/* =========================================================
   Configurações
   ========================================================= */

function preencherSelect(select, opcoes) {
    select.replaceChildren(...opcoes.map(([valor, rotulo]) => criar('option', { value: valor, texto: rotulo })));
}

function atualizarControles() {
    const bloquear = estado.jogando;
    [selModo, selDificuldade, selCores].forEach((s) => { s.disabled = bloquear; });
    $('aviso-config').hidden = !bloquear;
}

function sincronizarConfigNaTela() {
    selModo.value = config.modo;
    selDificuldade.value = config.dificuldade;
    selCores.value = config.cores;
    selTema.value = config.tema;
    selTimbre.value = config.timbre;
    rngVolume.value = config.volume;
    chkVibracao.checked = config.vibracao;
    chkTempo.checked = config.limiteTempo;
    $('desc-modo').textContent = L.MODOS[config.modo].descricao;
    $('desc-tempo').textContent = `(${L.DIFICULDADES[config.dificuldade].tempoLimite / 1000} s nesta dificuldade)`;

    document.documentElement.dataset.tema = config.tema;
    btnSom.setAttribute('aria-pressed', String(config.som));
    btnSom.textContent = config.som ? '🔊 Som' : '🔇 Som';
    aplicarVolume();
}

function mudarConfig(parcial) {
    const estrutural = ['modo', 'dificuldade', 'cores'].some((k) => k in parcial && parcial[k] !== config[k]);

    config = L.normalizarConfig({ ...config, ...parcial });
    armazenar.gravar('config', config);
    sincronizarConfigNaTela();
    atualizarInfo();

    // Mudou o tipo de jogo: reinicia a tela inicial (só fora de partida).
    if (estrutural && !estado.jogando) {
        estado.pontos = 0;
        estado.pontosJ = [0, 0];
        montarTabuleiro(L.quantidadeCores(config.cores, 1));
        atualizarPlacar();
        definirStatus(`Clique em Iniciar. ${dicaTeclas()}`);
        btnIniciar.textContent = 'Iniciar';
    } else {
        atualizarPlacar();
    }
}

function abrirDialogo(dialogo) {
    if (typeof dialogo.showModal === 'function') dialogo.showModal();
    else dialogo.setAttribute('open', '');
}

/* =========================================================
   Estatísticas
   ========================================================= */

function desenharHistorico() {
    const alvo = $('stats-historico');
    alvo.replaceChildren();

    if (stats.historico.length < 2) {
        alvo.append(criar('p', { class: 'vazio', texto: 'Jogue mais partidas para ver a evolução.' }));
        return;
    }

    const ultimas = stats.historico.slice(-15);
    const maximo = Math.max(...ultimas.map((h) => h.pontos), 1);
    const LARGURA = 220;
    const ALTURA = 60;
    const margem = 6;
    const passo = (LARGURA - 2 * margem) / (ultimas.length - 1);
    const pontos = ultimas
        .map((h, i) => `${(margem + i * passo).toFixed(1)},${(ALTURA - margem - (h.pontos / maximo) * (ALTURA - 2 * margem)).toFixed(1)}`)
        .join(' ');

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${LARGURA} ${ALTURA}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Pontuação das últimas ${ultimas.length} partidas, máximo ${maximo}`);

    // linha de base (zero ponto), para a escala ficar clara mesmo quando todas as partidas empatam
    const base = document.createElementNS(NS, 'line');
    base.setAttribute('x1', margem);
    base.setAttribute('x2', LARGURA - margem);
    base.setAttribute('y1', ALTURA - margem);
    base.setAttribute('y2', ALTURA - margem);
    base.setAttribute('stroke', 'currentColor');
    base.setAttribute('stroke-opacity', '0.3');
    base.setAttribute('stroke-dasharray', '3 3');

    const linha = document.createElementNS(NS, 'polyline');
    linha.setAttribute('points', pontos);
    linha.setAttribute('fill', 'none');
    linha.setAttribute('stroke', 'currentColor');
    linha.setAttribute('stroke-width', '2');
    linha.setAttribute('stroke-linejoin', 'round');
    svg.append(base, linha);

    for (const ponto of pontos.split(' ')) {
        const [cx, cy] = ponto.split(',');
        const bolinha = document.createElementNS(NS, 'circle');
        bolinha.setAttribute('cx', cx);
        bolinha.setAttribute('cy', cy);
        bolinha.setAttribute('r', '2.5');
        bolinha.setAttribute('fill', 'currentColor');
        svg.append(bolinha);
    }

    alvo.append(svg, criar('p', { class: 'vazio', texto: `Últimas ${ultimas.length} partidas (máximo ${maximo}).` }));
}

function desenharStats() {
    const r = L.resumo(stats);

    const item = (titulo, valor) => criar('div', {}, criar('dt', { texto: titulo }), criar('dd', { texto: valor }));
    $('stats-resumo').replaceChildren(
        item('Partidas', r.partidas),
        item('Melhor pontuação', r.melhor),
        item('Média de pontos', r.media),
        item('Tempo de reação', r.tempoMedioMs ? `${(r.tempoMedioMs / 1000).toFixed(2)} s` : '—'),
    );

    const blocoCores = $('stats-cores');
    blocoCores.replaceChildren();
    if (!r.porCor.length) {
        blocoCores.append(criar('p', { class: 'vazio', texto: 'Ainda não há jogadas registradas.' }));
    }
    for (const c of r.porCor) {
        const cor = L.CORES[c.nome];
        const pct = Math.round(c.taxaErro * 100);
        const preenchimento = criar('span', { class: 'preenchimento' });
        preenchimento.style.width = `${pct}%`;
        preenchimento.style.backgroundColor = `var(--c-${c.nome}-aceso)`;

        blocoCores.append(criar(
            'div',
            { class: 'barra-cor' },
            criar('span', { texto: `${cor.simbolo} ${cor.rotulo}` }),
            criar('span', { class: 'trilho' }, preenchimento),
            criar('span', { texto: `${pct}% (${c.erros}/${c.total})` }),
        ));
    }

    desenharHistorico();

    const lista = $('stats-ranking');
    lista.replaceChildren();
    if (!ranking.length) {
        lista.append(criar('li', { class: 'vazio', texto: 'Nenhuma pontuação ainda.' }));
    }
    for (const e of ranking) {
        const modo = L.MODOS[e.modo] ? L.MODOS[e.modo].rotulo : e.modo;
        const dif = L.DIFICULDADES[e.dificuldade] ? L.DIFICULDADES[e.dificuldade].rotulo : e.dificuldade;
        const data = e.data ? new Date(e.data).toLocaleDateString('pt-BR') : '';
        lista.append(criar('li', { texto: `${e.pontos} pts · ${modo} · ${dif} · ${data}` }));
    }
}

/* =========================================================
   Eventos
   ========================================================= */

btnIniciar.addEventListener('click', iniciarJogo);

btnSom.addEventListener('click', () => mudarConfig({ som: !config.som }));

$('btn-config').addEventListener('click', () => {
    sincronizarConfigNaTela();
    atualizarControles();
    abrirDialogo(dlgConfig);
});

$('btn-stats').addEventListener('click', () => {
    desenharStats();
    abrirDialogo(dlgStats);
});

// Fechar a janela clicando fora dela.
[dlgConfig, dlgStats].forEach((dialogo) => {
    dialogo.addEventListener('click', (evento) => {
        if (evento.target === dialogo && typeof dialogo.close === 'function') dialogo.close();
    });
});

selModo.addEventListener('change', () => mudarConfig({ modo: selModo.value }));
selDificuldade.addEventListener('change', () => mudarConfig({ dificuldade: selDificuldade.value }));
selCores.addEventListener('change', () => mudarConfig({ cores: selCores.value }));
selTema.addEventListener('change', () => mudarConfig({ tema: selTema.value }));
selTimbre.addEventListener('change', () => {
    mudarConfig({ timbre: selTimbre.value });
    tocarNota(392, 300); // pré-escuta
});
rngVolume.addEventListener('input', () => mudarConfig({ volume: Number(rngVolume.value) }));
rngVolume.addEventListener('change', () => tocarNota(392, 200)); // pré-escuta
chkVibracao.addEventListener('change', () => {
    mudarConfig({ vibracao: chkVibracao.checked });
    vibrar(80);
});
chkTempo.addEventListener('change', () => mudarConfig({ limiteTempo: chkTempo.checked }));

// "Zerar dados" pede confirmação com um segundo clique (sem janelas do navegador).
let timerZerar = null;
$('btn-zerar').addEventListener('click', (evento) => {
    const botao = evento.currentTarget;

    if (!timerZerar) {
        botao.textContent = 'Tem certeza? Clique de novo';
        timerZerar = setTimeout(() => {
            botao.textContent = 'Zerar dados';
            timerZerar = null;
        }, 3500);
        return;
    }

    clearTimeout(timerZerar);
    timerZerar = null;
    botao.textContent = 'Zerar dados';
    stats = L.novoStats();
    ranking = [];
    armazenar.apagar('stats');
    armazenar.apagar('ranking');
    atualizarPlacar();
    desenharStats();
});

function indiceDaTecla(tecla) {
    const k = tecla.toLowerCase();
    if (/^[1-8]$/.test(k)) {
        const indice = Number(k) - 1;
        return indice < estado.layout.length ? indice : -1;
    }
    const nome = L.TECLAS_LETRA[k];
    return nome ? estado.layout.indexOf(nome) : -1;
}

document.addEventListener('keydown', (evento) => {
    if (evento.repeat || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(evento.target.tagName)) return;

    const indice = indiceDaTecla(evento.key);
    if (indice !== -1) jogada(indice);
});

/* =========================================================
   Início
   ========================================================= */

preencherSelect(selModo, Object.entries(L.MODOS).map(([valor, m]) => [valor, m.rotulo]));
preencherSelect(selDificuldade, Object.entries(L.DIFICULDADES).map(([valor, d]) => [valor, d.rotulo]));
preencherSelect(selCores, L.OPCOES_CORES.map((valor) => [valor, valor === 'crescente' ? 'Crescente (4 → 6 → 8)' : `${valor} cores`]));
preencherSelect(selTema, Object.entries(L.TEMAS));
preencherSelect(selTimbre, Object.entries(L.TIMBRES).map(([valor, t]) => [valor, t.rotulo]));

sincronizarConfigNaTela();
atualizarInfo();
montarTabuleiro(L.quantidadeCores(config.cores, 1));
atualizarPlacar();
atualizarBloqueio();
atualizarControles();
definirStatus(`Clique em Iniciar. ${dicaTeclas()}`);
btnIniciar.focus();

// PWA: funciona offline quando servido por http(s) (ex.: GitHub Pages).
if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sem offline, mas o jogo funciona */ });
}
