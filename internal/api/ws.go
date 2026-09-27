package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"lxddash/internal/handlers"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

// wsHub broadcasts the live overview payload to all connected clients
// every 2 seconds.
type wsHub struct {
	mu      sync.Mutex
	clients map[*wsClient]bool
	h       *handlers.Handlers
}

func newWSHub(h *handlers.Handlers) *wsHub {
	hub := &wsHub{clients: make(map[*wsClient]bool), h: h}
	go hub.run()
	return hub
}

func (hub *wsHub) run() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		hub.broadcast()
	}
}

func (hub *wsHub) broadcast() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	data, err := hub.h.OverviewData(ctx)
	if err != nil {
		return
	}
	payload, err := json.Marshal(map[string]any{"type": "overview", "data": data})
	if err != nil {
		return
	}
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for c := range hub.clients {
		select {
		case c.send <- payload:
		default:
		}
	}
}

func (hub *wsHub) handle(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &wsClient{conn: conn, send: make(chan []byte, 8)}
	hub.mu.Lock()
	hub.clients[c] = true
	hub.mu.Unlock()

	go c.writePump()
	c.readPump(hub)
}

func (c *wsClient) readPump(hub *wsHub) {
	defer func() {
		hub.mu.Lock()
		delete(hub.clients, c)
		hub.mu.Unlock()
		_ = c.conn.Close()
	}()
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *wsClient) writePump() {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}