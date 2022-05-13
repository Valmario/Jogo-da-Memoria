let order = [];
let clickedOrder = [];
let score = 0;

//0 = verde
//1 = vermelho
//2 = amarelo
//3 = azul

const blue = document.querySelector('.blue');
const red = document.querySelector('.red');
const green = document.querySelector('.green');
const yellow = document.querySelector('.yellow');

//ordem aleatória
let shuffleOrder = () => {
    let colorOrder = Math.floor(Math.random() * 4);
    order[order.length] = colorOrder;
    clickedOrder = [];

    for(let i in order){
        let elementColor = createColorElement(order[i]);
        lightColor(elementColor, Number(i) + 1);
    }

}
//acede as cores
let lightColor = (element, number) => {
    number = number * 500;
    setTimeout(() => {
        element.classList.add('selected');
    }, number - 250);
    setTimeout(() => {
        element.classList.remove('selected');
    });
}
//checagem do click dos botões
let checkOrder = () => {
    for(let i in clickedOrder){
        if(clickedOrder[i] != order[i]){
            lose();
            break;
        }
    }
    if(clickedOrder.length == order.length){
        alert(`Pontuação: ${score}\nParabéns você acertou! Próximo nível!`);
        nextLevel();
    }
}

//click do usuário
let click = (color) => {
clickedOrder[clickedOrder.length] = color;
createColorElement(color).classList.add('selected');

setTimeout(() => {
    createColorElement(color).classList.remove('selected');
    checkOrder();
},250);


}

// retornar a cor
let createColorElement = (color) =>{
    if(color == 0) {
        return green;
    }else if(color == 1){
        return red;
    }else if(color == 2){
        return yellow;
    }else if(color == 3){
        return blue;
    }
}

//Próximos níveis
let nextLevel = () => {
    score++;
    shuffleOrder();
}

//Game over
let lose = () =>{
    alert(`Pontuação: ${score}!\nVocê perdeu!!!\nClique em OK para iniciar novamente`);
    order = [];
    clickedOrder = [];

    playGame();
}

//iniciar
let playGame = () =>{
    alert('Seja bem vindo ao Jogo da Memória! Iniciando novo game!');
    score = 0;

    nextLevel();
}
// click nas cores
green.onclick = () => click(0);
red.onclick = () => click(1);
yellow.onclick = () => click(2);
blue.onclick = () => click(3);

//inicio
playGame();