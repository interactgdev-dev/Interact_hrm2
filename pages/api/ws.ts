// WebSocket server for real-time leave updates
import { WebSocket, WebSocketServer } from "ws";

type WsServer = InstanceType<typeof WebSocketServer>;

let wss: WsServer | null = null;

export default function handler(req: any, res: any) {
  if (!res.socket.server.wss) {
    wss = new WebSocketServer({ server: res.socket.server });
    res.socket.server.wss = wss;
    wss.on('connection', (ws: any) => {
      ws.on('message', (message: any) => {
        // Broadcast received message to all clients
        wss?.clients.forEach((client: any) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });
    });
  }
  res.end();
}

export const config = {
  api: {
    bodyParser: false,
  },
};
