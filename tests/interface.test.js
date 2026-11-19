'use strict';

/*
 * Testes de integração: abrem a página de verdade (jsdom), carregam logica.js e script.js
 * e jogam partidas completas em cada modo.
 *
 * Para os testes serem rápidos e previsíveis:
 *  - os temporizadores da página rodam FATOR vezes mais rápido;
 *  - o sorteio é controlado (Math.random devolve valores combinados);
 *  - áudio e vibração são substituídos por versões falsas que só contam chamadas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PASTA = path.join(__dirname, '..', 'Jogo Genesis');
const ler = (nome) => fs.readFileSync(path.join(PASTA, nome), 'utf8');
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FATOR = 20;
const PREFIXO = 'jogo-da-memoria:';

// Valor de Math.random que sorteia cada cor no tabuleiro de 4 cores
// (ordem: vermelho, azul, amarelo, verde).
const R4 = { vermelho: 0.1, azul: 0.3, amarelo: 0.6, verde: 0.9 };

/* ---------- Ferramentas ---------- */

function abrirJogo({ config, stats, ranking, sequencia, resto = 0.01, audio = false } = {}) {
    const acesos = [];      // cores que acenderam, na ordem
    const vibracoes = [];   // argumentos de navigator.vibrate
    const som = { osc: [], ganhos: [] };

    const html = ler('index.html').replace(/<script[^>]*><\/script>/g, '');
    const dom = new JSDOM(html, {
        url: 'http://localhost/',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        beforeParse(w) {
            const guardar = (chave, valor) => {
                if (valor !== undefined) w.localStorage.setItem(PREFIXO + chave, JSON.stringify(valor));
            };
            guardar('config', config);
            guardar('stats', stats);
            guardar('ranking', ranking);

            const setTimeoutOriginal = w.setTimeout.bind(w);
            w.setTimeout = (fn, ms, ...args) => setTimeoutOriginal(fn, (ms || 0) / FATOR, ...args);

            if (sequencia) {
                const valores = sequencia.map((nome) => R4[nome]);
                let i = 0;
                w.Math.random = () => (i < valores.length ? valores[i++] : resto);
            }

            w.navigator.vibrate = (padrao) => {
                vibracoes.push(padrao);
                return true;
            };

            if (audio) {
                w.AudioContext = class {
                    constructor() {
                        this.currentTime = 0;
                        this.state = 'running';
                        this.destination = {};
                    }
                    resume() {}
                    createGain() {
                        const ganho = {
                            gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
                            connect: (destino) => destino,
                        };
                        som.ganhos.push(ganho);
                        return ganho;
                    }
                    createOscillator() {
                        const osc = {
                            type: '',
                            frequency: { value: 0 },
                            connect: (destino) => destino,
                            start: () => som.osc.push({ tipo: osc.type, freq: osc.frequency.value }),
                            stop() {},
                        };
                        return osc;
                    }
                };
            }
        },
    });

    const w = dom.window;
    const doc = w.document;

    const observador = new w.MutationObserver((mutacoes) => {
        for (const m of mutacoes) {
            if (m.target.classList.contains('aceso') && !(m.oldValue || '').includes('aceso')) {
                acesos.push(m.target.dataset.cor);
            }
        }
    });
    observador.observe(doc.getElementById('tabuleiro'), {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['class'],
        subtree: true,
    });

    w.eval(ler('logica.js'));
    w.eval(ler('script.js'));

    const status = () => doc.getElementById('status').textContent;

    const j = {
        w,
        doc,
        acesos,
        vibracoes,
        som,
        status,
        pads: () => Array.from(doc.querySelectorAll('.pad')),
        pad: (nome) => doc.querySelector(`.pad[data-cor="${nome}"]`),
        clicar: (...nomes) => nomes.forEach((nome) => j.pad(nome).click()),
        iniciar: () => doc.getElementById('btn-iniciar').click(),
        pontos: () => doc.getElementById('pontos').textContent,
        tecla: (key) => doc.dispatchEvent(new w.KeyboardEvent('keydown', { key })),
        armazenado: (chave) => JSON.parse(w.localStorage.getItem(PREFIXO + chave)),
        mudar(id, valor) {
            const el = doc.getElementById(id);
            el.value = valor;
            el.dispatchEvent(new w.Event('change'));
        },
        // Espera a mensagem de status bater com o padrão.
        async ate(padrao, max = 15000) {
            await dormir(0); // dá a vez ao observador de mutações (ele só entrega os eventos depois de um await)
            const inicio = Date.now();
            while (!padrao.test(status())) {
                if (Date.now() - inicio > max) throw new Error(`tempo esgotado esperando ${padrao}; status atual: "${status()}"`);
                await dormir(5);
            }
        },
        // Espera a vez do jogador e joga a sequência indicada.
        async jogarRodada(...nomes) {
            await j.ate(/sua vez/i);
            j.clicar(...nomes);
        },
        fechar: () => w.close(),
    };
    return j;
}

