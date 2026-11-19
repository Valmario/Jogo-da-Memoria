# Jogo da Memória (estilo Genius / Genesis)

Repita a sequência de cores que o jogo mostra. A cada rodada a sequência cresce e, dependendo da dificuldade, fica mais rápida.
Feito só com HTML, CSS e JavaScript puro, sem frameworks.

## Como jogar

1. Abra `Jogo Genesis/index.html` no navegador (ou o link do GitHub Pages, veja abaixo).
2. Escolha o modo e a dificuldade em **⚙️ Configurações** (opcional).
3. Clique em **Iniciar**, observe a sequência e repita quando aparecer "Sua vez!".

### Teclado

| Tecla | Cor |
|-------|-----|
| `1` a `8` | Fatias do tabuleiro, em sentido horário a partir do topo |
| `Q` `W` `A` `S` | Verde, vermelho, amarelo e azul (atalhos da versão original) |

As teclas ficam desativadas enquanto uma janela (Configurações ou Estatísticas) estiver aberta.

## Modos de jogo

| Modo | O que muda |
|------|-----------|
| Clássico | Repita a sequência. Um erro encerra a partida. |
| Reverso | Repita a sequência de trás para frente. |
| Sem pistas | As cores não acendem quando você toca; só o som confirma. |
| Dois jogadores | Os jogadores se alternam e quem errar perde. |
| Treino inteligente | Sorteia mais as cores em que você mais erra (usa o histórico de estatísticas). |
| Ritmo | Cadência constante, com três batidas de metrônomo antes da sequência. |

## Dificuldade

| | Velocidade | Limite de tempo por jogada (opcional) |
|---|---|---|
| Fácil | Constante | 8 s |
| Normal | Acelera a cada nível | 5 s |
| Difícil | Começa rápido e acelera mais | 3 s |

O tabuleiro pode ter **4, 6 ou 8 cores**. No modo **crescente** ele começa com 4 e passa para 6 no nível 8 e para 8 no nível 16.
A cada 10 pontos aparece uma mensagem de marco.

## Acessibilidade

- Botões reais (`<button>`), com nome para leitor de tela e foco visível no teclado.
- Quatro temas: **escuro**, **claro**, **alto contraste** e **daltonismo** (paleta Okabe-Ito mais um símbolo em cada cor).
- Respeita a preferência do sistema por menos animação (`prefers-reduced-motion`).
- Vibração no celular (pode ser desligada).

## Som

Notas sintetizadas no navegador (Web Audio), sem arquivos de áudio. Quatro timbres (suave, piano, sino e retrô), volume ajustável e botão para silenciar.

## Estatísticas e ranking

Tudo fica salvo **no seu navegador** (`localStorage`):

- recorde separado por modo e dificuldade;
- partidas, média de pontos e tempo médio de reação;
- taxa de erro por cor;
- gráfico das últimas partidas;
- as 10 melhores pontuações.

O botão **Zerar dados** apaga tudo (pede confirmação com um segundo clique).

> Ranking online: este projeto não tem servidor, então o ranking é local. Para um placar global seria preciso um backend (por exemplo Flask + banco de dados, ou um serviço como Supabase) que receba e valide as pontuações.

## Instalar como app e jogar offline (PWA)

Quando o jogo é servido por `https` (como no GitHub Pages), o navegador oferece **instalar** na tela inicial e o jogo funciona offline. Abrindo o `index.html` direto do disco, o jogo funciona normalmente, só sem a parte de instalação/offline.

Ao alterar qualquer arquivo do jogo, aumente `VERSAO` em `Jogo Genesis/sw.js` para os visitantes receberem a versão nova.

## Estrutura

```
Jogo Genesis/
  index.html            página
  style.css             visual, temas e janelas
  logica.js             regras puras (sorteio, velocidade, estatísticas...), testável no Node
  script.js             interface, som e fluxo da partida
  sw.js                 service worker (offline)
  manifest.webmanifest  dados do app instalável
  icone*.png / .svg     ícones
tests/
  logica.test.js        testes das regras
  interface.test.js     testes que jogam partidas completas numa página simulada
.github/workflows/
  testes.yml            roda os testes a cada push e pull request
  pages.yml             testa e publica no GitHub Pages
```

## Testes

Precisa de Node 18 ou mais novo.

```bash
npm install
npm test
```

São 35 testes: 20 das regras do jogo e 15 de integração (partidas completas em cada modo, limite de tempo, cores crescentes, teclado, som, vibração, estatísticas, configurações e arquivos do PWA).

## Publicar no GitHub Pages

1. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Faça um push na branch `main`. O workflow `pages.yml` roda os testes e, se passarem, publica a pasta `Jogo Genesis`.
3. O endereço fica em `https://<seu-usuario>.github.io/<nome-do-repositorio>/`.
