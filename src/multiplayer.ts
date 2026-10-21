import Phaser from 'phaser';
import { P2PNetwork } from './network';
import { createRandomSeed } from './rng';

export class MultiplayerScene extends Phaser.Scene {
  private network!: P2PNetwork;
  private roomIdInput!: Phaser.GameObjects.DOMElement;
  private statusText!: Phaser.GameObjects.Text;
  private hostButton?: Phaser.GameObjects.Container;
  private joinButton?: Phaser.GameObjects.Container;
  private signalingUrlInput!: Phaser.GameObjects.DOMElement;
  private started = false;
  private username = 'Island Player';

  constructor() {
    super({ key: 'MultiplayerScene' });
  }

  create() {
    this.started = false;
    const sceneData = this.scene.settings.data as { username?: string } | undefined;
    if (sceneData?.username) {
      this.username = sceneData.username;
    }

    const width = this.scale.width;

    this.drawBackdrop();

    this.add.text(width / 2, 80, 'MULTIPLAYER P2P', {
      fontSize: '34px', color: '#f7e4bd', fontStyle: 'bold', letterSpacing: 4
    }).setOrigin(0.5);

    this.add.text(width / 2, 125, `Jucător: ${this.username}`, {
      fontSize: '16px', color: '#55ffaa', fontStyle: 'bold'
    }).setOrigin(0.5);

    this.add.text(width / 2, 175, 'Server de semnalizare', {
      fontSize: '14px', color: '#d7b98e'
    }).setOrigin(0.5);

    this.signalingUrlInput = this.add.dom(width / 2, 205, 'input', {
      type: 'text',
      value: 'ws://localhost:9000',
      style: 'width: 260px; padding: 8px; text-align: center; font-family: monospace;'
    });
    this.add.existing(this.signalingUrlInput);

    this.add.text(width / 2, 255, 'ID Cameră', {
      fontSize: '14px', color: '#d7b98e'
    }).setOrigin(0.5);

    this.roomIdInput = this.add.dom(width / 2, 285, 'input', {
      type: 'text',
      value: 'catan-room-' + Math.floor(Math.random() * 10000),
      style: 'width: 260px; padding: 8px; text-align: center; font-family: monospace;'
    });
    this.add.existing(this.roomIdInput);

    this.statusText = this.add.text(width / 2, 335, '', {
      fontSize: '15px', color: '#ffaa55', fontStyle: 'bold'
    }).setOrigin(0.5);

    this.hostButton = this.createButton(width / 2 - 140, 385, 240, 50, 'GAZDĂ (HOST)', 0x2d6a5a, () => this.startHost());
    this.joinButton = this.createButton(width / 2 + 140, 385, 240, 50, 'ALĂTURĂ-TE (JOIN)', 0x426b82, () => this.startJoin());

    this.createButton(width / 2, 465, 200, 46, 'ÎNAPOI', 0x7a4d35, () => {
      this.scene.start('MainMenuScene');
    });
  }