// Roda o corpo do teste e sempre fecha a página no fim (para parar os temporizadores).
const jogo = (opcoes, corpo) => async () => {
    const j = abrirJogo(opcoes);
    try {
        await corpo(j);
    } finally {
        j.fechar();
    }
};

/* ---------- Arquivos do PWA ---------- */

test('PWA: manifest, ícones e service worker apontam para arquivos que existem', () => {
    const manifest = JSON.parse(ler('manifest.webmanifest'));
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.length >= 2);

    for (const icone of manifest.icons) {
        const caminho = path.join(PASTA, icone.src);
        assert.ok(fs.existsSync(caminho), `ícone ausente: ${icone.src}`);

        const [largura, altura] = icone.sizes.split('x').map(Number);
        const png = fs.readFileSync(caminho);
        assert.equal(png.readUInt32BE(16), largura, `largura de ${icone.src}`);
        assert.equal(png.readUInt32BE(20), altura, `altura de ${icone.src}`);
    }

    const emCache = [...ler('sw.js').matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
    for (const arquivo of emCache) assert.ok(fs.existsSync(path.join(PASTA, arquivo)), `no cache mas inexistente: ${arquivo}`);

    // tudo o que a página carrega precisa estar no cache offline
    const referencias = [...ler('index.html').matchAll(/(?:href|src)="([^"#]+)"/g)]
        .map((m) => m[1])
        .filter((ref) => !/^https?:/.test(ref));
    assert.ok(referencias.length >= 5);
    for (const ref of referencias) {
        assert.ok(fs.existsSync(path.join(PASTA, ref)), `referência quebrada: ${ref}`);
        assert.ok(emCache.includes(ref), `falta no cache offline: ${ref}`);
    }
});

/* ---------- Modos de jogo ---------- */

test('clássico: contagem, sequência, bloqueio de toques, erro, recorde e ranking', jogo({ sequencia: ['verde', 'azul'] }, async (j) => {
    // antes de iniciar, toques são ignorados
    assert.equal(j.pads().length, 4);
    j.clicar('verde');
    await dormir(20);
    assert.deepEqual(j.acesos, []);

    j.iniciar();
    assert.match(j.status(), /começando em 3/i);
    assert.equal(j.doc.getElementById('btn-iniciar').disabled, true);
    assert.equal(j.doc.getElementById('sel-modo').disabled, true, 'modo não muda durante a partida');
    j.clicar('verde'); // durante a contagem
    assert.deepEqual(j.acesos, []);

    await j.ate(/observe/i);
    const antes = j.acesos.length;
    j.clicar('azul'); // durante a exibição da sequência
    await dormir(5);
    assert.equal(j.acesos.length, antes, 'toque durante a sequência deve ser ignorado');

    // rodada 1: uma cor
    await j.ate(/sua vez/i);
    assert.deepEqual(j.acesos, ['verde']);
    j.clicar('verde');
    await j.ate(/acertou/i);
    assert.equal(j.pontos(), '1');
    j.acesos.length = 0;

    // rodada 2: a sequência mantém a primeira cor e ganha uma nova
    await j.ate(/sua vez/i);
    assert.deepEqual(j.acesos, ['verde', 'azul']);
    j.clicar('verde', 'verde'); // segunda cor errada (esperada: azul)

    assert.match(j.status(), /fim de jogo.*novo recorde: 1/i);
    assert.equal(j.doc.getElementById('btn-iniciar').textContent, 'Jogar de novo');
    assert.equal(j.doc.getElementById('btn-iniciar').disabled, false);
    assert.equal(j.doc.getElementById('sel-modo').disabled, false);

    const stats = j.armazenado('stats');
    assert.equal(stats.partidas, 1);
    assert.equal(stats.recordes['classico|normal'], 1);
    assert.deepEqual(stats.cores.azul, { acertos: 0, erros: 1 }, 'erro é contado na cor que deveria ter sido tocada');
    assert.equal(j.armazenado('ranking').length, 1);

    // jogar de novo recomeça do zero
    await dormir(10);
    j.acesos.length = 0;
    j.iniciar();
    await j.ate(/sua vez/i);
    assert.equal(j.acesos.length, 1);
    assert.equal(j.doc.getElementById('recorde').textContent, '1');
}));

test('reverso: a sequência é repetida de trás para frente', jogo({ config: { modo: 'reverso' }, sequencia: ['verde', 'azul'] }, async (j) => {
    j.iniciar();
    await j.jogarRodada('verde');
    await j.ate(/acertou/i);

    await j.jogarRodada('azul', 'verde'); // sequência [verde, azul] ao contrário
    await j.ate(/acertou/i);
    assert.equal(j.pontos(), '2');

    // sequência agora [verde, azul, vermelho]: tocar na ordem normal erra logo na primeira
    await j.jogarRodada('verde');
    assert.match(j.status(), /fim de jogo/i);
}));

test('dois jogadores: alternam e quem erra perde', jogo({ config: { modo: 'dois' }, sequencia: ['verde', 'azul'] }, async (j) => {
    j.iniciar();
    await j.ate(/jogador 1, sua vez/i);
    j.clicar('verde');
    await j.ate(/acertou/i);
    assert.equal(j.pontos(), '1 × 0');

    await j.ate(/jogador 2, sua vez/i);
    j.clicar('azul'); // errado: a sequência começa em verde
    assert.match(j.status(), /jogador 1 venceu.*\(1 × 0\)/i);
    assert.equal(j.armazenado('stats'), null, 'partida de dois jogadores não entra nas estatísticas pessoais');
}));

test('sem pistas: tocar não acende a cor, mas o som toca', jogo({ config: { modo: 'sempistas' }, sequencia: ['verde'], audio: true }, async (j) => {
    j.iniciar();
    await j.ate(/sua vez/i);
    assert.deepEqual(j.acesos, ['verde']); // a sequência mostrada continua acendendo
    j.acesos.length = 0;
    const notasAntes = j.som.osc.length;

    j.clicar('verde');
    await dormir(20);
    assert.deepEqual(j.acesos, [], 'o toque do jogador não pode acender a cor');
    assert.ok(j.som.osc.length > notasAntes, 'o toque deve tocar uma nota');
    assert.match(j.status(), /acertou/i);
}));

test('treino inteligente sorteia mais a cor em que o jogador mais erra', async () => {
    const maisErrada = { cores: { verde: { acertos: 0, erros: 50 } } };

    const treino = abrirJogo({ config: { modo: 'treino' }, stats: maisErrada, sequencia: ['amarelo'] });
    const classico = abrirJogo({ stats: maisErrada, sequencia: ['amarelo'] });
    // Math.random = 0.6 (amarelo no sorteio uniforme). Com os pesos do treino, cai no verde.
    for (const j of [treino, classico]) {
        j.w.Math.random = () => 0.7;
        j.iniciar();
    }
    try {
        await Promise.all([treino.ate(/sua vez/i), classico.ate(/sua vez/i)]);
        assert.deepEqual(treino.acesos, ['verde']);
        assert.deepEqual(classico.acesos, ['amarelo']);
    } finally {
        treino.fechar();
        classico.fechar();
    }
});

test('ritmo: três batidas de metrônomo antes da sequência', async () => {
    const contar = async (modo) => {
        const j = abrirJogo({ config: { modo, timbre: 'retro' }, sequencia: ['verde'], audio: true });
        try {
            j.iniciar();
            await j.ate(/sua vez/i);
            return j.som.osc.length;
        } finally {
            j.fechar();
        }
    };
    // timbre "retrô" = 1 oscilador por nota; o ritmo adiciona 3 batidas a mais
    assert.equal((await contar('ritmo')) - (await contar('classico')), 3);
});

/* ---------- Limite de tempo ---------- */

test('limite de tempo: estourar o tempo termina o jogo; acertar a tempo zera a barra', jogo(
    { config: { limiteTempo: true, dificuldade: 'facil' }, sequencia: ['verde', 'azul'] },
    async (j) => {
        j.iniciar();
        await j.ate(/sua vez/i);
        assert.equal(j.doc.getElementById('barra-tempo').hidden, false, 'a barra de tempo aparece na vez do jogador');

        j.clicar('verde');
        await j.ate(/acertou/i);
        assert.equal(j.doc.getElementById('barra-tempo').hidden, true, 'a barra some ao acertar');

        await j.ate(/sua vez/i);
        await j.ate(/tempo esgotado/i, 3000); // 8 s ÷ 20
        assert.match(j.status(), /fim de jogo/i);
        assert.equal(j.armazenado('stats').partidas, 1);
    },
));

/* ---------- Cores crescentes e marcos ---------- */

test('cores crescentes: o tabuleiro passa de 4 para 6 cores no nível 8 e o marco de 10 pontos aparece', jogo(
    { config: { cores: 'crescente', dificuldade: 'facil' }, sequencia: ['verde', 'azul', 'amarelo', 'vermelho', 'verde', 'azul', 'amarelo'] },
    async (j) => {
        const sequencia = ['verde', 'azul', 'amarelo', 'vermelho', 'verde', 'azul', 'amarelo'];
        j.iniciar();

        for (let nivel = 1; nivel <= 7; nivel++) {
            await j.jogarRodada(...sequencia.slice(0, nivel));
            await j.ate(/acertou/i);
            assert.equal(j.pads().length, 4, `nível ${nivel} ainda tem 4 cores`);
        }

        // nível 8: novas cores. Sorteio fora da lista cai em "vermelho" (índice 0 nos dois tabuleiros).
        await j.ate(/novas cores/i);
        assert.equal(j.pads().length, 6);
        assert.ok(j.pad('ciano') && j.pad('roxo'), 'as cores novas existem');

        const completa = [...sequencia];
        for (let nivel = 8; nivel <= 10; nivel++) {
            completa.push('vermelho');
            await j.jogarRodada(...completa);
            if (nivel < 10) await j.ate(/acertou/i);
        }
        assert.match(j.status(), /10 pontos/);
        assert.equal(j.pontos(), '10');
    },
));

/* ---------- Teclado ---------- */

test('teclado: números seguem o tabuleiro, Q/W/A/S seguem a versão original e janelas bloqueiam as teclas', jogo(
    { sequencia: ['verde', 'vermelho'] },
    async (j) => {
        j.iniciar();
        await j.ate(/sua vez/i);
        j.tecla('5'); // não existe no tabuleiro de 4 cores
        assert.match(j.status(), /sua vez/i);
        j.tecla('q'); // Q = verde
        await j.ate(/acertou/i);

        await j.ate(/sua vez/i); // sequência [verde, vermelho]
        j.tecla('Q');
        j.tecla('1'); // 1 = vermelho (topo do tabuleiro)
        await j.ate(/acertou/i);
        assert.equal(j.pontos(), '2');

        // com a janela de configurações aberta as teclas são ignoradas
        await j.ate(/sua vez/i);
        j.doc.getElementById('btn-config').click();
        j.tecla('1'); // seria erro (esperado: verde)
        assert.match(j.status(), /sua vez/i);
        assert.ok(j.doc.querySelector('dialog[open]'));
    },
));

/* ---------- Configurações, som e vibração ---------- */

test('configurações: opções do menu, troca de tema e persistência entre visitas', jogo({}, async (j) => {
    const opcoes = (id) => Array.from(j.doc.getElementById(id).options).map((o) => o.value);
    assert.deepEqual(opcoes('sel-modo'), ['classico', 'reverso', 'sempistas', 'dois', 'treino', 'ritmo']);
    assert.deepEqual(opcoes('sel-dificuldade'), ['facil', 'normal', 'dificil']);
    assert.deepEqual(opcoes('sel-cores'), ['4', '6', '8', 'crescente']);
    assert.deepEqual(opcoes('sel-tema'), ['escuro', 'claro', 'contraste', 'daltonico']);
    assert.deepEqual(opcoes('sel-timbre'), ['suave', 'piano', 'sino', 'retro']);
    assert.equal(j.doc.documentElement.dataset.tema, 'escuro');

    j.mudar('sel-tema', 'daltonico');
    j.mudar('sel-cores', '8');
    j.mudar('sel-modo', 'reverso');
    assert.equal(j.doc.documentElement.dataset.tema, 'daltonico');
    assert.equal(j.pads().length, 8, 'mudar o número de cores remonta o tabuleiro');
    assert.match(j.doc.getElementById('info-modo').textContent, /Reverso.*8 cores/);

    const salvo = j.armazenado('config');
    assert.equal(salvo.tema, 'daltonico');

    // "nova visita" com a configuração salva
    const outra = abrirJogo({ config: salvo });
    try {
        assert.equal(outra.doc.documentElement.dataset.tema, 'daltonico');
        assert.equal(outra.pads().length, 8);
        assert.equal(outra.doc.getElementById('sel-modo').value, 'reverso');
    } finally {
        outra.fechar();
    }

    // configuração corrompida volta ao padrão em vez de quebrar o jogo
    const corrompida = abrirJogo({ config: 'lixo' });
    try {
        assert.equal(corrompida.doc.documentElement.dataset.tema, 'escuro');
        assert.equal(corrompida.pads().length, 4);
    } finally {
        corrompida.fechar();
    }
}));

test('símbolos: cada cor do tabuleiro tem um símbolo próprio (tema para daltonismo)', jogo({ config: { cores: '8' } }, async (j) => {
    const simbolos = j.pads().map((p) => p.querySelector('.simbolo').textContent);
    assert.equal(new Set(simbolos).size, 8);
}));

test('som: timbres diferentes, volume e botão de silenciar', async () => {
    const osciladoresAteAVez = async (config) => {
        const j = abrirJogo({ config, sequencia: ['verde'], audio: true });
        try {
            j.iniciar();
            await j.ate(/sua vez/i);
            return j;
        } finally {
            j.fechar();
        }
    };

    // 3 tiques da contagem (1 oscilador cada) + a nota da sequência
    const piano = await osciladoresAteAVez({ timbre: 'piano' });
    assert.equal(piano.som.osc.length, 3 + 4, 'piano soma 4 harmônicos por nota');
    assert.equal(piano.som.osc[3].freq, 392, 'verde toca 392 Hz');

    const retro = await osciladoresAteAVez({ timbre: 'retro' });
    assert.equal(retro.som.osc.length, 3 + 1);
    assert.equal(retro.som.osc[3].tipo, 'square');

    const mudo = await osciladoresAteAVez({ som: false });
    assert.equal(mudo.som.osc.length, 0, 'sem som, nenhuma nota é tocada');

    const baixo = await osciladoresAteAVez({ volume: 0 });
    assert.equal(baixo.som.ganhos[0].gain.value, 0);
    const alto = await osciladoresAteAVez({ volume: 100 });
    assert.ok(Math.abs(alto.som.ganhos[0].gain.value - 0.35) < 1e-9);

    // botão de som alterna e grava
    const j = abrirJogo();
    try {
        const botao = j.doc.getElementById('btn-som');
        assert.equal(botao.getAttribute('aria-pressed'), 'true');
        botao.click();
        assert.equal(botao.getAttribute('aria-pressed'), 'false');
        assert.equal(j.armazenado('config').som, false);
    } finally {
        j.fechar();
    }
});

test('vibração: toque, acerto e erro vibram; desligada, nada vibra', async () => {
    const ligada = abrirJogo({ sequencia: ['verde', 'azul'] });
    try {
        ligada.iniciar();
        await ligada.jogarRodada('verde');
        assert.ok(ligada.vibracoes.includes(30), 'vibra ao tocar');
        assert.ok(ligada.vibracoes.includes(40), 'vibra ao acertar a rodada');

        await ligada.jogarRodada('azul');
        // o array nasce dentro do jsdom (outro "Array"), então comparo pelo valor
        assert.deepEqual(Array.from(ligada.vibracoes.at(-1)), [100, 60, 200], 'padrão longo no erro');
    } finally {
        ligada.fechar();
    }

    const desligada = abrirJogo({ config: { vibracao: false }, sequencia: ['verde'] });
    try {
        desligada.iniciar();
        await desligada.jogarRodada('verde');
        assert.deepEqual(desligada.vibracoes, []);
    } finally {
        desligada.fechar();
    }
});

/* ---------- Estatísticas ---------- */

test('estatísticas: resumo, taxa de erro por cor, ranking e "zerar dados" com confirmação', jogo({ sequencia: ['verde', 'azul'] }, async (j) => {
    j.iniciar();
    await j.jogarRodada('verde');
    await j.ate(/acertou/i);
    await j.jogarRodada('azul'); // errado (esperado: verde)
    assert.match(j.status(), /fim de jogo/i);

    j.doc.getElementById('btn-stats').click();
    assert.ok(j.doc.getElementById('dlg-stats').hasAttribute('open'));

    const itens = Array.from(j.doc.querySelectorAll('#stats-resumo dd')).map((d) => d.textContent);
    assert.deepEqual(itens.slice(0, 2), ['1', '1'], 'uma partida, melhor pontuação 1');

    const barras = Array.from(j.doc.querySelectorAll('.barra-cor')).map((b) => b.textContent);
    assert.ok(barras.some((t) => /Verde/.test(t) && /50% \(1\/2\)/.test(t)), `barras: ${barras.join(' | ')}`);
    assert.match(j.doc.querySelector('#stats-ranking li').textContent, /^1 pts · Clássico · Normal/);

    // um clique só pede confirmação; se não confirmar, volta ao normal
    const zerar = j.doc.getElementById('btn-zerar');
    zerar.click();
    assert.match(zerar.textContent, /tem certeza/i);
    assert.notEqual(j.armazenado('stats'), null);
    await dormir(3500 / FATOR + 40);
    assert.equal(zerar.textContent, 'Zerar dados');

    // dois cliques seguidos apagam tudo
    zerar.click();
    zerar.click();
    assert.equal(j.armazenado('stats'), null);
    assert.equal(j.armazenado('ranking'), null);
    assert.equal(j.doc.querySelector('#stats-resumo dd').textContent, '0');
}));
