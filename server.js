const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const STARTING_CHIPS = 3000;
const SMALL_BLIND = 25;
const BIG_BLIND = 50;

const players = [];
const clients = new Map();

let dealerIndex = -1;
let turnIndex = -1;
let phase = 'lobby';
let board = [];
let pot = 0;
let currentBet = 0;
let minRaise = BIG_BLIND;
let pending = new Set();
let notice = 'Rejoins la table pour commencer.';
let revealCards = false;
let lastWinner = null;

const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function nextIndex(index) {
  return (index + 1) % players.length;
}

function activePlayers() {
  return players.filter(player => !player.folded);
}

function playersThatCanAct() {
  return players
    .map((player, index) => (!player.folded && !player.allIn) ? index : -1)
    .filter(index => index >= 0);
}

function money(value) {
  return Math.floor(value || 0).toLocaleString('fr-FR');
}

function sendState() {
  for (const [socket, meta] of clients) {
    if (!meta.player || socket.readyState !== WebSocket.OPEN) continue;

    const selfId = meta.player.id;
    const payload = {
      type: 'state',
      selfId,
      phase,
      notice,
      board,
      pot,
      currentBet,
      minRaise,
      dealerId: dealerIndex >= 0 ? players[dealerIndex]?.id ?? null : null,
      turnId: turnIndex >= 0 ? players[turnIndex]?.id ?? null : null,
      players: players.map(player => ({
        id: player.id,
        name: player.name,
        chips: player.chips,
        streetBet: player.streetBet,
        folded: player.folded,
        allIn: player.allIn,
        cards: (player.id === selfId || revealCards) ? player.cards : null
      }))
    };

    socket.send(JSON.stringify(payload));
  }
}

function sendError(socket, message) {
  socket.send(JSON.stringify({ type: 'error', message }));
}

