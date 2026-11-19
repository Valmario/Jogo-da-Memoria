'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../Jogo Genesis/logica.js');

/* ---------- Cores e tabuleiro ---------- */

test('todo layout só usa cores que existem e cada layout contém o anterior', () => {
    for (const lista of Object.values(L.LAYOUTS)) {
        for (const nome of lista) assert.ok(L.CORES[nome], `cor desconhecida: ${nome}`);
    }
    assert.ok(L.LAYOUTS[4].every((c) => L.LAYOUTS[6].includes(c)));
    assert.ok(L.LAYOUTS[6].every((c) => L.LAYOUTS[8].includes(c)));
    assert.deepEqual([4, 6, 8].map((n) => L.LAYOUTS[n].length), [4, 6, 8]);
});

test('quantidadeCores: fixo e crescente', () => {
    assert.equal(L.quantidadeCores('4', 30), 4);
    assert.equal(L.quantidadeCores('6', 1), 6);
    assert.equal(L.quantidadeCores('8', 1), 8);
    assert.equal(L.quantidadeCores('valor-invalido', 5), 4);
    assert.equal(L.quantidadeCores('crescente', 1), 4);
    assert.equal(L.quantidadeCores('crescente', 7), 4);
    assert.equal(L.quantidadeCores('crescente', 8), 6);
    assert.equal(L.quantidadeCores('crescente', 15), 6);
    assert.equal(L.quantidadeCores('crescente', 16), 8);
});

test('pontosPoligono: começa no centro e fica dentro de 0%–100%', () => {
    for (const total of [4, 6, 8]) {
        for (let i = 0; i < total; i++) {
            const pontos = L.pontosPoligono(i, total).split(', ');
            assert.equal(pontos[0], '50% 50%');
            assert.ok(pontos.length > 8);
            for (const p of pontos) {
                const [x, y] = p.split(' ').map((v) => parseFloat(v));
                assert.ok(x >= -0.01 && x <= 100.01 && y >= -0.01 && y <= 100.01, p);
            }
        }
    }
});

test('centroSetor: o primeiro setor do tabuleiro de 4 fica no quadrante superior direito', () => {
    const { x, y } = L.centroSetor(0, 4);
    assert.ok(x > 50 && y < 50);
    const { x: x3, y: y3 } = L.centroSetor(3, 4);
    assert.ok(x3 < 50 && y3 < 50); // verde: superior esquerdo
});

/* ---------- Velocidade e dificuldade ---------- */

test('velocidade: normal mantém os valores da versão original e respeita o mínimo', () => {
    assert.deepEqual(L.velocidade('normal', 1, 'classico'), { duracao: 575, pausa: 240 });
    assert.deepEqual(L.velocidade('normal', 100, 'classico'), { duracao: 220, pausa: 100 });
});

test('velocidade: fácil é constante, difícil é mais rápida que normal', () => {
    assert.deepEqual(L.velocidade('facil', 1, 'classico'), L.velocidade('facil', 50, 'classico'));
    assert.ok(L.velocidade('dificil', 5, 'classico').duracao < L.velocidade('normal', 5, 'classico').duracao);
});

test('velocidade: modo ritmo tem cadência fixa', () => {
    assert.deepEqual(L.velocidade('dificil', 1, 'ritmo'), L.velocidade('facil', 40, 'ritmo'));
});

/* ---------- Regras de jogo ---------- */

test('corEsperada: normal e reverso', () => {
    const seq = ['verde', 'azul', 'rosa'];
    assert.equal(L.corEsperada(seq, 0, 'classico'), 'verde');
    assert.equal(L.corEsperada(seq, 2, 'classico'), 'rosa');
    assert.equal(L.corEsperada(seq, 0, 'reverso'), 'rosa');
    assert.equal(L.corEsperada(seq, 2, 'reverso'), 'verde');
});

