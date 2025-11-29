import { WebSocketServer, WebSocket } from 'ws';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export class WebSocketServerTransport implements Transport {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    constructor(port: number = 3001) {
        this.wss = new WebSocketServer({ port });

        this.wss.on('connection', (ws) => {
            console.error(`[WebSocket] Client connected (total: ${this.clients.size + 1})`);
            this.clients.add(ws);

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString()) as JSONRPCMessage;
                    this.onmessage?.(message);
                } catch (e) {
                    this.onerror?.(e as Error);
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.error(`[WebSocket] Client disconnected (total: ${this.clients.size})`);
            });

            ws.on('error', (error) => {
                this.onerror?.(error);
            });
        });

        this.wss.on('error', (error) => {
            this.onerror?.(error);
        });

        console.error(`[WebSocket] Server listening on port ${port}`);
    }

    async send(message: JSONRPCMessage): Promise<void> {
        const data = JSON.stringify(message);
        const promises: Promise<void>[] = [];

        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                promises.push(
                    new Promise((resolve, reject) => {
                        client.send(data, (error) => {
                            if (error) reject(error);
                            else resolve();
                        });
                    })
                );
            }
        }

        await Promise.all(promises);
    }

    async start(): Promise<void> {
        // Server starts in constructor
        return Promise.resolve();
    }

    async close(): Promise<void> {
        // Close all client connections
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();

        // Close the WebSocket server
        return new Promise((resolve, reject) => {
            this.wss.close((error) => {
                if (error) reject(error);
                else {
                    this.onclose?.();
                    resolve();
                }
            });
        });
    }

    // Broadcast to all connected clients (useful for notifications)
    broadcast(message: JSONRPCMessage): void {
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        }
    }
}
