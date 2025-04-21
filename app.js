const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Use EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Parse POST data
app.use(express.urlencoded({ extended: true }));

// In-memory rooms
const rooms = {};

// Home route
app.get('/', (req, res) => {
  res.render('index', { rooms });
});

// Game room
app.get('/rooms/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms[roomId];
  if (!room) return res.redirect('/');
  res.render('room', { roomId });
});

app.post('/create-room', (req, res) => {
  const roomId = req.body.roomId.trim();

  if (!roomId || rooms[roomId]) {
    res.redirect('/');
  }

  rooms[roomId] = {
    players: [],
    grid: Array(36).fill(null),
    gameOver: false
  }

  io.emit('roomListUpdate', rooms);

  res.redirect(`/rooms/${roomId}`);
})

app.post('/delete-room', (req, res) => {
  const roomId = req.body.roomId?.trim();
  const room = rooms[roomId];

  if (!room) {
    res.redirect('/');
  }

  // Only allow delete if room has 0 players or game is over
  if (room.players.length === 0 || room.gameOver) {
    delete rooms[roomId];
    io.emit('roomListUpdate', rooms);
  }

  res.redirect('/');
})

const colors = ['red', 'green', 'blue'];

io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  socket.emit('roomListUpdate', rooms);

  socket.on('join-room', ({ roomId, playerName }) => {
    console.log(`joined room: ${roomId}`);
    const room = rooms[roomId];

    if (!room || room.players.length >= 3) return;

    const color = colors[room.players.length];

    const player = {
      id: socket.id,
      name: playerName,
      color: color,
    }

    socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.player = player;


    room.players.push(player);

    socket.emit('joined', {
      color,
      players: room.players
    })

    io.emit('roomListUpdate', rooms);

    io.to(roomId).emit('update-grid', {
      grid: room.grid,
    });
  });

  socket.on('claim-cell', ({ roomId, index, playerColor }) => {
    const room = rooms[roomId];

    console.log(`[claim-cell] room: ${roomId}, index: ${index}, color: ${playerColor}`);

    if (!room || room.grid[index] !== null || room.gameOver || !playerColor) {
      console.log(`[claim-cell] Invalid claim`);
      return;
    }

    room.grid[index] = playerColor;
    io.to(roomId).emit('update-grid', { grid: room.grid });

    // Check if game over
    if (!room.grid.includes(null)) {
      const score = {};
      room.players.forEach((player) => {
        score[player.name] = 0;
      });

      room.grid.forEach((color) => {
        const player = room.players.find((player) => player.color === color);
        if (player) {
          score[player.name]++;
        }
      });

      const winnerName = Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
      room.gameOver = true;
      io.to(roomId).emit('game-over', winnerName);
    }
  });


  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    const roomId = socket.data?.roomId;
    const player = socket.data?.player;

    if (!roomId || !player) return;

    const room = rooms[roomId];
    if (!room) return;

    // Remove players
    room.players = room.players.filter(p => p.id !== player.id);
    io.emit('roomListUpdate', rooms);
  })
})

// Start server
const PORT = 3004;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
