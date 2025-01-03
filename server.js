const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios"); // Assuming axios is installed

// Initialize the WebSocket server
const io = new Server(4500, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const GAME_DURATION = 30000; // 30 seconds
let currentGame = null;
let gameCreationInProgress = false;  // <-- Prevent multiple concurrent game creations
let gameSessions = {};
let playersMap = {}; // Store players globally by playerId

const LARAVEL_API_BASE_URL = "https://avmlite.com/api"; // Replace with your Laravel API base URL
const suits = ["hearts", "diamonds", "clubs", "spades"];
const values = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "jack",
  "queen",
  "king",
  "ace",
];
const betValues = ["50", "200", "500", "1000", "5000"];
const betImages = [
  "assets/gems_1.png",
  "assets/gems_2.png",
  "assets/gems_3.png",
  "assets/gems_4.png",
  "assets/gems_5.png",
];
const betPots = ["A", "B", "C"]; // Randomly pick from these pots

// Function to generate a fake bet
function generateFakeBet() {
  const betValueIndex = Math.floor(Math.random() * betValues.length);
  const betPot = betPots[Math.floor(Math.random() * betPots.length)];
  const betAmount = betValues[betValueIndex];
  const betImage = betImages[betValueIndex];
  console.log(`Generating fake bet: ${betAmount} on pot ${betPot}`);
  // Return the fake bet with playerId: 1 (hard-coded)
  return {
    playerId: 1,
    amount: parseFloat(betAmount),
    betPot: betPot,
    image: betImage,
  };
}

// Function to generate a deck of 52 cards
function generateDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ value, suit });
    }
  }
  return deck;
}

// Shuffle the deck
function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]; // Swap elements
  }
  return deck;
}

// Function to generate a winning hand (e.g., a flush)
function generateWinningHand() {
  const handType = Math.random() > 0.5 ? "three_of_a_kind" : "sequence"; 
  if (handType === "three_of_a_kind") {
    // Generate three of a kind with different suits
    const value = values[Math.floor(Math.random() * values.length)];
    const shuffledSuits = shuffleDeck(suits.slice()); // Shuffle suits for randomness
    return [
      { value, suit: shuffledSuits[0] },
      { value, suit: shuffledSuits[1] },
      { value, suit: shuffledSuits[2] },
    ];
  } else {
    // Generate a sequence (straight) with different suits
    const startIndex = Math.floor(Math.random() * (values.length - 2));
    const sequence = values.slice(startIndex, startIndex + 3);
    const shuffledSuits = shuffleDeck(suits.slice()); 
    return sequence.map((value, index) => ({
      value,
      suit: shuffledSuits[index % suits.length],
    }));
  }
}

// Function to generate a losing hand (just random cards)
function generateLosingHand() {
  const deck = generateDeck();
  const shuffledDeck = shuffleDeck(deck);
  return shuffledDeck.slice(0, 3); // Pick first 3 cards
}

function generateRandomFakePlayers(count) {
  const fakePlayerNames = [
    "Sunil",
    "Akshay",
    "Sonal",
    "Beast",
    "Jay",
    "Deepak",
    "Sumit",
    "Neha",
    "Anmol",
    "Ashok",
  ];
  const fakeProfiles = ["https://avmlite.com/images/profile.png"];

  const fakePlayers = [];
  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * fakePlayerNames.length);
    fakePlayers.push({
      playerId: `fake_${uuidv4()}`,
      name: fakePlayerNames[randomIndex],
      profile: fakeProfiles[0],
    });
  }
  return fakePlayers;
}

// Function to broadcast the current player statuses to all clients
function broadcastPlayerStatuses() {
  const playerStatuses = Object.values(playersMap).map((player) => ({
    playerId: player.playerId,
    name: player.name,
    profile: player.profile,
  }));

  io.emit("player_status_updated", playerStatuses); 
  console.log("Broadcasted player statuses:", playerStatuses);
}

/**
 * START A NEW GAME
 * - Checks if no players exist, do nothing
 * - Creates game in Laravel
 * - Sets up timers & fake bets
 * - Uses a concurrency flag (gameCreationInProgress) to avoid race conditions
 */
