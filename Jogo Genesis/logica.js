/*
 * Lógica pura do Jogo da Memória (sem DOM, sem som, sem armazenamento).
 *
 * Fica separada da interface para poder ser testada no Node
 * (veja a pasta tests/) e continua funcionando ao abrir o index.html
 * direto no navegador, sem servidor.
 */
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) {
        module.exports = api; // Node (testes)
    } else {
        raiz.JogoLogica = api; // navegador
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /* ---------- Cores ---------- */

    // Cada cor tem sempre o mesmo som e o mesmo símbolo (usado no tema para daltonismo).
    const CORES = {
        vermelho: { nome: 'vermelho', rotulo: 'Vermelho', simbolo: '▲', frequencia: 330 },
        azul:     { nome: 'azul',     rotulo: 'Azul',     simbolo: '■', frequencia: 196 },
        amarelo:  { nome: 'amarelo',  rotulo: 'Amarelo',  simbolo: '●', frequencia: 262 },
        verde:    { nome: 'verde',    rotulo: 'Verde',    simbolo: '◆', frequencia: 392 },
        laranja:  { nome: 'laranja',  rotulo: 'Laranja',  simbolo: '★', frequencia: 294 },
        ciano:    { nome: 'ciano',    rotulo: 'Ciano',    simbolo: '✚', frequencia: 440 },
        roxo:     { nome: 'roxo',     rotulo: 'Roxo',     simbolo: '♥', frequencia: 494 },
        rosa:     { nome: 'rosa',     rotulo: 'Rosa',     simbolo: '✖', frequencia: 370 },
    };

    // Ordem no tabuleiro: sentido horário, a partir das 12h.
    // Cada layout contém o anterior, então a sequência nunca fica inválida
    // quando o tabuleiro cresce de 4 para 6 ou 8 cores.
    const LAYOUTS = {
        4: ['vermelho', 'azul', 'amarelo', 'verde'],
        6: ['vermelho', 'amarelo', 'verde', 'ciano', 'azul', 'roxo'],
        8: ['vermelho', 'laranja', 'amarelo', 'verde', 'ciano', 'azul', 'roxo', 'rosa'],
    };

    // Atalhos de letra herdados da primeira versão (posição no tabuleiro de 4 cores).
    const TECLAS_LETRA = { q: 'verde', w: 'vermelho', a: 'amarelo', s: 'azul' };

    /* ---------- Opções de jogo ---------- */

    const MODOS = {
        classico: { rotulo: 'Clássico', descricao: 'Repita a sequência. Um erro encerra a partida.' },
        reverso:  { rotulo: 'Reverso', descricao: 'Repita a sequência de trás para frente.' },
        sempistas: { rotulo: 'Sem pistas', descricao: 'As cores não acendem quando você toca. Só o som confirma.' },
        dois:     { rotulo: 'Dois jogadores', descricao: 'Os jogadores se alternam. Quem errar perde.' },
        treino:   { rotulo: 'Treino inteligente', descricao: 'Sorteia mais as cores em que você mais erra.' },
        ritmo:    { rotulo: 'Ritmo', descricao: 'Cadência constante e batida de metrônomo, como uma melodia.' },
    };

    const DIFICULDADES = {
        facil: {
            rotulo: 'Fácil',
            duracaoInicial: 700, duracaoMinima: 700, reducaoPorNivel: 0,
            pausaInicial: 300, pausaMinima: 300, reducaoPausaPorNivel: 0,
            tempoLimite: 8000,
        },
        normal: {
            rotulo: 'Normal',
            duracaoInicial: 600, duracaoMinima: 220, reducaoPorNivel: 25,
            pausaInicial: 250, pausaMinima: 100, reducaoPausaPorNivel: 10,
            tempoLimite: 5000,
        },
        dificil: {
            rotulo: 'Difícil',
            duracaoInicial: 450, duracaoMinima: 150, reducaoPorNivel: 30,
            pausaInicial: 180, pausaMinima: 70, reducaoPausaPorNivel: 12,
            tempoLimite: 3000,
        },
    };

    const OPCOES_CORES = ['4', '6', '8', 'crescente'];

    const TEMAS = {
        escuro: 'Escuro',
        claro: 'Claro',
        contraste: 'Alto contraste',
        daltonico: 'Daltonismo (com símbolos)',
    };

    // Timbres: parciais somados (harmônicos) + envelope.
    // `decai: true` = som que vai morrendo (piano/sino); senão, sustenta e solta no fim.
    const TIMBRES = {
        suave: {
            rotulo: 'Suave',
            parciais: [
                { tipo: 'sine', razao: 1, ganho: 1 },
                { tipo: 'sine', razao: 2, ganho: 0.25 },
                { tipo: 'sine', razao: 3, ganho: 0.1 },
            ],
            ataque: 0.02, liberacao: 0.12, decai: false,
        },
        piano: {
            rotulo: 'Piano',
            parciais: [
                { tipo: 'triangle', razao: 1, ganho: 1 },
                { tipo: 'sine', razao: 2, ganho: 0.4 },
                { tipo: 'sine', razao: 3, ganho: 0.2 },
                { tipo: 'sine', razao: 4, ganho: 0.08 },
            ],
            ataque: 0.005, liberacao: 0.05, decai: true,
        },
        sino: {
            rotulo: 'Sino',
            parciais: [
                { tipo: 'sine', razao: 1, ganho: 1 },
                { tipo: 'sine', razao: 2.76, ganho: 0.5 },
                { tipo: 'sine', razao: 5.4, ganho: 0.25 },
                { tipo: 'sine', razao: 8.93, ganho: 0.12 },
            ],
            ataque: 0.003, liberacao: 0.05, decai: true,
        },
        retro: {
            rotulo: 'Retrô (8 bits)',
            parciais: [{ tipo: 'square', razao: 1, ganho: 0.5 }],
            ataque: 0.005, liberacao: 0.03, decai: false,
        },
    };

    const LIMITE_HISTORICO = 30;
    const LIMITE_RANKING = 10;

    /* ---------- Configurações ---------- */

    function normalizarConfig(entrada) {
        const e = entrada && typeof entrada === 'object' ? entrada : {};
        const escolher = (valor, validos, padrao) => (validos.includes(valor) ? valor : padrao);
        const volume = Number(e.volume);

        return {
            modo: escolher(e.modo, Object.keys(MODOS), 'classico'),
            dificuldade: escolher(e.dificuldade, Object.keys(DIFICULDADES), 'normal'),
            cores: escolher(String(e.cores), OPCOES_CORES, '4'),
            tema: escolher(e.tema, Object.keys(TEMAS), 'escuro'),
            timbre: escolher(e.timbre, Object.keys(TIMBRES), 'suave'),
            volume: Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : 70,
            som: e.som !== false,
            vibracao: e.vibracao !== false,
            limiteTempo: e.limiteTempo === true,
        };
    }

    /* ---------- Regras ---------- */

    // Quantas cores o tabuleiro tem. No modo "crescente" ele cresce com o nível.
    function quantidadeCores(opcao, nivel) {
        if (opcao === 'crescente') {
            if (nivel < 8) return 4;
            if (nivel < 16) return 6;
            return 8;
        }
        const n = Number(opcao);
        return LAYOUTS[n] ? n : 4;
    }

    // Duração de cada cor acesa e pausa entre elas (ms). `nivel` = tamanho da sequência.
    function velocidade(dificuldade, nivel, modo) {
        if (modo === 'ritmo') return { duracao: 300, pausa: 150 }; // cadência fixa (batida de 450 ms)
        const d = DIFICULDADES[dificuldade] || DIFICULDADES.normal;
        return {
            duracao: Math.max(d.duracaoMinima, d.duracaoInicial - nivel * d.reducaoPorNivel),
            pausa: Math.max(d.pausaMinima, d.pausaInicial - nivel * d.reducaoPausaPorNivel),
        };
    }

    // Sorteia uma cor da lista. Com `pesos`, cores com peso maior saem mais.
    function sortearCor(lista, pesos, rng = Math.random) {
        if (!Array.isArray(pesos) || pesos.length !== lista.length) {
            return lista[Math.floor(rng() * lista.length)];
        }
        const total = pesos.reduce((soma, p) => soma + Math.max(0, p), 0);
        if (total <= 0) return lista[Math.floor(rng() * lista.length)];

        let alvo = rng() * total;
        for (let i = 0; i < lista.length; i++) {
            alvo -= Math.max(0, pesos[i]);
            if (alvo < 0) return lista[i];
        }
        return lista[lista.length - 1];
    }

    // Modo treino: quanto maior a taxa de erro de uma cor, maior o peso dela.
    // O "+1 / +2" suaviza: sem dados, todas as cores têm o mesmo peso.
    function pesosTreino(statsCores, lista) {
        return lista.map((nome) => {
            const c = (statsCores && statsCores[nome]) || { acertos: 0, erros: 0 };
            const taxa = (c.erros + 1) / (c.acertos + c.erros + 2);
            return 1 + 6 * taxa;
        });
    }

    // Qual cor o jogador deve tocar agora.
    function corEsperada(sequencia, posicao, modo) {
        return modo === 'reverso' ? sequencia[sequencia.length - 1 - posicao] : sequencia[posicao];
    }

    const MARCOS = {
        10: '🔥 10 pontos! Você pegou o ritmo!',
        20: '⚡ 20 pontos! Memória afiada!',
        30: '🧠 30 pontos! Impressionante!',
        50: '🏆 50 pontos! Mestre do Genius!',
    };

    function mensagemMarco(pontos) {
        if (!(pontos > 0) || pontos % 10 !== 0) return null;
        return MARCOS[pontos] || `🎖️ ${pontos} pontos! Lendário!`;
    }

    const chaveRecorde = (modo, dificuldade) => `${modo}|${dificuldade}`;

    /* ---------- Estatísticas e ranking ---------- */

    function novoStats() {
        return {
            partidas: 0,
            pontosTotal: 0,
            melhor: 0,
            tempoTotal: 0,
            jogadasTempo: 0,
            cores: {},
            historico: [],
            recordes: {},
        };
    }

    // Garante um formato válido para dados vindos do localStorage.
    function normalizarStats(entrada) {
        const base = novoStats();
        if (!entrada || typeof entrada !== 'object') return base;

        const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

        if (entrada.cores && typeof entrada.cores === 'object') {
            for (const nome of Object.keys(CORES)) {
                const c = entrada.cores[nome];
                if (c && typeof c === 'object') base.cores[nome] = { acertos: num(c.acertos), erros: num(c.erros) };
            }
        }

        if (entrada.recordes && typeof entrada.recordes === 'object') {
            for (const [chave, valor] of Object.entries(entrada.recordes)) {
                if (/^[a-z]+\|[a-z]+$/.test(chave) && Number.isFinite(valor) && valor > 0) {
                    base.recordes[chave] = valor;
                }
            }
        }

        if (Array.isArray(entrada.historico)) {
            base.historico = entrada.historico
                .filter((h) => h && Number.isFinite(h.pontos) && h.pontos >= 0)
                .slice(-LIMITE_HISTORICO)
                .map((h) => ({ pontos: h.pontos, modo: String(h.modo || ''), dificuldade: String(h.dificuldade || '') }));
        }

        base.partidas = num(entrada.partidas);
        base.pontosTotal = num(entrada.pontosTotal);
        base.melhor = num(entrada.melhor);
        base.tempoTotal = num(entrada.tempoTotal);
        base.jogadasTempo = num(entrada.jogadasTempo);
        return base;
    }

    // Registra uma jogada: `cor` é a cor que o jogador DEVERIA tocar.
    function registrarJogada(stats, cor, acertou, tempoMs) {
        if (!CORES[cor]) return;
        const c = stats.cores[cor] || (stats.cores[cor] = { acertos: 0, erros: 0 });
        if (acertou) {
            c.acertos++;
            if (Number.isFinite(tempoMs) && tempoMs >= 0) {
                stats.tempoTotal += tempoMs;
                stats.jogadasTempo++;
            }
        } else {
            c.erros++;
        }
    }

    // Registra o fim de uma partida. Devolve true se bateu o recorde do modo/dificuldade.
    function registrarPartida(stats, { pontos, modo, dificuldade }) {
        const chave = chaveRecorde(modo, dificuldade);
        const anterior = stats.recordes[chave] || 0;

        stats.partidas++;
        stats.pontosTotal += pontos;
        stats.melhor = Math.max(stats.melhor, pontos);
        stats.historico.push({ pontos, modo, dificuldade });
        if (stats.historico.length > LIMITE_HISTORICO) {
            stats.historico = stats.historico.slice(-LIMITE_HISTORICO);
        }

        const novoRecorde = pontos > anterior;
        if (novoRecorde) stats.recordes[chave] = pontos;
        return novoRecorde;
    }

    function resumo(stats) {
        const porCor = Object.keys(stats.cores)
            .map((nome) => {
                const { acertos, erros } = stats.cores[nome];
                const total = acertos + erros;
                return { nome, acertos, erros, total, taxaErro: total ? erros / total : 0 };
            })
            .filter((c) => c.total > 0)
            .sort((a, b) => b.taxaErro - a.taxaErro || b.total - a.total);

        return {
            partidas: stats.partidas,
            media: stats.partidas ? Math.round((stats.pontosTotal / stats.partidas) * 10) / 10 : 0,
            melhor: stats.melhor,
            tempoMedioMs: stats.jogadasTempo ? Math.round(stats.tempoTotal / stats.jogadasTempo) : 0,
            porCor,
        };
    }

    // Ranking local: maior pontuação primeiro; empate fica com quem fez antes.
    function adicionarAoRanking(ranking, entrada, limite = LIMITE_RANKING) {
        return [...ranking, entrada]
            .sort((a, b) => b.pontos - a.pontos || String(a.data).localeCompare(String(b.data)))
            .slice(0, limite);
    }

    function normalizarRanking(lista) {
        if (!Array.isArray(lista)) return [];
        return lista
            .filter((e) => e && Number.isFinite(e.pontos) && e.pontos > 0)
            .map((e) => ({
                pontos: e.pontos,
                modo: String(e.modo || ''),
                dificuldade: String(e.dificuldade || ''),
                data: String(e.data || ''),
            }))
            .slice(0, LIMITE_RANKING);
    }

    /* ---------- Geometria do tabuleiro ---------- */

    // Pontos do clip-path (polígono) de uma fatia do círculo.
    // `folga` = espaço angular, em graus, entre as fatias.
    function pontosPoligono(indice, total, folga = 1.6) {
        const fatia = 360 / total;
        const inicio = -90 + indice * fatia + folga / 2;
        const fim = -90 + (indice + 1) * fatia - folga / 2;
        const passos = Math.max(8, Math.ceil(fatia / 5));
        const pontos = ['50% 50%'];

        for (let k = 0; k <= passos; k++) {
            const ang = ((inicio + ((fim - inicio) * k) / passos) * Math.PI) / 180;
            pontos.push(`${(50 + 50 * Math.cos(ang)).toFixed(2)}% ${(50 + 50 * Math.sin(ang)).toFixed(2)}%`);
        }
        return pontos.join(', ');
    }

    // Posição (em %) do centro visual de uma fatia, para colocar o símbolo.
    function centroSetor(indice, total, raio = 0.66) {
        const ang = ((-90 + (indice + 0.5) * (360 / total)) * Math.PI) / 180;
        return {
            x: Math.round((50 + 50 * raio * Math.cos(ang)) * 100) / 100,
            y: Math.round((50 + 50 * raio * Math.sin(ang)) * 100) / 100,
        };
    }

    return {
        CORES, LAYOUTS, TECLAS_LETRA, MODOS, DIFICULDADES, OPCOES_CORES, TEMAS, TIMBRES,
        LIMITE_HISTORICO, LIMITE_RANKING,
        normalizarConfig, quantidadeCores, velocidade, sortearCor, pesosTreino, corEsperada,
        mensagemMarco, chaveRecorde,
        novoStats, normalizarStats, registrarJogada, registrarPartida, resumo,
        adicionarAoRanking, normalizarRanking,
        pontosPoligono, centroSetor,
    };
});
