const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios"); // Assuming axios is installed

// Initialize the WebSocket server
const io = new Server(3000, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const GAME_DURATION = 30000; // 30 seconds
let currentGame = null;
let gameSessions = {};
let playersMap = {}; // Store players globally by playerId
const 
LARAVEL_API_BASE_URL = "https://avmlite.com/api"; // Replace with your Laravel API base URL

// Function to broadcast the current player statuses to all clients
function broadcastPlayerStatuses() {
  const playerStatuses = Object.values(playersMap).map((player) => ({
    playerId: player.playerId,
    name: player.name,
    profile: player.profile,
  }));

  io.emit("player_status_updated", playerStatuses); // Broadcast the updated player statuses
  console.log("Broadcasted player statuses:", playerStatuses);
}

// Start a new game session only if there are players
async function startNewGame() {
  if (Object.keys(playersMap).length === 0) {
    console.log("No players in the room, game cannot start.");
    return; // Don't start the game if there are no players
  }

  // Generate a new game ID from the API
  try {
    const response = await axios.post(`${LARAVEL_API_BASE_URL}/create-game`, {
        "name": "Teen Patti",
        "description": "A thrilling card game."
    });
    console.log(response);
    const { game_id: gameId, status } = response.data;

    if (!gameId || status !== "success") {
      console.log("Failed to generate game ID.");
      return;
    }

    currentGame = {
      gameId,
      players: [], // This will be repopulated from playersMap
      bets: [],
      startTime: Date.now(),
      timer: null,
    };

    console.log(`Game ${gameId} started!`);

    // Repopulate currentGame.players from playersMap
    for (const playerId in playersMap) {
      currentGame.players.push(playersMap[playerId]);
    }

    currentGame.timer = setTimeout(() => {
      endGame();
    }, GAME_DURATION);

    return currentGame;
  } catch (error) {
    console.error("Error while creating game:", error.message);
  }
}

// End the game session
async function endGame() {
  if (!currentGame) return;

  const gameId = currentGame.gameId;
  const winners = determineWinners(currentGame); // Updated logic to find winners

  gameSessions[gameId] = { ...currentGame, winners, endTime: Date.now() };

  // Store the winners in the Laravel API
  try {
    const winnersResponse = await axios.post(`${LARAVEL_API_BASE_URL}/declare-winner`, {
      game_id: gameId, 
      winners: winners.map((winner) => ({
        user_id: winner.userId,
        amount: winner.amount,
      })),
    });
  
    console.log(`Winners for game ${gameId} stored successfully:`, winnersResponse.data);
  } catch (error) {
    console.error(`Failed to store winners for game ${gameId}:`, error.response?.data?.message || error.message);
  }

  // Notify all players about the game result
  io.emit("game_ended", {
    gameId,
    winners,
    placedBets: currentGame.bets,
  });

  console.log(
    `Game ${gameId} ended! Winners: ${JSON.stringify(winners, null, 2)}`
  );

  // Reset the game state
  currentGame.bets = [];
  currentGame = null;
  if (Object.keys(playersMap).length === 0) {
    console.log("No players in the room, game cannot start.");
    return; // Don't start the game if there are no players
  }
  io.emit("new_game_started", { message: "A new game is starting!" });
  
  // Wait 5 seconds before starting a new game
  setTimeout(async () => {
    
    // Start a new game
    await startNewGame(); 
    io.emit("game_joined", {
      gameId: currentGame.gameId,
      timeRemaining: GAME_DURATION, // Reset to full duration for the new game
      players: currentGame.players,
      bets: currentGame.bets,
    });
  }, 5000); // 5 seconds delay before starting the new game
}

function determineWinners(game) {
    if (game.bets.length === 0) return []; // No bets, no winners
  
    // Calculate the total bet amount for each pot
    const potTotals = game.bets.reduce(
      (totals, bet) => {
        if (!totals[bet.betPot]) totals[bet.betPot] = 0;
        totals[bet.betPot] += bet.amount;
        return totals;
      },
      { A: 0, B: 0, C: 0 } // Initialize totals for each pot
    );
  
    // Find the pot with the minimum total amount
    const minPot = Object.keys(potTotals).reduce((minPot, pot) => {
      if (potTotals[pot] < potTotals[minPot]) return pot;
      return minPot;
    }, "A"); // Start comparison with pot A
  
    console.log(`Minimum pot is ${minPot} with total: ${potTotals[minPot]}`);
  
    // Get all players who placed bets in the minimum pot
    const winners = game.bets
      .filter((bet) => bet.betPot === minPot)
      .map((bet) => ({
        userId: bet.playerId,
        userName: bet.name,
        userProfile: bet.profile,
        amount: bet.amount,
        betPot: bet.betPot,
      }));
  
    return winners;
  }
  

// WebSocket connection handling
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Listen for player joining the game
  socket.on("join_game", async ({ playerId, playerName, playerProfile }) => {
    // Ensure the game is started before a player can join
     // Store player info in the global players map
     playersMap[playerId] = { playerId, name: playerName, profile: playerProfile, socketId: socket.id };

    if (!currentGame) {
      await startNewGame(); // Check if there are players before starting the game
    }

    // If no active game exists and a player is joining, start a new game
    if (!currentGame) {
      return socket.emit("error", { message: "No game is active." });
    }

    // If the player is not already in the game, add them
    if (!currentGame.players.some((p) => p.playerId === playerId)) {
      currentGame.players.push({
        playerId,
        name: playerName, // Add player's name
        profile: playerProfile, // Add player's profile (e.g., avatar URL)
        bets: [],
      });
    }

    // Broadcast the updated player list to all clients
    broadcastPlayerStatuses();

    // Calculate time remaining
    const timeElapsed = Date.now() - currentGame.startTime;
    const timeRemaining = GAME_DURATION - timeElapsed;

    // Emit the game information to the player
    socket.emit("game_joined", {
      gameId: currentGame.gameId,
      timeRemaining: timeRemaining > 0 ? timeRemaining : GAME_DURATION, // Full duration if the game just started
      players: currentGame.players,
      bets: currentGame.bets,
    });

    console.log(`Player ${playerId} joined game ${currentGame.gameId}`);
  });

  socket.on("place_bet", ({ playerId, amount, betPot, image, tapPosition }) => {
    if (!currentGame) {
      socket.emit("error", { message: "No ongoing game." });
      return;
    }
  
    // Convert amount to a number before pushing to bets
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
      // Find the player using socket.id and remove them from the current game
      const playerId = Object.keys(playersMap).find(
        (id) => playersMap[id].socketId === socket.id
      );
  
      if (playerId && currentGame) {
        // Remove the player from the current game
        currentGame.players = currentGame.players.filter(
          (player) => player.playerId !== playerId
        );
  
        // Remove player from the global players map
        delete playersMap[playerId];
  
        // Broadcast the updated player list to all clients
        broadcastPlayerStatuses();
  }
  });
});

console.log("Server running on ws://localhost:3000");