async function startNewGame() {
  // Prevent multiple concurrent calls
  if (gameCreationInProgress) {
    console.log("startNewGame() called but creation is already in progress.");
    return;
  }
  gameCreationInProgress = true;

  try {
    // If no players in the room, don't start
    if (Object.keys(playersMap).length === 0) {
      console.log("No players in the room, game cannot start.");
      return;
    }

    // Generate a new game ID from the API
    const response = await axios.post(`${LARAVEL_API_BASE_URL}/create-game`, {
      name: "Teen Patti",
      description: "A thrilling card game.",
    });
    const { game_id: gameId, status } = response.data;

    if (!gameId || status !== "success") {
      console.log("Failed to generate game ID from the API.");
      return;
    }

    currentGame = {
      gameId,
      fakeplayers: [],
      players: [],
      bets: [],
      fakeBet: [],
      startTime: Date.now(),
      timer: null,
    };

    // Repopulate currentGame.players from playersMap
    for (const playerId in playersMap) {
      currentGame.players.push(playersMap[playerId]);
    }

    //const count = Math.floor(Math.random() * 6) + 5;
    //currentGame.fakeplayers = generateRandomFakePlayers(count);

    console.log(`Game ${gameId} started!`);

    // Start the game timer
    currentGame.timer = setTimeout(() => {
      endGame();
    }, GAME_DURATION);

    // // Start generating fake bets every 1.5s, stop 5s before end
    // const fakeBetInterval = setInterval(() => {
    //   if (Date.now() >= currentGame.startTime + GAME_DURATION - 5000) {
    //     clearInterval(fakeBetInterval);
    //   } else {
    //     const fakeBet = generateFakeBet();
    //     currentGame.fakeBet.push({
    //       playerId: fakeBet.playerId,
    //       amount: fakeBet.amount,
    //       betPot: fakeBet.betPot,
    //       image: fakeBet.image,
    //     });
    //     io.emit("fake_bets", {
    //       playerId: fakeBet.playerId,
    //       amount: fakeBet.amount,
    //       betPot: fakeBet.betPot,
    //       image: fakeBet.image,
    //       gameId: currentGame.gameId,
    //     });
    //     console.log(`Fake bet placed: ${fakeBet.amount} on ${fakeBet.betPot}`);
    //   }
    // }, 1500);

    return currentGame;
  } catch (error) {
    console.error("Error while creating game:", error.message);
  } finally {
    // Always reset the flag
    gameCreationInProgress = false;
  }
}

/**
 * END THE CURRENT GAME
 * - Determine winners
 * - Store winners via Laravel API
 * - Emit "game_ended"
 * - Wait 10s before starting a new game (if players exist)
 */
async function endGame() {
  if (!currentGame) return;

  const gameId = currentGame.gameId;
  const { winners, winningPot } = await determineWinners(currentGame);

  // Keep a record of this game
  gameSessions[gameId] = {
    ...currentGame,
    winners,
    endTime: Date.now(),
  };

  // Store the winners in the Laravel API
  try {
    const winnersResponse = await axios.post(
      `${LARAVEL_API_BASE_URL}/declare-winner`,
      {
        game_id: gameId,
        winners: winners.map((winner) => ({
          user_id: winner.userId,
          amount: winner.amount,
          pot:winningPot,
        })),
      }
    );
    console.log(
      `Winners for game ${gameId} stored successfully:`,
      winnersResponse.data
    );
  } catch (error) {
    console.error(
      `Failed to store winners for game ${gameId}:`,
      error.response?.data?.message || error.message
    );
  }

  // Generate hands for the final display
  const winningHand = generateWinningHand().map(
    (card) => `${card.value}_of_${card.suit}.png`
  );
  const losingHand1 = generateLosingHand().map(
    (card) => `${card.value}_of_${card.suit}.png`
  );
  const losingHand2 = generateLosingHand().map(
    (card) => `${card.value}_of_${card.suit}.png`
  );

  // Notify all players about the game result
  io.emit("game_ended", {
    gameId,
    winners,
    placedBets: currentGame.bets ?? [],
    winningPot,
    winningHand,
    losingHand1,
    losingHand2,
  });

  console.log(`Game ${gameId} ended! Winners: ${JSON.stringify(winners)}`);


  currentGame = null;

  // If no players remain, do not schedule a new game
  if (Object.keys(playersMap).length === 0) {
    console.log("No players in the room, won't schedule new game.");
    return;
  }

  // Let clients know a new game is about to start in 10s
  io.emit("new_game_started", {
    message: "A new game is starting in 5s!",
  });

  // Schedule the next game creation
  setTimeout(async () => {
    // Only start a new game if not already running or being created
    if (!currentGame && !gameCreationInProgress) {
      await startNewGame();
      if (currentGame) {
        io.emit("game_joined", {
          gameId: currentGame.gameId,
          timeRemaining: GAME_DURATION,
          players: currentGame.players,
          bets: currentGame.bets,
          fakeplayers: currentGame.fakeplayers,
          fakeBet: currentGame.fakeBet,
        });
      }
    } else {
      console.log(
        "A game is already running or being created, skipping new game start."
      );
    }
  }, 5000);
}

/**
 * DETERMINE WINNERS
 * - If no bets, pick a random pot & no winners
 * - Otherwise, find pot with the MINIMUM total bet (that pot is winner)
 */