test('sortearCor: uniforme e ponderado, com gerador controlado', () => {
    const lista = ['a', 'b', 'c', 'd'];
    assert.equal(L.sortearCor(lista, null, () => 0), 'a');
    assert.equal(L.sortearCor(lista, null, () => 0.99), 'd');

    // pesos [1, 1, 8, 0]: total 10 → 0–1 = a, 1–2 = b, 2–10 = c, d nunca
    const pesos = [1, 1, 8, 0];
    assert.equal(L.sortearCor(lista, pesos, () => 0.05), 'a');
    assert.equal(L.sortearCor(lista, pesos, () => 0.15), 'b');
    assert.equal(L.sortearCor(lista, pesos, () => 0.5), 'c');
    assert.equal(L.sortearCor(lista, pesos, () => 0.999), 'c');
});

test('sortearCor: pesos inválidos caem no sorteio uniforme', () => {
    const lista = ['a', 'b'];
    assert.equal(L.sortearCor(lista, [0, 0], () => 0.9), 'b');
    assert.equal(L.sortearCor(lista, [1], () => 0), 'a');
});

test('pesosTreino: sem dados todos iguais; quem mais erra pesa mais', () => {
    const lista = ['verde', 'azul'];
    const iguais = L.pesosTreino({}, lista);
    assert.equal(iguais[0], iguais[1]);

    const pesos = L.pesosTreino({ verde: { acertos: 1, erros: 9 }, azul: { acertos: 10, erros: 0 } }, lista);
    assert.ok(pesos[0] > pesos[1]);
    assert.ok(pesos.every((p) => p > 0));
});

test('mensagemMarco: só aparece a cada 10 pontos', () => {
    assert.equal(L.mensagemMarco(0), null);
    assert.equal(L.mensagemMarco(9), null);
    assert.match(L.mensagemMarco(10), /10 pontos/);
    assert.match(L.mensagemMarco(50), /50 pontos/);
    assert.match(L.mensagemMarco(70), /70 pontos/);
});

/* ---------- Configurações ---------- */

test('normalizarConfig: valores inválidos voltam ao padrão', () => {
    const c = L.normalizarConfig({ modo: 'xyz', dificuldade: 5, cores: '99', tema: null, volume: 500, som: false });
    assert.equal(c.modo, 'classico');
    assert.equal(c.dificuldade, 'normal');
    assert.equal(c.cores, '4');
    assert.equal(c.tema, 'escuro');
    assert.equal(c.volume, 100);
    assert.equal(c.som, false);
    assert.equal(c.vibracao, true);
    assert.equal(c.limiteTempo, false);
});

test('normalizarConfig: aceita entrada vazia e preserva valores válidos', () => {
    assert.equal(L.normalizarConfig(undefined).modo, 'classico');
    const c = L.normalizarConfig({ modo: 'reverso', cores: 'crescente', timbre: 'sino', limiteTempo: true });
    assert.equal(c.modo, 'reverso');
    assert.equal(c.cores, 'crescente');
    assert.equal(c.timbre, 'sino');
    assert.equal(c.limiteTempo, true);
});

/* ---------- Estatísticas e ranking ---------- */

test('estatísticas: partidas, média, melhor e recorde por modo/dificuldade', () => {
    const s = L.novoStats();
    assert.equal(L.registrarPartida(s, { pontos: 5, modo: 'classico', dificuldade: 'normal' }), true);
    assert.equal(L.registrarPartida(s, { pontos: 3, modo: 'classico', dificuldade: 'normal' }), false);
    assert.equal(L.registrarPartida(s, { pontos: 4, modo: 'classico', dificuldade: 'dificil' }), true); // outra categoria
    assert.equal(L.registrarPartida(s, { pontos: 0, modo: 'reverso', dificuldade: 'normal' }), false);

    const r = L.resumo(s);
    assert.equal(r.partidas, 4);
    assert.equal(r.melhor, 5);
    assert.equal(r.media, 3);
    assert.equal(s.recordes[L.chaveRecorde('classico', 'normal')], 5);
    assert.equal(s.recordes[L.chaveRecorde('classico', 'dificil')], 4);
});