function makeDeck() {
  const deck = [];
  suits.forEach(suit => {
    ranks.forEach((rank, index) => {
      deck.push({ rank, suit, value: index + 2 });
    });
  });

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function postBlind(index, amount) {
  const player = players[index];
  const paid = Math.min(amount, player.chips);
  player.chips -= paid;
  player.streetBet += paid;
  pot += paid;
  if (player.chips <= 0) player.allIn = true;
}

function nextPendingIndex(fromIndex) {
  for (let offset = 1; offset <= players.length; offset++) {
    const candidate = (fromIndex + offset) % players.length;
    if (pending.has(candidate)) return candidate;
  }
  return -1;
}

function startHand() {
  if (players.length < 2) {
    phase = 'lobby';
    notice = 'Il faut au moins 2 joueurs pour démarrer une main.';
    sendState();
    return;
  }

  for (const player of players) {
    player.cards = [];
    player.streetBet = 0;
    player.folded = false;
    player.allIn = false;
    if (player.chips < BIG_BLIND) player.chips = STARTING_CHIPS;
  }

  dealerIndex = (dealerIndex + 1) % players.length;
  deck = makeDeck();
  board = [];
  pot = 0;
  currentBet = BIG_BLIND;
  minRaise = BIG_BLIND;
  revealCards = false;
  phase = 'preflop';
  lastWinner = null;

  players.forEach(player => {
    player.cards = [deck.pop(), deck.pop()];
  });

  const smallBlindIndex = nextIndex(dealerIndex);
  const bigBlindIndex = nextIndex(smallBlindIndex);

  postBlind(smallBlindIndex, SMALL_BLIND);
  postBlind(bigBlindIndex, BIG_BLIND);

  pending = new Set(playersThatCanAct());
  turnIndex = nextIndex(bigBlindIndex);
  notice = 'Préflop : à vous de jouer.';
  sendState();
}

function finishUncontested() {
  const winner = activePlayers()[0];
  if (!winner) return;

  winner.chips += pot;
  lastWinner = winner.name;
  pot = 0;
  turnIndex = -1;
  revealCards = true;
  phase = 'finished';
  notice = `${winner.name} remporte le pot sans opposition.`;
  sendState();
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const diff = (a.values[i] || 0) - (b.values[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function bestFive(cards) {
  let best = null;
  for (let a = 0; a < cards.length - 4; a++) {
    for (let b = a + 1; b < cards.length - 3; b++) {
      for (let c = b + 1; c < cards.length - 2; c++) {
        for (let d = c + 1; d < cards.length - 1; d++) {
          for (let e = d + 1; e < cards.length; e++) {
            const hand = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareHands(hand, best) > 0) best = hand;
          }
        }
      }
    }
  }
  return best;
}

function evaluateFive(cards) {
  const values = cards.map(card => card.value).sort((a, b) => b - a);
  const counts = {};
  values.forEach(value => {
    counts[value] = (counts[value] || 0) + 1;
  });

  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const flush = cards.every(card => card.suit === cards[0].suit);
  const unique = [...new Set(values)].sort((a, b) => b - a);
  let straight = 0;

  if (unique.length >= 5) {
    for (let i = 0; i <= unique.length - 5; i++) {
      const part = unique.slice(i, i + 5).sort((a, b) => a - b);
      if (part[0] + 4 === part[4]) {
        straight = part[4];
        break;
      }
    }
  }

  if (unique.includes(14) && unique.includes(5) && unique.includes(4) && unique.includes(3) && unique.includes(2)) {
    straight = 5;
  }

  if (flush && straight) return { rank: 8, values: [straight], name: 'quinte flush' };
  if (groups[0].count === 4) return { rank: 7, values: [groups[0].value, groups[1].value], name: 'carré' };
  if (groups[0].count === 3 && groups[1].count === 2) return { rank: 6, values: [groups[0].value, groups[1].value], name: 'full' };
  if (flush) return { rank: 5, values, name: 'couleur' };
  if (straight) return { rank: 4, values: [straight], name: 'quinte' };
  if (groups[0].count === 3) return { rank: 3, values: [groups[0].value, groups[1].value, groups[2].value], name: 'brelan' };
  if (groups[0].count === 2 && groups[1].count === 2) return { rank: 2, values: [groups[0].value, groups[1].value, groups[2].value], name: 'deux paires' };
  if (groups[0].count === 2) return { rank: 1, values: [groups[0].value, groups[1].value, groups[2].value], name: 'paire' };
  return { rank: 0, values, name: 'carte haute' };
}

function showdown() {
  const contenders = activePlayers();
  const ranked = contenders.map(player => ({
    player,
    hand: bestFive([...player.cards, ...board])
  }));

  ranked.sort((a, b) => compareHands(b.hand, a.hand));
  const winners = ranked.filter(item => compareHands(item.hand, ranked[0].hand) === 0);
  const share = Math.floor(pot / winners.length);
  let remainder = pot % winners.length;

  winners.forEach((item, index) => {
    const extra = index === 0 ? remainder : 0;
    item.player.chips += share + extra;
    lastWinner = item.player.name;
  });

  revealCards = true;
  pot = 0;
  turnIndex = -1;
  phase = 'finished';
  notice = `${winners.map(item => item.player.name).join(' et ')} gagne(nt) avec ${ranked[0].hand.name}.`;
  sendState();
}

function advanceStreet() {
  if (activePlayers().length <= 1) {
    finishUncontested();
    return;
  }

  if (phase === 'river') {
    showdown();
    return;
  }

  players.forEach(player => { player.streetBet = 0; });
  currentBet = 0;
  minRaise = BIG_BLIND;

  if (phase === 'preflop') {
    phase = 'flop';
    deck.pop();
    board.push(deck.pop(), deck.pop(), deck.pop());
  } else if (phase === 'flop') {
    phase = 'turn';
    deck.pop();
    board.push(deck.pop());
  } else if (phase === 'turn') {
    phase = 'river';
    deck.pop();
    board.push(deck.pop());
  }

  pending = new Set(playersThatCanAct());
  turnIndex = nextPendingIndex(dealerIndex);
  notice = `${phase.charAt(0).toUpperCase() + phase.slice(1)} distribué.`;
  sendState();
}

function finishAction(actorIndex) {
  if (activePlayers().length <= 1) {
    finishUncontested();
    return;
  }

  if (pending.size === 0) {
    advanceStreet();
    return;
  }

  turnIndex = nextPendingIndex(actorIndex);
  sendState();
}

function processAction(socket, message) {
  const meta = clients.get(socket);
  const player = meta?.player;
  if (!player) return;

  const index = players.findIndex(item => item.id === player.id);
  if (index < 0) return;
  if (phase === 'lobby' || phase === 'finished') return sendError(socket, 'Lancez une nouvelle main pour jouer.');
  if (turnIndex !== index) return sendError(socket, "Ce n'est pas votre tour.");

  const owing = Math.max(0, currentBet - player.streetBet);
  switch (message.action) {
    case 'fold':
      player.folded = true;
      pending.delete(index);
      notice = `${player.name} se couche.`;
      break;

    case 'check':
      if (owing > 0) return sendError(socket, 'Vous devez suivre ou vous coucher.');
      pending.delete(index);
      notice = `${player.name} check.`;
      break;

    case 'call':
      if (owing <= 0) return sendError(socket, 'Il n’y a rien à suivre.');
      if (owing > player.chips) return sendError(socket, 'Stack insuffisant.');
      player.chips -= owing;
      player.streetBet += owing;
      pot += owing;
      pending.delete(index);
      notice = `${player.name} suit ${money(owing)}.`;
      break;

    case 'raise': {
      const target = Number(message.amount);
      if (!Number.isFinite(target) || target <= currentBet) {
        return sendError(socket, `La relance doit être supérieure à ${currentBet}.`);
      }
      if (target > player.chips + player.streetBet) {
        return sendError(socket, 'Montant trop élevé pour votre stack.');
      }
      const increase = target - player.streetBet;
      if (increase < minRaise) {
        return sendError(socket, `Relance minimale : ${money(currentBet + minRaise)}.`);
      }
      player.chips -= increase;
      player.streetBet = target;
      pot += increase;
      currentBet = target;
      minRaise = increase;
      pending = new Set(playersThatCanAct().filter(i => i !== index));
      notice = `${player.name} relance à ${money(target)}.`;
      break;
    }

    default:
      return sendError(socket, 'Action inconnue.');
  }

  finishAction(index);
}

const publicDir = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(publicDir, pathname);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', socket => {
  clients.set(socket, { player: null });

  socket.on('message', raw => {
    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return sendError(socket, 'Message invalide.');
    }

    const meta = clients.get(socket);
    if (!meta) return;

    if (parsed.type === 'join') {
      if (meta.player) return sendError(socket, 'Tu es déjà à la table.');
      if (players.length >= MAX_PLAYERS) return sendError(socket, 'La table est pleine.');

      const name = String(parsed.name || '').trim().slice(0, 18);
      if (!name) return sendError(socket, 'Choisis un pseudonyme.');

      const player = {
        id: randomUUID(),
        name,
        chips: STARTING_CHIPS,
        cards: [],
        streetBet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        connected: true
      };

      players.push(player);
      meta.player = player;
      notice = `${player.name} a rejoint la table.`;
      sendState();
      return;
    }

    if (parsed.type === 'start') {
      startHand();
      return;
    }

    if (parsed.type === 'action') {
      processAction(socket, parsed);
    }
  });

  socket.on('close', () => {
    const meta = clients.get(socket);
    clients.delete(socket);

    if (!meta?.player) return;

    const index = players.findIndex(player => player.id === meta.player.id);
    if (index < 0) return;

    players.splice(index, 1);
    notice = `${meta.player.name} a quitté la table.`;
    if (players.length < 2) {
      phase = 'lobby';
      board = [];
      pot = 0;
      turnIndex = -1;
    }
    sendState();
  });
});

server.listen(PORT, () => {
  console.log(`Royal Flush local server: http://localhost:${PORT}`);
});
