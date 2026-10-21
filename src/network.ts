export type DevCardType = 'Knight' | 'Victory Point' | 'Road Building' | 'Year of Plenty' | 'Monopoly';
export type ResourceKey = 'log' | 'brick' | 'sheep' | 'wheat' | 'stone';
export type PeerRole = 'host' | 'client' | null;

export interface BoardSeedPayload { seed: number; }
export interface GameReadyPayload { playerIndex: number; }
export interface SetupPlacementPayload {
  kind: 'settlement' | 'road';
  x?: number; y?: number;
  colorHex?: number; owner?: number;
  cx?: number; cy?: number; angle?: number;
}
export interface SetupDonePayload { playerIndex: number; }
export interface StartGamePayload { turnOrder: number[]; playerCount: number; }
export interface DrawDevCardPayload { owner: number; card: DevCardType; boughtOnTurn: number; }
export interface ResyncRequestPayload {}
export interface ResyncStatePayload {
  boardSeed: number;
  playerCount: number;
  players: any[];
  currentPlayerIndex: number;
  turnPhase: string;
  setupState: { phase: string; count: number };
  botSetupState: any;
  lastDice: { d1: number; d2: number; total: number };
  bankDevCards: number;
  devDeck: DevCardType[];
  myDevCards: any[];
  myTurnNumber: number;
  playedDevCardThisTurn: boolean;
  largestArmyOwner: number | null;
  longestRoadOwner: number | null;
  turnOrder: number[];
}

export type GameMessage =
  | { type: 'JOIN_ROOM'; payload: { roomId: string; senderId: string; seed?: number; peers?: string[] } }
  | { type: 'ROOM_JOINED'; payload: { roomId: string; peers: string[] } }
  | { type: 'PEER_JOINED'; payload: { peerId: string } }
  | { type: 'PEER_LEFT'; payload: { peerId: string } }
  | { type: 'GAME_MESSAGE'; payload: any }
  | { type: 'ROLL_DICE'; payload: { dice: { d1: number; d2: number; total: number }; rollerIndex: number } }
  | { type: 'BUILD_ROAD'; payload: { cx: number; cy: number; angle: number; colorHex: number; owner: number } }
  | { type: 'BUILD_SETTLEMENT'; payload: { x: number; y: number; colorHex: number; owner: number } }
  | { type: 'BUILD_CITY'; payload: { x: number; y: number; colorHex: number; owner: number } }
  | { type: 'BUY_DEV_CARD'; payload: { owner: number } }
  | { type: 'PLAY_DEV_CARD'; payload: { owner: number; card: DevCardType } }
  | { type: 'TRADE'; payload: { giverIndex: number; receiverIndex: number; giveResource: ResourceKey; receiveResource: ResourceKey; giveAmount: number; receiveAmount: number } }
  | { type: 'END_TURN'; payload: { from: number } }
  | { type: 'MOVE_ROBBER'; payload: { x: number; y: number } }
  | { type: 'STEAL'; payload: { fromIndex: number; toIndex: number; resource: ResourceKey } }
  | { type: 'DISCARD'; payload: { playerIndex: number; resources: Record<ResourceKey, number> } }
  | { type: 'RESET_ROBBER'; payload: { x: number; y: number } }
  | { type: 'SYNC_STATE'; payload: any }
  | { type: 'CHAT'; payload: { senderId: string; text: string } }
  | { type: 'BOARD_SEED'; payload: BoardSeedPayload }
  | { type: 'GAME_READY'; payload: GameReadyPayload }
  | { type: 'SETUP_PLACEMENT'; payload: SetupPlacementPayload }
  | { type: 'SETUP_DONE'; payload: SetupDonePayload }
  | { type: 'START_GAME'; payload: StartGamePayload }
  | { type: 'DRAW_DEV_CARD'; payload: DrawDevCardPayload }
  | { type: 'RESYNC_REQUEST'; payload: ResyncRequestPayload }
  | { type: 'RESYNC_STATE'; payload: ResyncStatePayload };

export class P2PNetwork {
  private ws: WebSocket | null = null;
  private localId: string;
  private role: PeerRole = null;
  private currentRoom: string | null = null;
  private readonly signalingUrl: string;