  private drawBackdrop() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x10202b, 0x10202b, 0x274a59, 0x0b141b, 1);
    bg.fillRect(0, 0, this.scale.width, this.scale.height);
  }

  private createButton(x: number, y: number, w: number, h: number, label: string, color: number, action: () => void) {
    const button = this.add.container(x, y);
    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(2, 0xf7e4bd, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    button.add(bg);
    button.add(this.add.text(0, 0, label, { fontSize: '16px', color: '#fff8e7', fontStyle: 'bold' }).setOrigin(0.5));
    bg.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    bg.on('pointerover', () => bg.setAlpha(0.8));
    bg.on('pointerout', () => bg.setAlpha(1));
    bg.on('pointerdown', action);
    return button;
  }

  private setStatus(msg: string, color: string = '#ffaa55') {
    this.statusText.setText(msg);
    this.statusText.setColor(color);
  }

  private async startHost() {
    const signalingUrl = (this.signalingUrlInput.node as HTMLInputElement).value.trim();
    const roomId = (this.roomIdInput.node as HTMLInputElement).value.trim();
    if (!roomId) {
      this.setStatus('Introdu un ID de cameră.');
      return;
    }

    const hostSeed = createRandomSeed();
    this.setStatus('Așteptare adversar...');
    this.hostButton!.setVisible(false);
    this.joinButton!.setVisible(false);

    this.network = new P2PNetwork(signalingUrl);
    this.network.setCallbacks({
      onConnect: () => {
        this.setStatus(`Conectat! Așteptare adversar în [${roomId}]...`, '#55ffaa');
      },
      onPeerJoined: (_peerId) => {
        if (this.started) return;
        this.setStatus('Adversar conectat! Se încarcă jocul...', '#55ffaa');
        this.started = true;
        this.time.delayedCall(600, () => {
          this.scene.start('MainScene', {
            players: [
              { name: this.username, colorStr: '#66aaff', colorHex: 0x4488ff, isBot: false },
              { name: 'Adversar', colorStr: '#ff6666', colorHex: 0xff4444, isBot: false }
            ],
            network: this.network,
            myPeerId: this.network.getId(),
            isHost: true,
            roomId,
            seed: hostSeed
          });
        });
      },
      onDisconnect: () => {
        this.setStatus('Deconectat de la server.', '#ff5555');
      },
      onError: () => {
        this.setStatus('Nu mă pot conecta la ws://localhost:9000. Ai pornit serverul?', '#ff5555');
        this.hostButton!.setVisible(true);
        this.joinButton!.setVisible(true);
      }
    });

    try {
      await this.network.join(roomId, hostSeed);
    } catch (e: any) {
      this.setStatus('Eroare conexiune la serverul WebSocket.', '#ff5555');
      this.hostButton!.setVisible(true);
      this.joinButton!.setVisible(true);
    }
  }

  private async startJoin() {
    const signalingUrl = (this.signalingUrlInput.node as HTMLInputElement).value.trim();
    const roomId = (this.roomIdInput.node as HTMLInputElement).value.trim();
    if (!roomId) {
      this.setStatus('Introdu un ID de cameră.');
      return;
    }

    this.setStatus('Conectare la gazdă...');
    this.hostButton!.setVisible(false);
    this.joinButton!.setVisible(false);

    let receivedSeed: number | undefined;

    this.network = new P2PNetwork(signalingUrl);
    this.network.setCallbacks({
      onMessage: (msg: any) => {
        if (msg.type === 'BOARD_SEED' && typeof msg.payload?.seed === 'number') {
          receivedSeed = msg.payload.seed;
        }
      },
      onConnect: () => {
        this.setStatus('Conectat! Se încarcă jocul...', '#55ffaa');
        this.started = true;
        this.time.delayedCall(600, () => {
          this.scene.start('MainScene', {
            players: [
              { name: 'Gazdă', colorStr: '#66aaff', colorHex: 0x4488ff, isBot: false },
              { name: this.username, colorStr: '#ff6666', colorHex: 0xff4444, isBot: false }
            ],
            network: this.network,
            myPeerId: this.network.getId(),
            isHost: false,
            roomId,
            seed: receivedSeed
          });
        });
      },
      onDisconnect: () => {
        this.setStatus('Gazdă deconectată.', '#ff5555');
      },
      onError: () => {
        this.setStatus('Nu mă pot conecta la ws://localhost:9000. Ai pornit serverul?', '#ff5555');
        this.hostButton!.setVisible(true);
        this.joinButton!.setVisible(true);
      }
    });

    try {
      await this.network.join(roomId);
    } catch (e: any) {
      this.setStatus('Eroare alăturare la cameră.', '#ff5555');
      this.hostButton!.setVisible(true);
      this.joinButton!.setVisible(true);
    }
  }
}