async function determineWinners(game) {
  if (!game.bets || game.bets.length === 0) {
    console.log("No bets placed, returning random pot.");

    // Choose a random pot ("A", "B", or "C")
    const randomPot = ["A", "B", "C"][
      Math.floor(Math.random() * 3)
    ];
    console.log("Random pot:", randomPot);
    return { winners: [], winningPot: randomPot };
  }

  // Calculate the total bet amount for each pot
//   const potTotals = game.bets.reduce(
//     (totals, bet) => {
//       if (!totals[bet.betPot]) totals[bet.betPot] = 0;
//       totals[bet.betPot] += bet.amount;
//       return totals;
//     },
//     { A: 0, B: 0, C: 0 }
//   );

//   // Find the pot with the minimum total amount
//   const minPot = Object.keys(potTotals).reduce((minPot, pot) => {
//     if (potTotals[pot] < potTotals[minPot]) return pot;
//     return minPot;
//   }, "A");

let minPot;

  // Try fetching the winning pot from the API
  try {
    const response = await axios.get(`${LARAVEL_API_BASE_URL}/winning-pot`);
    const { data: apiWinningPot, success } = response.data;

    if (success && ["A", "B", "C"].includes(apiWinningPot)) {
      minPot = apiWinningPot;
      console.log(`API returned winning pot: ${minPot}`);
    } else {
      console.log("Invalid response from API. Falling back to random pot.");
    }
  } catch (error) {
    console.error("Error fetching winning pot from API:", error);
  }

  // If API fails or is invalid, fallback to a random pot
  if (!minPot) {
    minPot = ["A", "B", "C"][
      Math.floor(Math.random() * 3)
    ];
    console.log("Fallback to random pot:", minPot);
  }

  // Get all players who placed bets in the minimum pot
  const winners = game.bets
    .filter((bet) => bet.betPot === minPot)
    .map((bet) => ({
      userId: bet.playerId,
      userName: playersMap[bet.playerId]?.name,
      userProfile: playersMap[bet.playerId]?.profile,
      amount: bet.amount,
      betPot: bet.betPot,
    }));

  return { winners, winningPot: minPot };
}

// WebSocket connection handling
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Listen for player joining the game
  socket.on("join_game", async ({ playerId, playerName, playerProfile }) => {
    // Store player info in the global players map
    if(playerId !== 519){
      playersMap[playerId] = {
        playerId,
        name: playerName,
        profile: playerProfile,
        socketId: socket.id,
      };
    }
  

    // If no active game, attempt to start one (once)
    if (!currentGame) {
      await startNewGame();
    }

    // If there's still no currentGame, warn the player
    if (!currentGame) {
      return socket.emit("error", { message: "No game is active." });
    }

    // If the player isn't already in the currentGame, add them
    if (!currentGame.players.some((p) => p.playerId === playerId) || playerId !== 519) {
      currentGame.players.push({
        playerId,
        name: playerName,
        profile: playerProfile,
        bets: [],
      });
    }

    // Broadcast the updated player list to all clients
    broadcastPlayerStatuses();

    // Calculate time remaining
    const timeElapsed = Date.now() - currentGame.startTime;
    const timeRemaining = GAME_DURATION - timeElapsed;

    // Emit the game information to the joining player
    socket.emit("game_joined", {
      gameId: currentGame.gameId,
      timeRemaining: timeRemaining > 0 ? timeRemaining : GAME_DURATION,
      players: currentGame.players,
      bets: currentGame.bets,
      fakeBet: currentGame.fakeBet,
      fakeplayers: currentGame.fakeplayers,
    });

    console.log(`Player ${playerId} joined game ${currentGame.gameId}`);
  });

  // Handle bets
  socket.on("place_bet", ({ playerId, amount, betPot, image }) => {
    if (!currentGame) {
      socket.emit("error", { message: "No ongoing game." });
      return;
    }

    const betAmount = parseFloat(amount);
    if (isNaN(betAmount)) {
      socket.emit("error", { message: "Invalid bet amount." });
      return;
    }

    currentGame.bets.push({ playerId, amount: betAmount, betPot, image });

    io.emit("bet_placed", {
      playerId,
      amount: betAmount,
      betPot,
      image,
      gameId: currentGame.gameId,
    });

    console.log(`Player ${playerId} placed a bet: ${betAmount} on ${betPot}`);
  });

  // Handle player disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);

    // Remove the player from the current game and global players map
    const playerId = Object.keys(playersMap).find(
      (id) => playersMap[id].socketId === socket.id
    );

    if (playerId) {
      // Remove from currentGame if it exists
      if (currentGame) {
        currentGame.players = currentGame.players.filter(
          (player) => player.playerId !== playerId
        );
      }
      // Remove from the global map
      delete playersMap[playerId];

      // Broadcast updated status
      broadcastPlayerStatuses();
    }
  });
});

console.log("Server running on ws://localhost:4500");