test('estatísticas: taxa de erro por cor e tempo médio de reação', () => {
    const s = L.novoStats();
    L.registrarJogada(s, 'verde', true, 400);
    L.registrarJogada(s, 'verde', true, 600);
    L.registrarJogada(s, 'verde', false, 9999); // erro não entra no tempo
    L.registrarJogada(s, 'azul', false, 100);
    L.registrarJogada(s, 'cor-que-nao-existe', true, 100); // ignorada

    const r = L.resumo(s);
    assert.equal(r.tempoMedioMs, 500);
    assert.equal(r.porCor[0].nome, 'azul'); // 100% de erro vem primeiro
    assert.equal(r.porCor[0].taxaErro, 1);
    assert.equal(r.porCor[1].nome, 'verde');
    assert.ok(Math.abs(r.porCor[1].taxaErro - 1 / 3) < 1e-9);
    assert.equal(r.porCor.length, 2);
});

test('estatísticas: o histórico guarda só as últimas partidas', () => {
    const s = L.novoStats();
    for (let i = 0; i < L.LIMITE_HISTORICO + 10; i++) {
        L.registrarPartida(s, { pontos: i, modo: 'classico', dificuldade: 'normal' });
    }
    assert.equal(s.historico.length, L.LIMITE_HISTORICO);
    assert.equal(s.historico[s.historico.length - 1].pontos, L.LIMITE_HISTORICO + 9);
});

test('normalizarStats: descarta dados corrompidos', () => {
    assert.deepEqual(L.normalizarStats(null), L.novoStats());
    assert.deepEqual(L.normalizarStats('texto'), L.novoStats());

    const s = L.normalizarStats({
        partidas: -3,
        melhor: 'abc',
        cores: { verde: { acertos: 2, erros: 'x' }, invasora: { acertos: 1, erros: 1 } },
        recordes: { 'classico|normal': 7, '__proto__': 9, 'ruim': 3, 'a|b': -1 },
        historico: [{ pontos: 3, modo: 'classico', dificuldade: 'normal' }, { pontos: 'x' }, null],
    });
    assert.equal(s.partidas, 0);
    assert.equal(s.melhor, 0);
    assert.deepEqual(s.cores, { verde: { acertos: 2, erros: 0 } });
    assert.deepEqual(s.recordes, { 'classico|normal': 7 });
    assert.equal(s.historico.length, 1);
});

test('ranking: ordena por pontos, desempata por data e respeita o limite', () => {
    let r = [];
    r = L.adicionarAoRanking(r, { pontos: 5, modo: 'classico', dificuldade: 'normal', data: '2026-01-02' });
    r = L.adicionarAoRanking(r, { pontos: 9, modo: 'classico', dificuldade: 'normal', data: '2026-01-03' });
    r = L.adicionarAoRanking(r, { pontos: 5, modo: 'reverso', dificuldade: 'normal', data: '2026-01-01' });
    assert.deepEqual(r.map((e) => [e.pontos, e.data]), [[9, '2026-01-03'], [5, '2026-01-01'], [5, '2026-01-02']]);

    for (let i = 0; i < 20; i++) {
        r = L.adicionarAoRanking(r, { pontos: i + 10, modo: 'classico', dificuldade: 'normal', data: '2026-02-01' });
    }
    assert.equal(r.length, L.LIMITE_RANKING);
    assert.equal(r[0].pontos, 29);
});

test('normalizarRanking: ignora entradas inválidas', () => {
    assert.deepEqual(L.normalizarRanking('x'), []);
    const r = L.normalizarRanking([{ pontos: 4, modo: 'classico', dificuldade: 'normal', data: 'd' }, { pontos: 0 }, null, { pontos: 'a' }]);
    assert.equal(r.length, 1);
});