  private onMessageCb: ((msg: GameMessage) => void) | null = null;
  private onConnectCb: (() => void) | null = null;
  private onDisconnectCb: (() => void) | null = null;
  private onErrorCb: ((err: any) => void) | null = null;
  private onPeerJoinedCb: ((peerId: string) => void) | null = null;
  private onPeerLeftCb: ((peerId: string) => void) | null = null;

  /** Peer ids currently present in the room (excluding ourselves). */
  private peers: string[] = [];


  constructor(signalingUrl: string = 'ws://localhost:9000') {
    this.localId = crypto.randomUUID();
    this.signalingUrl = signalingUrl;
  }

  setCallbacks(cb: {
    onMessage?: (msg: GameMessage) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (err: any) => void;
    onPeerJoined?: (peerId: string) => void;
    onPeerLeft?: (peerId: string) => void;
  }) {
    this.onMessageCb = cb.onMessage ?? null;
    this.onConnectCb = cb.onConnect ?? null;
    this.onDisconnectCb = cb.onDisconnect ?? null;
    this.onErrorCb = cb.onError ?? null;
    this.onPeerJoinedCb = cb.onPeerJoined ?? null;
    this.onPeerLeftCb = cb.onPeerLeft ?? null;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => {
        this.onErrorCb?.(err);
        reject(err);
      };
      this.ws.onmessage = (event) => this.handleMessage(event.data);
      this.ws.onclose = () => {
        this.ws = null;
        this.onDisconnectCb?.();
      };
    });
  }

  private handleMessage(data: string) {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    const gameMsg = msg as GameMessage;

    switch (gameMsg.type) {
      case 'JOIN_ROOM':
        this.currentRoom = gameMsg.payload?.roomId ?? this.currentRoom;
        this.peers = Array.isArray(gameMsg.payload?.peers) ? gameMsg.payload.peers : [];
        this.onConnectCb?.();
        break;
      case 'GAME_MESSAGE':
        this.onMessageCb?.(gameMsg);
        break;
      case 'ROOM_JOINED':
        this.currentRoom = gameMsg.payload?.roomId ?? this.currentRoom;
        this.peers = Array.isArray(gameMsg.payload?.peers) ? gameMsg.payload.peers : [];
        this.onConnectCb?.();
        break;
      case 'PEER_JOINED':
        if (gameMsg.payload?.peerId && !this.peers.includes(gameMsg.payload.peerId)) {
          this.peers.push(gameMsg.payload.peerId);
          this.onPeerJoinedCb?.(gameMsg.payload.peerId);
        }
        break;
      case 'PEER_LEFT':
        if (this.peers.includes(gameMsg.payload?.peerId)) {
          this.peers = this.peers.filter(id => id !== gameMsg.payload.peerId);
          this.onPeerLeftCb?.(gameMsg.payload.peerId);
        }
        break;
      default:
        // Route all known game message types to the message callback so that
        // MainScene can handle them centrally in its handleNetworkMessage.
        this.onMessageCb?.(gameMsg);
        break;
    }
  }

  /** Gazdă sau client se alătură unei camere de joc. */
  async join(roomId: string, seed?: number): Promise<void> {
    this.role = 'host'; // both are equal in relay mode
    await this.connect();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomId,
        senderId: this.localId,
        seed
      }));
    }
  }

  /** Trimite un mesaj de joc către ceilalți jucători în cameră. */
  send(type: GameMessage['type'], payload: GameMessage['payload']): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not ready, cannot send', type);
      return;
    }
    this.ws.send(JSON.stringify({
      type: 'GAME_MESSAGE',
      roomId: this.currentRoom,
      senderId: this.localId,
      gameType: type,
      payload,
      timestamp: Date.now()
    }));
  }

  getId(): string { return this.localId; }
  getRole(): PeerRole { return this.role; }
  isConnected(): boolean { return this.ws?.readyState === WebSocket.OPEN; }
  getRoomId(): string | null { return this.currentRoom; }
  getPeers(): string[] { return [...this.peers]; }
  hasPeer(peerId: string): boolean { return this.peers.includes(peerId); }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  }


