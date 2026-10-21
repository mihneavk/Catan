import Phaser from 'phaser';
import { MultiplayerScene } from './multiplayer';
import { P2PNetwork } from './network';
import { SeededRandom, createRandomSeed } from './rng';

// --- GAME STATE LOGIC ---
interface PlayerData {
    id: number;
    name: string;
    colorStr: string;
    colorHex: number;
    points: number;
    hiddenVictoryPoints: number;
    playedKnights: number;
    resources: { log: number, brick: number, sheep: number, wheat: number, stone: number };
    devCards: number;
    botDevCards: DevCardType[];
    isBot: boolean;
}
type DevCardType = 'Knight' | 'Victory Point' | 'Road Building' | 'Year of Plenty' | 'Monopoly';
type ResourceKey = keyof PlayerData['resources'];
type TradeTarget = 'BANK' | 'ALL' | 'RED BOT' | 'GREEN BOT' | 'ORANGE BOT';
interface DevCardInHand {
    type: DevCardType;
    boughtOnTurn: number;
}

interface GameState {
    players: PlayerData[];
    currentPlayerIndex: number;
    turnPhase: 'SETUP' | 'ROLL' | 'TRADE_BUILD' | 'MOVE_ROBBER' | 'DISCARD';
    setupState: { phase: 'SETTLEMENT' | 'ROAD' | 'DONE', count: number };
    botSetupState: { phase: 'SETTLEMENT' | 'ROAD' | 'DONE', botIndex: number, round: number };
    lastDice: { d1: number, d2: number, total: number };
    bankDevCards: number; 
    devDeck: DevCardType[];
    myDevCards: DevCardInHand[];
    myTurnNumber: number;
    playedDevCardThisTurn: boolean;
    largestArmyOwner: number | null;
    longestRoadOwner: number | null;
    turnOrder: number[];
}

interface Intersection {
    x: number;
    y: number;
    owner: number | null;
    type: 'SETTLEMENT' | 'CITY' | null;
    buildingSprite?: Phaser.GameObjects.GameObject;
    colorHex?: number;
}
interface Edge { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number; angle: number; owner: number | null; }
interface HexData { x: number; y: number; resource: string | null; numberToken: number | null; hasRobber: boolean; }
interface PortData {
    q: number;
    r: number;
    tq: number;
    tr: number;
    ratio: '2:1' | '3:1';
    icon: 'question' | ResourceKey;
}
interface PortAccess {
    ratio: number;
    resource: ResourceKey | null;
    intersectionIndices: [number, number];
}

interface LobbyPlayer {
    name: string;
    colorStr: string;
    colorHex: number;
    isBot: boolean;
}

class MainMenuScene extends Phaser.Scene {
    private rulesPanel!: Phaser.GameObjects.Container;
    private usernameInput!: Phaser.GameObjects.DOMElement;
    private readonly genericNames = ['Captain Cedar', 'Harbor Fox', 'Maple Scout', 'Island Sage', 'Trade Wind', 'Oak Builder'];

    constructor() {
        super({ key: 'MainMenuScene' });
    }

    create() {
        this.drawBackdrop();
        this.add.text(this.scale.width / 2, this.scale.height * 0.18, 'THE ISLAND AWAITS', {
            fontSize: '16px', color: '#d9b36c', fontStyle: 'bold', letterSpacing: 4
        }).setOrigin(0.5);
        this.add.text(this.scale.width / 2, this.scale.height * 0.31, 'CATAN', {
            fontSize: this.scale.width < 500 ? '64px' : '92px', color: '#f7e4bd', fontStyle: 'bold',
            stroke: '#243447', strokeThickness: 5
        }).setOrigin(0.5);
        this.add.text(this.scale.width / 2, this.scale.height * 0.42, 'Build. Trade. Conquer.', {
            fontSize: '22px', color: '#d7b98e', fontStyle: 'italic'
        }).setOrigin(0.5);
        this.add.text(this.scale.width / 2, this.scale.height * 0.51, 'A strategic island game', {
            fontSize: '14px', color: '#b9c5c9'
        }).setOrigin(0.5);
        this.add.text(this.scale.width / 2, this.scale.height * 0.55, 'CHOOSE YOUR USERNAME', {
            fontSize: '12px', color: '#d9b36c', fontStyle: 'bold', letterSpacing: 2
        }).setOrigin(0.5);
        this.usernameInput = this.add.dom(this.scale.width / 2, this.scale.height * 0.595, 'input',
            'width: 250px; height: 34px; padding: 0 12px; border: 2px solid #d9b36c; border-radius: 6px; background: #f7e4bd; color: #243447; font: bold 16px Georgia; text-align: center; outline: none;', '');
        this.usernameInput.node.setAttribute('placeholder', 'Your island name');

        this.createButton(this.scale.width / 2, this.scale.height * 0.70, 260, 58, 'PLAY GAME', 0x2d6a5a, () => {
            const username = (this.usernameInput.node as HTMLInputElement).value.trim() || this.genericNames[Phaser.Math.Between(0, this.genericNames.length - 1)];
            this.scene.start('GameSelectionScene', { username });
        });
        this.createButton(this.scale.width / 2, this.scale.height * 0.78, 260, 48, 'MULTIPLAYER P2P', 0x426b82, () => {
        const username = (this.usernameInput.node as HTMLInputElement).value.trim() || this.genericNames[Phaser.Math.Between(0, this.genericNames.length - 1)];
        this.scene.start('MultiplayerScene', { username });
        });
        this.createButton(this.scale.width / 2, this.scale.height * 0.86, 260, 48, 'HOW TO PLAY', 0x7a4d35, () => {
            this.showRules();
        });
        this.add.text(this.scale.width / 2, this.scale.height * 0.95, 'VERSION 1.0  |  LOCAL + P2P', {
            fontSize: '12px', color: '#78909c', letterSpacing: 2
        }).setOrigin(0.5);
    }

    private drawBackdrop() {
        const width = this.scale.width;
        const height = this.scale.height;
        const background = this.add.graphics();
        background.fillGradientStyle(0x10202b, 0x10202b, 0x274a59, 0x0b141b, 1);
        background.fillRect(0, 0, width, height);
        background.fillStyle(0xd9b36c, 0.08);
        background.fillCircle(width / 2, height * 0.25, Math.min(width, height) * 0.45);
    }

    private createButton(x: number, y: number, width: number, height: number, label: string, color: number, action: () => void) {
        const button = this.add.container(x, y);
        const background = this.add.graphics();
        background.fillStyle(color, 1);
        background.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
        background.lineStyle(2, 0xf7e4bd, 0.8);
        background.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
        button.add(background);
        button.add(this.add.text(0, 0, label, { fontSize: '17px', color: '#fff8e7', fontStyle: 'bold' }).setOrigin(0.5));
        background.setInteractive(new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height), Phaser.Geom.Rectangle.Contains);
        background.on('pointerover', () => background.setAlpha(0.8));
        background.on('pointerout', () => background.setAlpha(1));
        background.on('pointerdown', action);
        return button;
    }

    private showRules() {
        if (this.rulesPanel) this.rulesPanel.destroy();
        const width = this.scale.width;
        const height = this.scale.height;
        this.rulesPanel = this.add.container(0, 0).setDepth(10);
        this.rulesPanel.add(this.add.rectangle(width / 2, height / 2, width, height, 0x08131c, 0.88).setInteractive());
        this.rulesPanel.add(this.add.text(width / 2, height * 0.16, 'HOW TO PLAY', { fontSize: '32px', color: '#f7e4bd', fontStyle: 'bold' }).setOrigin(0.5));
        const rules = '1. Roll the dice to collect resources.\n\n2. Trade with players or the bank.\n\n3. Build roads, settlements and cities.\n\n4. Use development cards wisely.\n\n5. Reach 10 victory points first.';
        this.rulesPanel.add(this.add.text(width / 2, height * 0.43, rules, { fontSize: '19px', color: '#d7b98e', align: 'left', wordWrap: { width: Math.min(500, width - 70) } }).setOrigin(0.5));
        this.rulesPanel.add(this.createButton(width / 2, height * 0.78, 180, 48, 'BACK', 0x7a4d35, () => this.rulesPanel.destroy()));
    }
}

class GameSelectionScene extends Phaser.Scene {
    private players: LobbyPlayer[] = [];
    private playerList!: Phaser.GameObjects.Container;
    private statusText!: Phaser.GameObjects.Text;
    private panelWidth = 640;
    private startButton?: Phaser.GameObjects.Container;
    private colorPickerUI?: Phaser.GameObjects.Container;
    private readonly colors = [
        { colorStr: '#66aaff', colorHex: 0x4488ff },
        { colorStr: '#ff6666', colorHex: 0xff4444 },
        { colorStr: '#66ff66', colorHex: 0x44ff44 },
        { colorStr: '#ffcc66', colorHex: 0xffa500 },
        { colorStr: '#ff80ab', colorHex: 0xff4081 },
        { colorStr: '#c084fc', colorHex: 0x9333ea },
        { colorStr: '#ffe066', colorHex: 0xffc107 },
        { colorStr: '#4dd0e1', colorHex: 0x00acc1 },
        { colorStr: '#ff9f68', colorHex: 0xf4511e },
        { colorStr: '#b8e986', colorHex: 0x7cb342 }
    ];

    constructor() {
        super({ key: 'GameSelectionScene' });
    }

    create() {
        const sceneData = this.scene.settings.data as { username?: string; players?: LobbyPlayer[] } | undefined;
        const savedPlayers = sceneData?.players || this.registry.get('returnLobbyPlayers') as LobbyPlayer[] | undefined;
        const username = sceneData?.username || savedPlayers?.[0]?.name || 'Island Player';
        this.players = savedPlayers?.length
            ? savedPlayers.map(player => ({ ...player, colorStr: player.isBot ? '#9aa3a8' : player.colorStr, colorHex: player.isBot ? 0x8d989e : player.colorHex }))
            : [{ name: username, colorStr: '#66aaff', colorHex: 0x4488ff, isBot: false }];
        this.drawBackdrop();
        const width = this.scale.width;
        const height = this.scale.height;
        this.add.text(width / 2, 55, 'GAME LOBBY', { fontSize: '32px', color: '#f7e4bd', fontStyle: 'bold' }).setOrigin(0.5);
        this.add.text(width / 2, 91, 'Choose who joins your island', { fontSize: '16px', color: '#b9c5c9' }).setOrigin(0.5);

        const panelWidth = Math.min(640, width - 32);
        this.panelWidth = panelWidth;
        const panel = this.add.graphics();
        panel.fillStyle(0xf7e4bd, 0.97);
        panel.fillRoundedRect(width / 2 - panelWidth / 2, 125, panelWidth, Math.min(560, height - 140), 12);
        panel.lineStyle(4, 0x7a4d35, 1);
        panel.strokeRoundedRect(width / 2 - panelWidth / 2, 125, panelWidth, Math.min(560, height - 140), 12);

        this.add.text(width / 2, 160, 'PLAYERS', { fontSize: '15px', color: '#7a4d35', fontStyle: 'bold', letterSpacing: 2 }).setOrigin(0.5);
        this.playerList = this.add.container(width / 2, 180);
        this.renderPlayerList(this.panelWidth);
        this.statusText = this.add.text(width / 2 - panelWidth / 2 + 42, 390, '', { fontSize: '15px', color: '#243447', fontStyle: 'bold' });
        this.updateStatus();
        this.createButton(width / 2, 455, 230, 50, 'ADD BOT', 0x2d6a5a, () => this.addBot());
        this.createButton(width / 2, 515, 230, 50, 'INVITE FRIEND', 0x426b82, () => this.inviteFriend());
        this.add.text(width / 2, 570, 'Invite code', { fontSize: '13px', color: '#80644f' }).setOrigin(0.5);
        this.add.text(width / 2, 595, 'CATAN-LOCAL', { fontSize: '20px', color: '#243447', fontStyle: 'bold', letterSpacing: 2 }).setOrigin(0.5);
        this.startButton = this.createButton(width / 2, Math.min(635, height - 48), 270, 56, 'START GAME', 0x7a4d35, () => {
            if (this.players.length >= 2) this.scene.start('MainScene', { players: this.players });
        });
        this.updateStartButton();
        this.createButton(70, 55, 90, 38, 'BACK', 0x426b82, () => this.scene.start('MainMenuScene'));
    }

    private addBot() {
        if (this.players.length >= 4) return;
        const botNumber = this.players.filter(player => player.isBot).length + 1;
        this.players.push({ name: `Bot ${botNumber}`, colorStr: '#9aa3a8', colorHex: 0x8d989e, isBot: true });
        this.renderPlayerList(this.panelWidth);
        this.updateStatus();
    }

    private inviteFriend() {
        this.statusText.setText('Online invites will use this lobby code.');
    }

    private renderPlayerList(panelWidth: number) {
        this.playerList.removeAll(true);
        this.players.forEach((player, index) => {
            const y = index * 52;
            const row = this.add.graphics();
            row.fillStyle(index === 0 ? 0xe8d2a6 : 0xf1dfbd, 1);
            row.fillRoundedRect(-panelWidth / 2 + 22, y, panelWidth - 44, 42, 6);
            this.playerList.add(row);
            const avatar = this.createPawnAvatar(-panelWidth / 2 + 50, y + 21, player.colorHex);
            if (index === 0) {
                avatar.setInteractive(new Phaser.Geom.Circle(-panelWidth / 2 + 50, y + 21, 18), Phaser.Geom.Circle.Contains);
                avatar.on('pointerdown', () => this.showColorPicker());
            }
            this.playerList.add(avatar);
            this.playerList.add(this.add.text(-panelWidth / 2 + 76, y + 12, player.name, { fontSize: '16px', color: player.colorStr, fontStyle: 'bold' }));
            this.playerList.add(this.add.text(-panelWidth / 2 + 76, y + 29, index === 0 ? 'Lobby leader' : (player.isBot ? 'AI opponent' : 'Player'), { fontSize: '11px', color: '#80644f' }));
            if (index > 0) {
                const kick = this.createButton(panelWidth / 2 - 70, y + 21, 72, 28, 'KICK', 0x9a4b3f, () => this.kickPlayer(index));
                kick.setScale(0.8);
                this.playerList.add(kick);
            }
        });
    }

    private showColorPicker() {
        if (this.colorPickerUI) this.colorPickerUI.destroy();
        const width = this.scale.width;
        const height = this.scale.height;
        this.colorPickerUI = this.add.container(0, 0).setDepth(20);
        this.colorPickerUI.add(this.add.rectangle(width / 2, height / 2, width, height, 0x08131c, 0.72).setInteractive());
        const panel = this.add.graphics();
        panel.fillStyle(0xf7e4bd, 1);
        panel.fillRoundedRect(width / 2 - 220, height / 2 - 165, 440, 330, 12);
        panel.lineStyle(4, 0x7a4d35, 1);
        panel.strokeRoundedRect(width / 2 - 220, height / 2 - 165, 440, 330, 12);
        this.colorPickerUI.add(panel);
        this.colorPickerUI.add(this.add.text(width / 2, height / 2 - 125, 'CHOOSE YOUR COLOR', { fontSize: '22px', color: '#243447', fontStyle: 'bold' }).setOrigin(0.5));
        this.colors.forEach((color, index) => {
            const column = index % 5;
            const row = Math.floor(index / 5);
            const x = width / 2 - 150 + column * 75;
            const y = height / 2 - 52 + row * 65;
            const occupied = this.players.some((player, playerIndex) => playerIndex !== 0 && player.colorHex === color.colorHex);
            const swatch = this.add.circle(x, y, 24, color.colorHex, occupied ? 0.25 : 1);
            swatch.setStrokeStyle(3, color.colorHex === this.players[0].colorHex ? 0x243447 : 0xf7e4bd, 1);
            if (!occupied) {
                swatch.setInteractive(new Phaser.Geom.Circle(24, 24, 32), Phaser.Geom.Circle.Contains);
                swatch.on('pointerdown', () => {
                    Object.assign(this.players[0], color);
                    this.colorPickerUI?.destroy();
                    this.colorPickerUI = undefined;
                    this.renderPlayerList(this.panelWidth);
                });
            }
            this.colorPickerUI?.add(swatch);
        });
        this.colorPickerUI.add(this.add.text(width / 2, height / 2 + 82, 'Occupied colors are unavailable', { fontSize: '13px', color: '#80644f', fontStyle: 'italic' }).setOrigin(0.5));
        const cancel = this.add.text(width / 2, height / 2 + 125, 'CANCEL', {
            fontSize: '15px', color: '#fff8e7', fontStyle: 'bold', backgroundColor: '#426b82', padding: { x: 22, y: 8 }
        }).setOrigin(0.5).setInteractive(new Phaser.Geom.Rectangle(-60, -20, 120, 40), Phaser.Geom.Rectangle.Contains);
        cancel.on('pointerdown', () => this.colorPickerUI?.destroy());
        this.colorPickerUI.add(cancel);
    }

    private kickPlayer(index: number) {
        if (index <= 0 || index >= this.players.length) return;
        this.players.splice(index, 1);
        this.renderPlayerList(this.panelWidth);
        this.updateStatus();
    }

    private updateStatus() {
        if (!this.statusText) return;
        const remaining = 4 - this.players.length;
        this.statusText.setText(this.players.length < 2 ? 'Add at least one more player to start.' : `${this.players.length} players ready  |  ${remaining} open seats`);
        this.updateStartButton();
    }

    private updateStartButton() {
        if (!this.startButton) return;
        const enabled = this.players.length >= 2;
        this.startButton.setAlpha(enabled ? 1 : 0.45);
        const background = this.startButton.getAt(0) as Phaser.GameObjects.Graphics | undefined;
        if (background?.input) background.input.enabled = enabled;
    }

    private createPawnAvatar(x: number, y: number, color: number) {
        const pawn = this.add.graphics();
        pawn.fillStyle(color, 1);
        pawn.lineStyle(2, 0x243447, 0.55);
        pawn.fillEllipse(x, y + 8, 23, 7);
        pawn.strokeEllipse(x, y + 8, 23, 7);
        pawn.beginPath();
        pawn.moveTo(x - 8, y + 7);
        pawn.lineTo(x + 8, y + 7);
        pawn.lineTo(x + 4, y - 4);
        pawn.lineTo(x - 4, y - 4);
        pawn.closePath();
        pawn.fillPath();
        pawn.strokePath();
        pawn.fillEllipse(x, y - 5, 14, 5);
        pawn.strokeEllipse(x, y - 5, 14, 5);
        pawn.fillCircle(x, y - 12, 7);
        pawn.strokeCircle(x, y - 12, 7);
        return pawn;
    }

    private drawBackdrop() {
        const background = this.add.graphics();
        background.fillGradientStyle(0x10202b, 0x10202b, 0x274a59, 0x0b141b, 1);
        background.fillRect(0, 0, this.scale.width, this.scale.height);
    }

    private createButton(x: number, y: number, width: number, height: number, label: string, color: number, action: () => void) {
        const button = this.add.container(x, y);
        const background = this.add.graphics();
        background.fillStyle(color, 1);
        background.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
        background.lineStyle(2, 0xf7e4bd, 0.8);
        background.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
        button.add(background);
        button.add(this.add.text(0, 0, label, { fontSize: '16px', color: '#fff8e7', fontStyle: 'bold' }).setOrigin(0.5));
        background.setInteractive(new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height), Phaser.Geom.Rectangle.Contains);
        background.on('pointerover', () => background.setAlpha(0.8));
        background.on('pointerout', () => background.setAlpha(1));
        background.on('pointerdown', action);
        return button;
    }
}

class MainScene extends Phaser.Scene {
    private bg!: Phaser.GameObjects.Image;
    private boardContainer!: Phaser.GameObjects.Container;
    private buildingsContainer!: Phaser.GameObjects.Container;
    
    private leftUI!: Phaser.GameObjects.Container;
    private rightUI!: Phaser.GameObjects.Container;
    private topRightUI!: Phaser.GameObjects.Container;
    private topLeftUI!: Phaser.GameObjects.Container;
    private bottomLeftUI!: Phaser.GameObjects.Container; 
    private diceUI!: Phaser.GameObjects.Container; 
    private endTurnUI!: Phaser.GameObjects.Container; 
    private devCardUI!: Phaser.GameObjects.Container;
    private titlesUI!: Phaser.GameObjects.Container;
    private pendingFreeRoads = 0;
    private uiScale = 1;

    private setupBannerContainer!: Phaser.GameObjects.Container;
    private setupBannerText!: Phaser.GameObjects.Text;
    private helpButtonUI!: Phaser.GameObjects.Container;
    private rulesModalUI!: Phaser.GameObjects.Container;
    private settingsButtonUI!: Phaser.GameObjects.Container;
    private developmentButtonUI!: Phaser.GameObjects.DOMElement;
    private settingsModalUI!: Phaser.GameObjects.Container;
    private victoryLobbyButton?: Phaser.GameObjects.DOMElement;
    private stealModalUI!: Phaser.GameObjects.Container;

    private tradeContentContainer!: Phaser.GameObjects.Container;
    private tradeButtonsContainer!: Phaser.GameObjects.Container;
    private currentTradeTarget: TradeTarget = 'BANK';
    private tradeGiveResource: ResourceKey = 'log';
    private tradeReceiveResource: ResourceKey = 'brick';
    private tradeGiveAmount = 1;
    private tradeReceiveAmount = 1;

    private gameState!: GameState;

    // --- MULTIPLAYER ---
    private network: P2PNetwork | null = null;
    private myPeerId: string | null = null;
    private myPlayerIndex: number = 0;
    private isHost: boolean = false;
    private networkedPlayers: { peerId: string; playerIndex: number }[] = [];
    private roomId: string = '';
    private readyToPlay = false;

    // --- DETERMINISTIC BOARD ---
    private boardSeed: number = createRandomSeed();
    private boardRng: SeededRandom = new SeededRandom(this.boardSeed);
    private devRng: SeededRandom = new SeededRandom(this.boardSeed ^ 0x5bf03635);

    private uiPlayerStatsTexts: Phaser.GameObjects.Text[] = [];
    private uiPlayerNameTexts: Phaser.GameObjects.Text[] = [];
    private uiMyResourcesTexts: Record<string, Phaser.GameObjects.Text> = {};
    private buildErrorText: Phaser.GameObjects.Text | null = null;
    private titleTexts: Phaser.GameObjects.Text[] = [];
    private turnIndicatorText!: Phaser.GameObjects.Text;
    private victoryModalUI!: Phaser.GameObjects.Container;

    private rollDiceBg!: Phaser.GameObjects.Graphics;
    private rollDiceText!: Phaser.GameObjects.Text;
    private rollDiceHitArea!: Phaser.GameObjects.Rectangle;

    // --- BOARD GRAPH DATA ---
    private intersections: Intersection[] = [];
    private edges: Edge[] = [];
    private hexes: HexData[] = [];
    private interactiveSpots: Phaser.GameObjects.GameObject[] = [];
    private lastBuiltSettlement: Intersection | null = null;
    private lastBotSettlement: Intersection | null = null;
    private robberGraphics!: Phaser.GameObjects.Graphics;
    private ports: PortAccess[] = [];

    constructor() {
        super({ key: 'MainScene' });
    }

    preload() {
        this.load.image('boardBackground', '/tabla.png');
        this.load.image('boat', '/boat.png');
        this.load.image('sheep', '/sheep.png');
        this.load.image('wheat', '/wheat.png');
        this.load.image('brick', '/brick.png');
        this.load.image('question', '/question_mark.png');
        this.load.image('stone', '/stone.png');
        this.load.image('log', '/log.png');
    }

    create() {
        this.uiPlayerStatsTexts = [];
        this.uiPlayerNameTexts = [];
        this.uiMyResourcesTexts = {};
        this.titleTexts = [];
        this.intersections = [];
        this.edges = [];
        this.hexes = [];
        this.ports = [];
        this.interactiveSpots = [];
        this.lastBuiltSettlement = null;
        this.lastBotSettlement = null;
        this.buildErrorText = null;
        this.victoryModalUI = undefined as unknown as Phaser.GameObjects.Container;
        this.victoryLobbyButton = undefined;
        const sceneData = this.scene.settings.data as { 
            players?: LobbyPlayer[]; 
            network?: P2PNetwork; 
            myPeerId?: string; 
            isHost?: boolean;
            roomId?: string;
            seed?: number;
        } | undefined;

        if (typeof sceneData?.seed === 'number') {
            this.applyBoardSeed(sceneData.seed);
        }

        this.initGameState(sceneData?.players);
        this.initNetwork(sceneData);
        this.input.keyboard?.on('keydown', this.handleDeveloperKey, this);

        const width = this.scale.width;
        const height = this.scale.height;

        this.bg = this.add.image(width / 2, height / 2, 'boardBackground');
        this.boardContainer = this.add.container(width / 2, height / 2);
        this.buildingsContainer = this.add.container(0, 0);
        
        this.generateBoard();
        this.boardContainer.add(this.buildingsContainer);

        this.topLeftUI = this.add.container(20, 20);
        this.leftUI = this.add.container(20, height / 2 - 80); 
        this.bottomLeftUI = this.add.container(20, height - 260); 
        
        this.rightUI = this.add.container(width - 90, height - 90);
        this.diceUI = this.add.container(width - 290, height - 90); 
        this.topRightUI = this.add.container(width - 420, 20);
        this.endTurnUI = this.add.container(width - 180, height - 400); 
        this.devCardUI = this.add.container(20, 450);
        this.titlesUI = this.add.container(20, 500);

        this.updateBackgroundSize(width, height);
        
        this.generateUI();
        this.generateBuildMenu(); 
        this.generateTradeMenu();
        this.generateDevCardUI();
        this.generateDiceUI();
        this.generateEndTurnUI();
        this.generateSetupBanner(width);
        this.generateHelpButton();
        this.generateSettingsButton();
        this.generateDevelopmentButton();
        this.layoutUI(width, height);

        this.renderSetupSpots();
        this.refreshAllButtonStates();
        this.updateUIStats();

        this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
            const w = gameSize.width;
            const h = gameSize.height;
            
            this.updateBackgroundSize(w, h);

            this.layoutUI(w, h);

            if(this.setupBannerContainer && this.setupBannerContainer.active) {
                this.setupBannerContainer.setPosition(w / 2, 40 * this.uiScale);
            }
            if (this.settingsModalUI?.visible) this.renderSettingsModal();
        });
    }

    private layoutUI(width: number, height: number) {
        const requiredHeight = 350 + 220 + 240 + 16;
        this.uiScale = Math.min(1, width / 1126, (height - 24) / requiredHeight);
        this.applyUILayout(width, height);

        const uiGroups = [
            this.leftUI, this.devCardUI, this.titlesUI, this.bottomLeftUI, this.rightUI,
            this.diceUI, this.topRightUI, this.endTurnUI
        ];
        for (let attempt = 0; attempt < 8; attempt++) {
            const collision = uiGroups.some((group, index) => uiGroups.slice(index + 1).some(other =>
                Phaser.Geom.Rectangle.Overlaps(group.getBounds(), other.getBounds())
            ));
            if (!collision || this.uiScale <= 0.6) break;
            this.uiScale *= 0.9;
            this.applyUILayout(width, height);
        }
    }

    private applyUILayout(width: number, height: number) {
        const uiScale = this.uiScale;
        const boardTop = Math.max(72, 80 * uiScale);
        const boardBottom = 12;
        const boardHeight = height - boardTop - boardBottom;
        const boardScale = Math.min(1, (width - 24) / 980, boardHeight / 820);
        const leftX = 12;
        const scoreboardY = 12 + 145 * uiScale;
        const cardsY = scoreboardY + 205 * uiScale + 8;
        const buildY = height - 12 - 380 * uiScale;

        this.topLeftUI.setPosition(20, 20);
        this.topLeftUI.setScale(uiScale);
        this.leftUI.setPosition(leftX, scoreboardY);
        this.devCardUI.setPosition(leftX, cardsY);
        const titlesY = cardsY + 220 * uiScale + 8;
        this.titlesUI.setPosition(leftX, titlesY);
        this.bottomLeftUI.setPosition(leftX, buildY);

        this.leftUI.setScale(uiScale);
        this.devCardUI.setScale(uiScale);
        this.titlesUI.setScale(uiScale);
        this.bottomLeftUI.setScale(uiScale);

        this.rightUI.setPosition(width - 90 * uiScale, height - 90 * uiScale);
        this.diceUI.setPosition(width - 290 * uiScale, height - 90 * uiScale);
        this.topRightUI.setPosition(width - 420 * uiScale, 12 * uiScale);
        this.endTurnUI.setPosition(width - 180 * uiScale, height - 400 * uiScale);
        this.rightUI.setScale(uiScale);
        this.diceUI.setScale(uiScale);
        this.topRightUI.setScale(uiScale);
        this.endTurnUI.setScale(uiScale);
        this.helpButtonUI.setPosition(width - 455 * uiScale, 38 * uiScale);
        this.helpButtonUI.setScale(uiScale);
        this.settingsButtonUI.setPosition(width - 505 * uiScale, 38 * uiScale);
        this.settingsButtonUI.setScale(uiScale);
        this.developmentButtonUI.setPosition(width - 555 * uiScale, 38 * uiScale);
        this.developmentButtonUI.setScale(uiScale);
        this.boardContainer.setPosition(width / 2, boardTop + boardHeight / 2);
        this.boardContainer.setScale(boardScale);

        if (this.setupBannerContainer) {
            this.setupBannerContainer.setScale(uiScale);
            this.setupBannerContainer.setPosition(width / 2, 40 * uiScale);
        }
        if (this.rulesModalUI && this.rulesModalUI.visible) {
            this.renderRulesManual();
        }
    }

    private initGameState(lobbyPlayers?: LobbyPlayer[]) {
        this.gameState = {
            currentPlayerIndex: 0,
            turnPhase: 'SETUP', 
            setupState: { phase: 'SETTLEMENT', count: 0 },
            botSetupState: { phase: 'SETTLEMENT', botIndex: 1, round: 0 },
            lastDice: { d1: 1, d2: 1, total: 2 },
            bankDevCards: 25,
            devDeck: this.devRng.shuffle([
                ...Array(14).fill('Knight'), ...Array(5).fill('Victory Point'),
                ...Array(2).fill('Road Building'), ...Array(2).fill('Year of Plenty'),
                ...Array(2).fill('Monopoly')
            ]) as DevCardType[],
            myDevCards: [],
            myTurnNumber: 1,
            playedDevCardThisTurn: false,
            largestArmyOwner: null,
            longestRoadOwner: null,
            turnOrder: [],
            players: [
                { id: 0, name: 'You (Blue)',   colorStr: '#66aaff', colorHex: 0x4488ff, points: 0, hiddenVictoryPoints: 0, playedKnights: 0, devCards: 0, botDevCards: [], isBot: false, resources: { log: 0, brick: 0, sheep: 0, wheat: 0, stone: 0 } },
                { id: 1, name: 'Red Bot',      colorStr: '#ff6666', colorHex: 0xff4444, points: 0, hiddenVictoryPoints: 0, playedKnights: 0, devCards: 0, botDevCards: [], isBot: true, resources: { log: 0, brick: 0, sheep: 0, wheat: 0, stone: 0 } },
                { id: 2, name: 'Green Bot',    colorStr: '#66ff66', colorHex: 0x44ff44, points: 0, hiddenVictoryPoints: 0, playedKnights: 0, devCards: 0, botDevCards: [], isBot: true, resources: { log: 0, brick: 0, sheep: 0, wheat: 0, stone: 0 } },
                { id: 3, name: 'Orange Bot',   colorStr: '#ffcc66', colorHex: 0xffa500, points: 0, hiddenVictoryPoints: 0, playedKnights: 0, devCards: 0, botDevCards: [], isBot: true, resources: { log: 0, brick: 0, sheep: 0, wheat: 0, stone: 0 } }
            ]
        };
        if (lobbyPlayers?.length) {
            this.gameState.players = lobbyPlayers.map((player, id) => ({
                id,
                name: player.name,
                colorStr: player.colorStr,
                colorHex: player.colorHex,
                points: 0,
                hiddenVictoryPoints: 0,
                playedKnights: 0,
                devCards: 0,
                botDevCards: [],
                isBot: player.isBot ?? false,
                resources: { log: 0, brick: 0, sheep: 0, wheat: 0, stone: 0 }
            }));
        }
    }

    private initNetwork(sceneData: { network?: P2PNetwork; myPeerId?: string; isHost?: boolean; roomId?: string; seed?: number } | undefined) {
        if (!sceneData?.network) return;

        this.network = sceneData.network;
        this.myPeerId = sceneData.myPeerId ?? null;
        this.isHost = sceneData.isHost ?? false;
        this.myPlayerIndex = this.isHost ? 0 : 1;
        this.roomId = sceneData.roomId ?? this.network.getRoomId() ?? '';

        this.networkedPlayers = [
            { peerId: this.myPeerId!, playerIndex: this.myPlayerIndex },
            { peerId: 'remote', playerIndex: this.isHost ? 1 : 0 }
        ];

        this.network.setCallbacks({
            onMessage: (msg) => this.handleNetworkMessage(msg),
            onConnect: () => {
                console.log('P2P connected');
            },
            onDisconnect: () => {
                this.showBuildError('Adversar deconectat.');
            },
            onError: (err) => {
                this.showBuildError('Eroare rețea: ' + err);
            }
        });

        const myName = this.gameState.players[this.myPlayerIndex].name;
        if (this.isHost) {
            this.network.send('BOARD_SEED', { seed: this.boardSeed, hostName: myName });
        } else {
            this.readyToPlay = false;
            this.network.send('GAME_READY', { playerIndex: this.myPlayerIndex, playerName: myName });
        }
    }

    private advanceMultiplayerSetup() {
        const totalSettlements = this.intersections.filter(i => i.owner !== null).length;
        if (totalSettlements === 1) {
            this.gameState.currentPlayerIndex = 1;
        } else if (totalSettlements === 2) {
            this.gameState.currentPlayerIndex = 1;
        } else if (totalSettlements === 3) {
            this.gameState.currentPlayerIndex = 0;
        } else if (totalSettlements >= 4) {
            this.gameState.setupState.phase = 'DONE';
            if (this.setupBannerContainer) this.setupBannerContainer.destroy();
            this.gameState.turnPhase = 'ROLL';
            this.gameState.currentPlayerIndex = 0;
            this.gameState.myTurnNumber += 1;
            this.gameState.playedDevCardThisTurn = false;
            this.updateDiceVisuals();
            this.refreshAllButtonStates();
            return;
        }

        if (this.gameState.currentPlayerIndex === this.myPlayerIndex) {
            this.gameState.setupState.phase = 'SETTLEMENT';
            this.updateSetupBanner();
            this.renderSetupSpots();
        } else if (this.setupBannerText) {
            this.setupBannerText.setText('SETUP PHASE: Adversarul plasează...');
        }
    }

    private handleNetworkMessage(msg: any) {
        const inner = msg.type === 'GAME_MESSAGE' ? msg : { type: msg.type, payload: msg.payload, senderId: msg.senderId };
        const gameType = inner.gameType ?? inner.type;
        const payload = inner.payload ?? inner.payload;

        if (inner.senderId && inner.senderId !== this.myPeerId) {
            const existing = this.networkedPlayers.find(p => p.playerIndex === (this.myPlayerIndex === 0 ? 1 : 0));
            if (existing) existing.peerId = inner.senderId;
        }

        switch (gameType) {
            case 'ROLL_DICE':
                this.gameState.lastDice = payload.dice;
                this.distributeResourcesFromRoll(payload.total);
                this.updateDiceVisuals();
                this.updateUIStats();
                if (this.gameState.turnPhase === 'MOVE_ROBBER') {
                    this.showBuildError('Adversarul a dat 7. Mută robberul.');
                } else {
                    this.gameState.turnPhase = 'TRADE_BUILD';
                    this.refreshAllButtonStates();
                }
                break;

            case 'BUILD_ROAD': {
                const { cx, cy, angle, colorHex } = payload;
                this.drawRoad(cx, cy, angle, colorHex);
                const edge = this.edges.find(e =>
                    Math.abs(e.cx - cx) < 5 && Math.abs(e.cy - cy) < 5
                );
                if (edge) edge.owner = payload.owner;
                this.checkLongestRoad();
                break;
            }

            case 'BUILD_SETTLEMENT': {
                const { x, y, colorHex, owner } = payload;
                const int = this.intersections.find(i =>
                    Math.abs(i.x - x) < 5 && Math.abs(i.y - y) < 5
                );
                if (int) {
                    int.owner = owner;
                    int.type = 'SETTLEMENT';
                    int.buildingSprite = this.drawSettlement(int.x, int.y, colorHex);
                }
                this.gameState.players[owner].points += 1;
                this.updateUIStats();
                this.checkVictory();
                break;
            }

            case 'BUILD_CITY': {
                const { x, y, colorHex, owner } = payload;
                const int = this.intersections.find(i =>
                    Math.abs(i.x - x) < 5 && Math.abs(i.y - y) < 5
                );
                if (int) {
                    int.type = 'CITY';
                    if (int.buildingSprite && int.buildingSprite.active) int.buildingSprite.destroy();
                    int.buildingSprite = this.drawCity(int.x, int.y, colorHex);
                }
                this.gameState.players[owner].points += 1;
                this.updateUIStats();
                this.checkVictory();
                break;
            }

            case 'BUY_DEV_CARD':
                this.gameState.bankDevCards--;
                this.gameState.players[payload.owner].devCards++;
                this.updateBankDisplay();
                this.updateUIStats();
                this.updateDevCardUI();
                this.checkVictory();
                break;

            case 'END_TURN':
                this.nextTurnNetworked();
                break;

            case 'TRADE':
                this.applyRemoteTrade(payload);
                this.updateUIStats();
                break;

            case 'MOVE_ROBBER':
                this.moveRobberFromNetwork(payload.hex);
                break;

            case 'STEAL':
                this.applyRemoteSteal(payload);
                break;

            case 'BOARD_SEED':
                if (payload.hostName) {
                    this.gameState.players[0].name = payload.hostName;
                    this.uiPlayerNameTexts[0]?.setText(payload.hostName);
                }
                this.applyBoardSeed(payload.seed);
                this.regenerateBoard();
                this.readyToPlay = true;
                this.updateDiceVisuals();
                break;

            case 'GAME_READY':
                if (payload.playerName) {
                    this.gameState.players[1].name = payload.playerName;
                    this.uiPlayerNameTexts[1]?.setText(payload.playerName);
                }
                if (this.isHost) {
                    this.network?.send('BOARD_SEED', {
                        seed: this.boardSeed,
                        hostName: this.gameState.players[0].name
                    });
                }
                this.updateDiceVisuals();
                break;

            case 'SETUP_PLACEMENT':
                if (payload.kind === 'settlement') {
                    const int = this.intersections.find(i => Math.abs(i.x - payload.x) < 5 && Math.abs(i.y - payload.y) < 5);
                    if (int) {
                        int.owner = payload.owner ?? int.owner;
                        int.type = 'SETTLEMENT';
                        if (payload.colorHex != null) int.colorHex = payload.colorHex;
                        if (!int.buildingSprite) {
                            int.buildingSprite = this.drawSettlement(int.x, int.y, payload.colorHex != null ? payload.colorHex : (int.owner === 0 ? 0x4488ff : 0xff6666));
                        }
                        this.gameState.players[payload.owner].points += 1;
                        this.updateUIStats();
                    }
                } else {
                    const edge = this.edges.find(e => Math.abs(e.cx - payload.cx) < 5 && Math.abs(e.cy - payload.cy) < 5);
                    if (edge) {
                        edge.owner = payload.owner ?? edge.owner;
                        if (payload.colorHex != null) {
                            this.drawRoad(edge.cx, edge.cy, edge.angle, payload.colorHex);
                        }
                    }
                }
                this.checkLongestRoad();
                this.checkVictory();
                break;

            case 'SETUP_DONE':
                this.advanceMultiplayerSetup();
                break;

            case 'START_GAME':
                this.gameState.turnOrder = payload.turnOrder;
                this.gameState.currentPlayerIndex = this.myPlayerIndex;
                this.gameState.turnPhase = 'ROLL';
                this.gameState.setupState = { phase: 'DONE', count: payload.playerCount };
                this.gameState.myTurnNumber = 1;
                this.gameState.playedDevCardThisTurn = false;
                this.updateDiceVisuals();
                this.refreshAllButtonStates();
                this.updateUIStats();
                this.showSetupMessage('Game started. Your turn.');
                break;

            case 'DISCARD':
                const dPlayer = this.gameState.players[payload.playerIndex];
                if (dPlayer) {
                    Object.entries(payload.resources).forEach(([res, count]) => {
                        const key = res as ResourceKey;
                        const numCount = Number(count);
                        if (numCount > 0) dPlayer.resources[key] -= numCount;
                    });
                    this.gameState.turnPhase = 'TRADE_BUILD';
                    this.refreshAllButtonStates();
                    this.updateUIStats();
                }
                break;

            case 'RESET_ROBBER':
                if (this.robberGraphics) this.robberGraphics.setPosition(payload.x, payload.y);
                this.hexes.forEach(h => { h.hasRobber = (Math.abs(h.x - payload.x) < 5 && Math.abs(h.y - payload.y) < 5); });
                this.gameState.turnPhase = 'TRADE_BUILD';
                this.refreshAllButtonStates();
                break;

            case 'DRAW_DEV_CARD':
                const dCardPlayer = this.gameState.players[payload.owner];
                if (dCardPlayer) {
                    if (!this.gameState.devDeck.includes(payload.card)) {
                        this.gameState.devDeck.push(payload.card);
                    }
                    dCardPlayer.devCards++;
                    dCardPlayer.botDevCards.push(payload.card);
                    this.gameState.myTurnNumber = Math.max(this.gameState.myTurnNumber, payload.boughtOnTurn + 1);
                    this.updateBankDisplay();
                    this.updateUIStats();
                }
                break;

            case 'RESYNC_STATE':
                this.boardSeed = payload.boardSeed;
                this.applyBoardSeed(this.boardSeed);
                this.regenerateBoard();
                this.readyToPlay = true;
                this.syncPlayerData(payload.players);
                this.gameState.currentPlayerIndex = payload.currentPlayerIndex;
                this.gameState.turnPhase = payload.turnPhase;
                this.gameState.setupState = payload.setupState;
                this.gameState.botSetupState = payload.botSetupState;
                this.gameState.lastDice = payload.lastDice;
                this.gameState.bankDevCards = payload.bankDevCards;
                this.gameState.devDeck = payload.devDeck;
                this.gameState.myDevCards = payload.myDevCards;
                this.gameState.myTurnNumber = payload.myTurnNumber;
                this.gameState.playedDevCardThisTurn = payload.playedDevCardThisTurn;
                this.gameState.largestArmyOwner = payload.largestArmyOwner;
                this.gameState.longestRoadOwner = payload.longestRoadOwner;
                this.gameState.turnOrder = payload.turnOrder;
                this.refreshAllButtonStates();
                this.updateUIStats();
                this.updateDiceVisuals();
                break;

            default:
                console.log('Unknown network message:', gameType);
        }
    }

    private distributeResourcesFromRoll(total: number) {
        this.hexes.forEach(hex => {
            if (hex.numberToken === total && !hex.hasRobber) {
                this.intersections.forEach(int => {
                    if (int.owner !== null && Phaser.Math.Distance.Between(hex.x, hex.y, int.x, int.y) < 70) {
                        const amount = int.type === 'CITY' ? 2 : 1;
                        if (hex.resource) {
                            const resKey = hex.resource as keyof PlayerData['resources'];
                            this.gameState.players[int.owner].resources[resKey] += amount;
                        }
                    }
                });
            }
        });
    }

    private nextTurnNetworked() {
        const nextIndex = this.gameState.currentPlayerIndex === 0 ? 1 : 0;
        this.gameState.currentPlayerIndex = nextIndex;
        this.gameState.turnPhase = 'ROLL';
        this.gameState.playedDevCardThisTurn = false;
        this.updateDiceVisuals();
        this.refreshAllButtonStates();
        this.updateUIStats();
    }

    private applyRemoteTrade(payload: any) {
        const { giverIndex, receiverIndex, giveResource, receiveResource, giveAmount, receiveAmount } = payload;
        const giver = this.gameState.players[giverIndex];
        const receiver = this.gameState.players[receiverIndex];
        const resGive = giveResource as ResourceKey;
        const resReceive = receiveResource as ResourceKey;
        if (giver.resources[resGive] >= giveAmount) {
            giver.resources[resGive] -= giveAmount;
            receiver.resources[resReceive] += receiveAmount;
        }
    }

    private moveRobberFromNetwork(hex: { x: number; y: number }) {
        if (this.robberGraphics) {
            this.robberGraphics.setPosition(hex.x, hex.y);
        }
        this.hexes.forEach(h => {
            h.hasRobber = (Math.abs(h.x - hex.x) < 5 && Math.abs(h.y - hex.y) < 5);
        });
        this.gameState.turnPhase = 'TRADE_BUILD';
        this.refreshAllButtonStates();
    }

    private applyRemoteSteal(payload: any) {
        const { fromIndex, toIndex, resource } = payload;
        const from = this.gameState.players[fromIndex];
        const to = this.gameState.players[toIndex];
        const res = resource as ResourceKey;
        if (from.resources[res] > 0) {
            from.resources[res]--;
            to.resources[res]++;
        }
        this.updateUIStats();
    }

    private isMyTurnAndPhase(phase: string): boolean {
        return this.gameState.currentPlayerIndex === this.myPlayerIndex && this.gameState.turnPhase === phase;
    }

    private handleDeveloperKey(event: KeyboardEvent) {
        if (event.key === '\\') {
            const player = this.gameState.players[this.myPlayerIndex];
            Object.keys(player.resources).forEach(resource => {
                const resourceKey = resource as keyof PlayerData['resources'];
                player.resources[resourceKey] += 10;
            });
            this.updateUIStats();
            this.showBuildError('Developer tool: +10 of every resource.');
            return;
        }

        if (!this.isMyTurnAndPhase('TRADE_BUILD')) return;

        switch (event.key.toLowerCase()) {
            case 'r':
                this.executeBuild('Road');
                break;
            case 's':
                this.executeBuild('Settlement');
                break;
            case 'c':
                this.executeBuild('City');
                break;
            case 'd':
                this.executeBuild('Dev Card');
                break;
            case 't':
                this.cycleTradeTarget();
                break;
            case 'e':
                this.endTurn();
                break;
            case ' ':
                if (this.isMyTurnAndPhase('ROLL')) {
                    this.rollDice();
                }
                break;
        }
    }

    private cycleTradeTarget() {
        const targets: TradeTarget[] = ['BANK', 'ALL', 'RED BOT', 'GREEN BOT', 'ORANGE BOT'];
        const currentIndex = targets.indexOf(this.currentTradeTarget);
        const nextIndex = (currentIndex + 1) % targets.length;
        this.currentTradeTarget = targets[nextIndex];
        this.renderTradeButtons();
        this.updateTradeContent();
        this.showBuildError(`Trade target: ${this.currentTradeTarget}`);
    }

    private refreshAllButtonStates() {
        const canRoll = this.isMyTurnAndPhase('ROLL');
        
        if (canRoll) {
            this.rollDiceHitArea.setInteractive({ useHandCursor: true });
            this.diceUI.setAlpha(1);
        } else {
            this.rollDiceHitArea.disableInteractive();
            this.diceUI.setAlpha(this.gameState.turnPhase === 'SETUP' ? 0.4 : 1); 
        }

        const canPlay = this.isMyTurnAndPhase('TRADE_BUILD');
        this.endTurnUI.setAlpha(canPlay ? 1 : 0.4);
        if (canPlay) {
            this.endTurnHitArea.setInteractive({ useHandCursor: true });
        } else {
            this.endTurnHitArea.disableInteractive();
        }

        this.bottomLeftUI.setAlpha(canPlay ? 1 : 0.4);
        this.updateTradeContent();
        this.updateDevCardUI();
    }

    private updateUIStats() {
        this.gameState.players.forEach((p, index) => {
            const totalRes = p.resources.log + p.resources.brick + p.resources.sheep + p.resources.wheat + p.resources.stone;
            if(this.uiPlayerStatsTexts[index]) {
                if (index === this.myPlayerIndex) {
                    const realPoints = this.getRealPoints(p);
                    this.uiPlayerStatsTexts[index].setText(`Pts: ${p.points} | Real: ${realPoints} | Res: ${totalRes} | Cards: ${p.devCards}`);
                } else {
                    this.uiPlayerStatsTexts[index].setText(`Pts: ${p.points} | Res: ${totalRes} | Cards: ${p.devCards}`);
                }
            }
        });

        if (this.titleTexts[0] && this.titleTexts[1]) {
            const lrOwner = this.gameState.longestRoadOwner;
            const laOwner = this.gameState.largestArmyOwner;
            
            if (lrOwner !== null) {
                const ownerName = this.gameState.players[lrOwner].name.replace('You ', 'You');
                this.titleTexts[0].setText(`🛣️ Longest Road: ${ownerName}`);
                this.titleTexts[0].setColor(this.gameState.players[lrOwner].colorStr);
            } else {
                this.titleTexts[0].setText('🛣️ Longest Road: —');
                this.titleTexts[0].setColor('#5C4033');
            }
            
            if (laOwner !== null) {
                const ownerName = this.gameState.players[laOwner].name.replace('You ', 'You');
                this.titleTexts[1].setText(`⚔️ Largest Army: ${ownerName}`);
                this.titleTexts[1].setColor(this.gameState.players[laOwner].colorStr);
            } else {
                this.titleTexts[1].setText('⚔️ Largest Army: —');
                this.titleTexts[1].setColor('#5C4033');
            }
        }

        const myRes = this.gameState.players[this.myPlayerIndex].resources;
        this.uiMyResourcesTexts['log'].setText(`x${myRes.log}`);
        this.uiMyResourcesTexts['brick'].setText(`x${myRes.brick}`);
        this.uiMyResourcesTexts['sheep'].setText(`x${myRes.sheep}`);
        this.uiMyResourcesTexts['wheat'].setText(`x${myRes.wheat}`);
        this.uiMyResourcesTexts['stone'].setText(`x${myRes.stone}`);
    }

    private syncPlayerData(players: any[]): void {
        if (players.length < this.gameState.players.length) return;
        this.gameState.players = players.map((p, i) => ({
            id: i,
            name: p.name,
            colorStr: p.colorStr,
            colorHex: p.colorHex,
            points: p.points,
            hiddenVictoryPoints: p.hiddenVictoryPoints,
            playedKnights: p.playedKnights,
            devCards: p.devCards,
            botDevCards: p.botDevCards,
            isBot: p.isBot,
            resources: {
                log: p.resources?.log ?? 0,
                brick: p.resources?.brick ?? 0,
                sheep: p.resources?.sheep ?? 0,
                wheat: p.resources?.wheat ?? 0,
                stone: p.resources?.stone ?? 0
            }
        }));
    }

    private distributeResources(roll: number) {
        let received = false;
        this.hexes.forEach(hex => {
            if (hex.numberToken === roll && !hex.hasRobber) {
                this.intersections.forEach(int => {
                    if (int.owner !== null && Phaser.Math.Distance.Between(hex.x, hex.y, int.x, int.y) < 70) {
                        const amount = int.type === 'CITY' ? 2 : 1;
                        if (hex.resource) {
                            const resKey = hex.resource as keyof PlayerData['resources'];
                            this.gameState.players[int.owner].resources[resKey] += amount;
                            received = true;
                        }
                    }
                });
            }
        });
        
        if (received) {
            this.updateUIStats();
        }
    }

    private isSamePoint(x1: number, y1: number, x2: number, y2: number, tolerance = 10): boolean {
        return Phaser.Math.Distance.Between(x1, y1, x2, y2) < tolerance;
    }

    private edgeTouchesIntersection(edge: Edge, intersection: Intersection): boolean {
        return this.isSamePoint(edge.x1, edge.y1, intersection.x, intersection.y) ||
            this.isSamePoint(edge.x2, edge.y2, intersection.x, intersection.y);
    }

    private edgesAreAdjacent(a: Edge, b: Edge): boolean {
        return this.isSamePoint(a.x1, a.y1, b.x1, b.y1) ||
            this.isSamePoint(a.x1, a.y1, b.x2, b.y2) ||
            this.isSamePoint(a.x2, a.y2, b.x1, b.y1) ||
            this.isSamePoint(a.x2, a.y2, b.x2, b.y2);
    }

    private hasAdjacentBuilding(intersection: Intersection): boolean {
        for (const edge of this.edges) {
            if (!this.edgeTouchesIntersection(edge, intersection)) continue;
            const endpointA = this.intersections.find(int => this.isSamePoint(int.x, int.y, edge.x1, edge.y1));
            const endpointB = this.intersections.find(int => this.isSamePoint(int.x, int.y, edge.x2, edge.y2));
            const neighbor = endpointA === intersection ? endpointB : endpointA;
            if (neighbor && neighbor.owner !== null) return true;
        }
        return false;
    }

    private getRealPoints(player: PlayerData): number {
        return player.points + player.hiddenVictoryPoints;
    }

    private getIntersectionIndexByPoint(x: number, y: number): number {
        return this.intersections.findIndex(int => this.isSamePoint(int.x, int.y, x, y));
    }

    private computeLongestRoadLength(playerId: number): number {
        const playerEdges = this.edges
            .map((edge, index) => ({ edge, index }))
            .filter(entry => entry.edge.owner === playerId);
        if (playerEdges.length === 0) return 0;

        const nodeToEdges = new Map<number, number[]>();
        const edgeNodes = new Map<number, [number, number]>();

        playerEdges.forEach(({ edge, index }) => {
            const nodeA = this.getIntersectionIndexByPoint(edge.x1, edge.y1);
            const nodeB = this.getIntersectionIndexByPoint(edge.x2, edge.y2);
            if (nodeA < 0 || nodeB < 0) return;
            edgeNodes.set(index, [nodeA, nodeB]);
            nodeToEdges.set(nodeA, [...(nodeToEdges.get(nodeA) ?? []), index]);
            nodeToEdges.set(nodeB, [...(nodeToEdges.get(nodeB) ?? []), index]);
        });

        const isBlockedNode = (nodeIndex: number): boolean => {
            const node = this.intersections[nodeIndex];
            return node.owner !== null && node.owner !== playerId;
        };

        const walk = (currentNode: number, visited: Set<number>): number => {
            let best = 1;
            if (isBlockedNode(currentNode)) return best;

            const connected = nodeToEdges.get(currentNode) ?? [];
            connected.forEach(nextEdge => {
                if (visited.has(nextEdge)) return;
                const nodes = edgeNodes.get(nextEdge);
                if (!nodes) return;
                const nextNode = nodes[0] === currentNode ? nodes[1] : nodes[0];
                visited.add(nextEdge);
                best = Math.max(best, 1 + walk(nextNode, visited));
                visited.delete(nextEdge);
            });
            return best;
        };

        let longest = 0;
        edgeNodes.forEach((nodes, edgeIndex) => {
            const visitedA = new Set<number>([edgeIndex]);
            const visitedB = new Set<number>([edgeIndex]);
            longest = Math.max(longest, walk(nodes[0], visitedA));
            longest = Math.max(longest, walk(nodes[1], visitedB));
        });

        return longest;
    }

    private rollDice() {
        if (!this.isMyTurnAndPhase('ROLL')) return;

        const d1 = Phaser.Math.Between(1, 6);
        const d2 = Phaser.Math.Between(1, 6);
        const total = d1 + d2;
        this.gameState.lastDice = { d1, d2, total };

        if (total === 7) {
            const player = this.gameState.players[this.myPlayerIndex];
            const totalCards = Object.values(player.resources).reduce((a, b) => a + b, 0);
            
            if (totalCards > 7) {
                this.gameState.turnPhase = 'DISCARD';
                this.showBuildError(`Rolled 7! You have ${totalCards} cards. Discard ${Math.floor(totalCards / 2)}.`);
                this.prepareDiscardPhase();
            } else {
                this.gameState.turnPhase = 'MOVE_ROBBER';
                this.showBuildError('Rolled 7! You must move the robber.');
                this.prepareRobberMovement();
            }
        } else {
            this.gameState.turnPhase = 'TRADE_BUILD';
            this.distributeResources(total);
        }

        this.updateDiceVisuals();
        this.refreshAllButtonStates();

        if (this.network && this.network.isConnected()) {
            this.network.send('ROLL_DICE', {
                dice: { d1, d2, total },
                total,
                rollerIndex: this.myPlayerIndex
            });
        }
    }

    private endTurn() {
        if (!this.isMyTurnAndPhase('TRADE_BUILD')) return;

        if (this.network && this.network.isConnected()) {
            this.network.send('END_TURN', { from: this.myPlayerIndex });
            this.nextTurnNetworked();
            return;
        }

        console.log("Turn Ended. Bots are playing...");
        const humanPosition = this.gameState.turnOrder.indexOf(this.myPlayerIndex);
        const botOrder = this.gameState.turnOrder.slice(humanPosition + 1).concat(this.gameState.turnOrder.slice(0, humanPosition));
        this.gameState.currentPlayerIndex = botOrder[0];
        this.gameState.turnPhase = 'ROLL';
        this.updateDiceVisuals();
        this.refreshAllButtonStates();

        let delay = 1000;
        for (const botIndex of botOrder) {
            this.time.delayedCall(delay, () => {
                console.log(`Bot ${botIndex} is playing...`);
                this.gameState.currentPlayerIndex = botIndex;
                this.gameState.turnPhase = 'ROLL';
                this.playBotTurn(botIndex);
            });
            delay += 3000;
        }

        this.time.delayedCall(delay, () => {
            console.log("Your turn!");
            this.gameState.currentPlayerIndex = this.myPlayerIndex;
            this.gameState.turnPhase = 'ROLL';
            this.gameState.myTurnNumber += 1;
            this.gameState.playedDevCardThisTurn = false;
            this.updateDiceVisuals();
            this.refreshAllButtonStates();
        });
    }

    private playBotTurn(botIndex: number) {
        const d1 = Phaser.Math.Between(1, 6);
        const d2 = Phaser.Math.Between(1, 6);
        const total = d1 + d2;
        this.gameState.lastDice = { d1, d2, total };
        this.updateDiceVisuals();
        
        if (total === 7) {
            this.handleBotSeven(botIndex);
        } else {
            this.distributeResources(total);
            this.maybePlayBotDevCard(botIndex);
            this.maybeBotTradeWithBank(botIndex);
            this.botBuildPhase(botIndex);
        }
        
        this.time.delayedCall(1500, () => {
            this.updateDiceVisuals();
        });
    }

    private handleBotSeven(botIndex: number) {
        const totalCards = Object.values(this.gameState.players[botIndex].resources).reduce((a, b) => a + b, 0);
        
        if (totalCards > 7) {
            const discardCount = Math.floor(totalCards / 2);
            this.botDiscardResources(botIndex, discardCount);
        }
        
        const targetHex = this.findBestRobberSpot(botIndex);
        this.moveRobber(targetHex);
        this.maybeBotSteal(botIndex, targetHex);
    }

    private botDiscardResources(botIndex: number, count: number) {
        const bot = this.gameState.players[botIndex];
        const resources: ResourceKey[] = ['log', 'brick', 'sheep', 'wheat', 'stone'];
        
        let resourcePool: ResourceKey[] = [];
        resources.forEach(res => {
            for (let i = 0; i < bot.resources[res]; i++) {
                resourcePool.push(res);
            }
        });
        
        Phaser.Utils.Array.Shuffle(resourcePool);
        for (let i = 0; i < count && i < resourcePool.length; i++) {
            bot.resources[resourcePool[i]]--;
        }
        this.updateUIStats();
    }

    private findBestRobberSpot(botIndex: number): HexData {
        const validHexes = this.hexes.filter(h => !h.hasRobber && h.resource !== null);
        if (validHexes.length === 0) return this.hexes[0];
        
        let bestHex = validHexes[0];
        let bestScore = -1;
        
        validHexes.forEach(hex => {
            let score = 0;
            this.intersections.forEach(int => {
                if (int.owner === this.myPlayerIndex && Phaser.Math.Distance.Between(hex.x, hex.y, int.x, int.y) < 70) {
                    score += int.type === 'CITY' ? 4 : 2;
                } else if (int.owner !== null && int.owner !== botIndex && Phaser.Math.Distance.Between(hex.x, hex.y, int.x, int.y) < 70) {
                    score += int.type === 'CITY' ? 2 : 1;
                }
            });
            
            if (hex.numberToken === 6 || hex.numberToken === 8) score += 2;
            if (hex.numberToken === 5 || hex.numberToken === 9) score += 1;
            
            if (score > bestScore) {
                bestScore = score;
                bestHex = hex;
            }
        });
        
        return bestHex;
    }

    private maybeBotSteal(botIndex: number, hex: HexData) {
        const adjacentPlayers = new Set<number>();
        this.intersections.forEach(int => {
            if (int.owner !== null && int.owner !== botIndex && Phaser.Math.Distance.Between(hex.x, hex.y, int.x, int.y) < 70) {
                adjacentPlayers.add(int.owner);
            }
        });
        
        if (adjacentPlayers.size === 0) return;
        
        let targetPlayer = adjacentPlayers.has(this.myPlayerIndex) ? this.myPlayerIndex : Array.from(adjacentPlayers)[0];
        
        const target = this.gameState.players[targetPlayer];
        const stealableResources: ResourceKey[] = [];
        ['log', 'brick', 'sheep', 'wheat', 'stone'].forEach(res => {
            for (let i = 0; i < target.resources[res as ResourceKey]; i++) {
                stealableResources.push(res as ResourceKey);
            }
        });
        
        if (stealableResources.length > 0) {
            const stolen = stealableResources[Phaser.Math.Between(0, stealableResources.length - 1)];
            target.resources[stolen]--;
            this.gameState.players[botIndex].resources[stolen]++;
            this.updateUIStats();
            console.log(`Bot ${botIndex} stole ${stolen} from ${target.name}`);
        }
    }

    private maybePlayBotDevCard(botIndex: number) {
        const bot = this.gameState.players[botIndex];
        if (bot.botDevCards.length === 0) return;
        
        const knightIndex = bot.botDevCards.indexOf('Knight');
        if (knightIndex >= 0) {
            bot.botDevCards.splice(knightIndex, 1);
            bot.devCards--;
            bot.playedKnights++;
            const targetHex = this.findBestRobberSpot(botIndex);
            this.moveRobber(targetHex);
            this.maybeBotSteal(botIndex, targetHex);
            this.checkLargestArmy();
            return;
        }
    }

    private maybeBotTradeWithBank(botIndex: number) {
        const resources: ResourceKey[] = ['log', 'brick', 'sheep', 'wheat', 'stone'];
        const buildNeeds = this.getBotBuildNeeds(botIndex);
        
        buildNeeds.forEach(need => {
            resources.forEach(res => {
                const ratio = this.getBankTradeRatio(res, botIndex);
                if (this.gameState.players[botIndex].resources[res] >= ratio) {
                    this.gameState.players[botIndex].resources[res] -= ratio;
                    this.gameState.players[botIndex].resources[need] += 1;
                    this.updateUIStats();
                    console.log(`Bot ${botIndex} traded ${ratio} ${res} for 1 ${need} at bank`);
                }
            });
        });
    }

    private getBotBuildNeeds(botIndex: number): ResourceKey[] {
        const bot = this.gameState.players[botIndex];
        const needs: ResourceKey[] = [];
        
        const canBuildCity = bot.resources.wheat >= 2 && bot.resources.stone >= 3;
        const canBuildSettlement = bot.resources.log >= 1 && bot.resources.brick >= 1 && bot.resources.wheat >= 1 && bot.resources.sheep >= 1;
        const canBuildRoad = bot.resources.log >= 1 && bot.resources.brick >= 1;
        const canBuildDevCard = bot.resources.sheep >= 1 && bot.resources.wheat >= 1 && bot.resources.stone >= 1;
        
        if (canBuildCity) return []; 
        if (canBuildSettlement) return [];
        if (canBuildRoad) return [];
        if (canBuildDevCard) return [];
        
        if (bot.resources.wheat >= 1 && bot.resources.stone >= 2) needs.push('wheat', 'stone');
        if (bot.resources.log >= 1 && bot.resources.brick >= 1 && bot.resources.wheat >= 1) needs.push('sheep');
        if (bot.resources.log >= 1) needs.push('brick');
        if (bot.resources.sheep >= 1 && bot.resources.wheat >= 1) needs.push('stone');
        
        return [...new Set(needs)];
    }

    private botBuildPhase(botIndex: number) {
        let built = false;
        let actionCount = 0;
        while (actionCount < 8) {
            const action = this.botTryBuildCity(botIndex) || this.botTryBuildSettlement(botIndex) ||
                this.botTryBuildRoad(botIndex) || this.botTryBuyDevCard(botIndex);
            if (!action) break;
            built = true;
            actionCount++;
        }

        if (built) {
            this.checkLongestRoad();
            this.checkLargestArmy();
            this.updateUIStats();
        }
    }

    private botTryBuildCity(botIndex: number): boolean {
        const bot = this.gameState.players[botIndex];
        if (bot.resources.wheat < 2 || bot.resources.stone < 3) return false;
        
        const settlements = this.intersections.filter(i => i.owner === botIndex && i.type === 'SETTLEMENT');
        if (settlements.length === 0) return false;
        
        const settlement = settlements.sort((a, b) => this.scoreIntersection(b) - this.scoreIntersection(a))[0];
        
        bot.resources.wheat -= 2;
        bot.resources.stone -= 3;
        settlement.type = 'CITY';
        if (settlement.buildingSprite && settlement.buildingSprite.active) {
            settlement.buildingSprite.destroy();
        }
        settlement.buildingSprite = this.drawCity(settlement.x, settlement.y, bot.colorHex);
        bot.points += 1;
        
        console.log(`Bot ${botIndex} built a City!`);
        return true;
    }

    private botTryBuildSettlement(botIndex: number): boolean {
        const bot = this.gameState.players[botIndex];
        if (bot.resources.log < 1 || bot.resources.brick < 1 || bot.resources.wheat < 1 || bot.resources.sheep < 1) return false;
        
        const myRoads = this.edges.filter(e => e.owner === botIndex);
        const validSpots = this.intersections.filter(int => {
            if (int.owner !== null) return false;
            if (this.hasAdjacentBuilding(int)) return false;
            return myRoads.some(road => this.edgeTouchesIntersection(road, int));
        });
        
        if (validSpots.length === 0) return false;
        
        const bestSpot = validSpots.sort((a, b) => this.scoreIntersection(b) - this.scoreIntersection(a))[0];
        
        bot.resources.log -= 1;
        bot.resources.brick -= 1;
        bot.resources.wheat -= 1;
        bot.resources.sheep -= 1;
        bestSpot.owner = botIndex;
        bestSpot.type = 'SETTLEMENT';
        bestSpot.buildingSprite = this.drawSettlement(bestSpot.x, bestSpot.y, bot.colorHex);
        bot.points += 1;
        
        console.log(`Bot ${botIndex} built a Settlement!`);
        return true;
    }

    private botTryBuildRoad(botIndex: number): boolean {
        const bot = this.gameState.players[botIndex];
        if (bot.resources.log < 1 || bot.resources.brick < 1) return false;
        
        const mySettlements = this.intersections.filter(i => i.owner === botIndex);
        const myRoads = this.edges.filter(e => e.owner === botIndex);
        
        const validSpots = this.edges.filter(edge => {
            if (edge.owner !== null) return false;
            const touchesMySettlement = mySettlements.some(s => this.edgeTouchesIntersection(edge, s));
            const touchesMyRoad = myRoads.some(r => this.edgesAreAdjacent(edge, r));
            return touchesMySettlement || touchesMyRoad;
        });
        
        if (validSpots.length === 0) return false;
        
        let bestRoad = validSpots[0];
        let bestScore = -1;
        
        validSpots.forEach(road => {
            let score = 0;
            [road.x1, road.x2].forEach((x, idx) => {
                const y = idx === 0 ? road.y1 : road.y2;
                const nearbyInt = this.intersections.find(i => 
                    i.owner === null && !this.hasAdjacentBuilding(i) && 
                    Phaser.Math.Distance.Between(i.x, i.y, x, y) < 10
                );
                if (nearbyInt) {
                    this.hexes.forEach(hex => {
                        if (hex.resource && !hex.hasRobber && Phaser.Math.Distance.Between(hex.x, hex.y, nearbyInt.x, nearbyInt.y) < 70) {
                            score += this.getNumberProbability(hex.numberToken || 0);
                        }
                    });
                }
            });
            
            if (score > bestScore) {
                bestScore = score;
                bestRoad = road;
            }
        });
        
        bot.resources.log -= 1;
        bot.resources.brick -= 1;
        bestRoad.owner = botIndex;
        this.drawRoad(bestRoad.cx, bestRoad.cy, bestRoad.angle, bot.colorHex);
        
        console.log(`Bot ${botIndex} built a Road!`);
        return true;
    }

    private botTryBuyDevCard(botIndex: number): boolean {
        const bot = this.gameState.players[botIndex];
        if (this.gameState.bankDevCards <= 0) return false;
        if (bot.resources.sheep < 1 || bot.resources.wheat < 1 || bot.resources.stone < 1) return false;
        
        bot.resources.sheep -= 1;
        bot.resources.wheat -= 1;
        bot.resources.stone -= 1;
        this.gameState.bankDevCards--;
        bot.devCards++;
        
        const card = this.gameState.devDeck.pop()!;
        bot.botDevCards.push(card);
        if (card === 'Victory Point') {
            bot.hiddenVictoryPoints += 1;
        }
        
        this.updateBankDisplay();
        console.log(`Bot ${botIndex} bought a Dev Card: ${card}!`);
        return true;
    }

    private scoreIntersection(spot: Intersection): number {
        const seenResources = new Set<string>();
        let score = 0;
        this.hexes.forEach(hex => {
            if (hex.resource && !hex.hasRobber && Phaser.Math.Distance.Between(hex.x, hex.y, spot.x, spot.y) < 70) {
                score += this.getNumberProbability(hex.numberToken || 0);
                seenResources.add(hex.resource);
            }
        });
        this.ports.forEach(port => {
            if (port.intersectionIndices.includes(this.intersections.indexOf(spot))) score += port.resource ? 3 : 2;
        });
        return score + seenResources.size * 1.5;
    }

    private getNumberProbability(num: number): number {
        const probs: Record<number, number> = {
            2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1
        };
        return probs[num] || 0;
    }

    private prepareRobberMovement() {
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];

        this.hexes.forEach(hex => {
            if (!hex.hasRobber) {
                const spot = this.add.circle(hex.x, hex.y, 25, 0x000000, 0.5);
                spot.setInteractive({ useHandCursor: true });
                spot.on('pointerover', () => spot.setFillStyle(0xcc0000, 0.7));
                spot.on('pointerout', () => spot.setFillStyle(0x000000, 0.5));
                spot.on('pointerdown', () => {
                    this.moveRobber(hex);
                    this.interactiveSpots.forEach(s => s.destroy());
                    this.interactiveSpots = [];
                    this.prepareHumanSteal(hex);
                });
                this.boardContainer.add(spot);
                this.interactiveSpots.push(spot);
            }
        });
    }

    private moveRobber(targetHex: HexData) {
        const oldHex = this.hexes.find(h => h.hasRobber);
        if (oldHex) oldHex.hasRobber = false;
        
        targetHex.hasRobber = true;
        
        this.tweens.add({
            targets: this.robberGraphics,
            x: targetHex.x,
            y: targetHex.y,
            duration: 400,
            ease: 'Power2'
        });
    }

    private prepareHumanSteal(hex: HexData) {
        const targets = [...new Set(this.intersections
            .filter(int => int.owner !== null && int.owner !== this.myPlayerIndex && Phaser.Math.Distance.Between(hex.x, hex.y, int.x, int.y) < 70)
            .map(int => int.owner as number))];
        if (targets.length === 0) {
            this.gameState.turnPhase = 'TRADE_BUILD';
            this.refreshAllButtonStates();
        } else if (targets.length === 1) {
            this.stealFromPlayer(targets[0]);
        } else {
            this.showStealChoices(targets);
        }
    }

    private stealFromPlayer(targetPlayer: number) {
        const target = this.gameState.players[targetPlayer];
        const resources: ResourceKey[] = [];
        (['log', 'brick', 'sheep', 'wheat', 'stone'] as ResourceKey[]).forEach(resource => {
            for (let count = 0; count < target.resources[resource]; count++) resources.push(resource);
        });
        if (resources.length > 0) {
            const resource = resources[Phaser.Math.Between(0, resources.length - 1)];
            target.resources[resource]--;
            this.gameState.players[this.myPlayerIndex].resources[resource]++;
            this.showBuildError(`You stole ${resource} from ${target.name}.`);
            this.updateUIStats();
        }
        this.gameState.turnPhase = 'TRADE_BUILD';
        this.refreshAllButtonStates();
    }

    private showStealChoices(targets: number[]) {
        const width = this.scale.width;
        const height = this.scale.height;
        this.stealModalUI = this.add.container(0, 0).setDepth(3500);
        this.stealModalUI.add(this.add.rectangle(width / 2, height / 2, width, height, 0x08131c, 0.65).setInteractive());
        this.stealModalUI.add(this.add.text(width / 2, height / 2 - 110, 'CHOOSE A PLAYER TO ROB', { fontSize: '26px', color: '#f7e4bd', fontStyle: 'bold' }).setOrigin(0.5));
        targets.forEach((targetPlayer, index) => {
            const target = this.gameState.players[targetPlayer];
            const button = this.createInGameActionButton(width / 2, height / 2 - 35 + index * 68, 260, 48, target.name, target.colorHex, () => {
                this.stealModalUI.destroy();
                this.stealFromPlayer(targetPlayer);
            });
            this.stealModalUI.add(button);
        });
    }

    private createInGameActionButton(x: number, y: number, width: number, height: number, label: string, color: number, action: () => void) {
        const button = this.add.container(x, y);
        const background = this.add.graphics();
        background.fillStyle(color, 1);
        background.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
        background.lineStyle(2, 0xf7e4bd, 0.9);
        background.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
        button.add(background);
        button.add(this.add.text(0, 0, label, { fontSize: '17px', color: '#fff8e7', fontStyle: 'bold' }).setOrigin(0.5));
        background.setInteractive(new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height), Phaser.Geom.Rectangle.Contains);
        background.on('pointerdown', action);
        return button;
    }

    private prepareDiscardPhase() {
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];

        const player = this.gameState.players[this.myPlayerIndex];
        const totalCards = Object.values(player.resources).reduce((a, b) => a + b, 0);
        const discardCount = Math.floor(totalCards / 2);

        const panel = this.add.container(0, 0);
        panel.setDepth(100);
        
        const bg = this.add.graphics();
        this.drawWoodenPanel(-200, -150, 400, 300, bg);
        panel.add(bg);

        const title = this.add.text(0, -130, `Discard ${discardCount} cards`, {
            fontSize: '20px', color: '#3e2723', fontStyle: 'bold'
        }).setOrigin(0.5);
        panel.add(title);

        const resources: ResourceKey[] = ['log', 'brick', 'sheep', 'wheat', 'stone'];
        let discarded = 0;
        const discardCounts: Record<ResourceKey, number> = { log: 0, brick: 0, sheep: 0, wheat: 0, stone: 0 };

        const resourceTexts: Record<ResourceKey, Phaser.GameObjects.Text> = {} as any;

        resources.forEach((res, idx) => {
            const y = -80 + idx * 45;
            
            const icon = this.add.image(-150, y, res);
            icon.setDisplaySize(30, 30);
            panel.add(icon);

            const countText = this.add.text(-110, y, `x${player.resources[res]}`, {
                fontSize: '18px', color: '#3e2723', fontStyle: 'bold'
            }).setOrigin(0, 0.5);
            panel.add(countText);
            resourceTexts[res] = countText;

            const minusBtn = this.add.circle(-30, y, 15, 0x8B5A2B, 1);
            minusBtn.setInteractive({ useHandCursor: true });
            minusBtn.on('pointerdown', () => {
                if (discardCounts[res] > 0) {
                    discardCounts[res]--;
                    discarded--;
                    player.resources[res]++;
                    countText.setText(`x${player.resources[res]}`);
                    updateDoneButton();
                }
            });
            panel.add(minusBtn);
            panel.add(this.add.text(-30, y, '-', { fontSize: '20px', color: '#fff' }).setOrigin(0.5));

            const plusBtn = this.add.circle(30, y, 15, 0x8B5A2B, 1);
            plusBtn.setInteractive({ useHandCursor: true });
            plusBtn.on('pointerdown', () => {
                if (player.resources[res] > 0 && discarded < discardCount) {
                    discardCounts[res]++;
                    discarded++;
                    player.resources[res]--;
                    countText.setText(`x${player.resources[res]}`);
                    updateDoneButton();
                }
            });
            panel.add(plusBtn);
            panel.add(this.add.text(30, y, '+', { fontSize: '20px', color: '#fff' }).setOrigin(0.5));

            const discardText = this.add.text(90, y, '0', {
                fontSize: '18px', color: '#cc0000', fontStyle: 'bold'
            }).setOrigin(0.5);
            panel.add(discardText);
            
            plusBtn.on('pointerdown', () => {
                discardText.setText(discardCounts[res].toString());
            });
            minusBtn.on('pointerdown', () => {
                discardText.setText(discardCounts[res].toString());
            });
        });

        const doneBtn = this.add.graphics();
        const doneText = this.add.text(0, 110, 'DONE', {
            fontSize: '18px', color: '#3e2723', fontStyle: 'bold'
        }).setOrigin(0.5);
        panel.add(doneText);
        
        const doneHitArea = this.add.rectangle(0, 110, 120, 40, 0x000000, 0);
        doneHitArea.setInteractive({ useHandCursor: true });
        panel.add(doneHitArea);

        const updateDoneButton = () => {
            doneBtn.clear();
            if (discarded === discardCount) {
                doneBtn.fillStyle(0x4CAF50, 1);
                doneHitArea.setInteractive({ useHandCursor: true });
            } else {
                doneBtn.fillStyle(0x8B5A2B, 0.5);
                doneHitArea.disableInteractive();
            }
            doneBtn.fillRoundedRect(-60, 90, 120, 40, 8);
            doneBtn.lineStyle(2, 0x3e2723, 1);
            doneBtn.strokeRoundedRect(-60, 90, 120, 40, 8);
        };
        updateDoneButton();

        doneHitArea.on('pointerdown', () => {
            if (discarded === discardCount) {
                panel.destroy();
                this.interactiveSpots = [];
                
                this.gameState.turnPhase = 'MOVE_ROBBER';
                this.showBuildError('Now move the robber.');
                this.prepareRobberMovement();
            }
        });

        this.boardContainer.add(panel);
        this.interactiveSpots.push(panel);
    }

    private generateSetupBanner(width: number) {
        this.setupBannerContainer = this.add.container(width / 2, 60);
        const bg = this.add.graphics();
        this.drawParchmentPanel(-200, -30, 400, 60, bg);
        this.setupBannerContainer.add(bg);

        this.setupBannerText = this.add.text(0, 0, '', {
            fontSize: '18px', color: '#3e2723', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.setupBannerContainer.add(this.setupBannerText);
        
        this.updateSetupBanner();
    }

    private updateSetupBanner() {
        if (!this.setupBannerText) return;
        const count = this.gameState.setupState.count + 1;
        if (this.gameState.setupState.phase === 'SETTLEMENT') {
            this.setupBannerText.setText(`SETUP PHASE: Place a Settlement (${count}/2)`);
        } else if (this.gameState.setupState.phase === 'ROAD') {
            this.setupBannerText.setText(`SETUP PHASE: Build a Road (${count}/2)`);
        }
    }

    private generateHelpButton() {
        this.helpButtonUI = this.add.container(0, 0);

        const button = this.add.graphics();
        button.fillStyle(0x7ec8ff, 1);
        button.fillCircle(0, 0, 24);
        button.lineStyle(4, 0xffffff, 1);
        button.strokeCircle(0, 0, 24);
        this.helpButtonUI.add(button);

        const qMark = this.add.text(0, 0, '?', {
            fontSize: '30px', color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.helpButtonUI.add(qMark);

        const hitArea = this.add.circle(0, 0, 24, 0x000000, 0);
        hitArea.setInteractive({ useHandCursor: true });
        hitArea.on('pointerdown', () => this.toggleRulesManual());
        this.helpButtonUI.add(hitArea);

        this.rulesModalUI = this.add.container(0, 0);
        this.rulesModalUI.setDepth(2000);
        this.rulesModalUI.setVisible(false);
    }

    private generateSettingsButton() {
        this.settingsButtonUI = this.add.container(0, 0).setDepth(1500);
        const button = this.add.graphics();
        button.fillStyle(0x243447, 0.95);
        button.fillCircle(0, 0, 22);
        button.lineStyle(2, 0xd9b36c, 1);
        button.strokeCircle(0, 0, 22);
        this.settingsButtonUI.add(button);

        const gear = this.add.text(0, -1, '⚙', { fontSize: '25px', color: '#f7e4bd' }).setOrigin(0.5);
        this.settingsButtonUI.add(gear);
        const hitArea = this.add.circle(0, 0, 24, 0x000000, 0);
        hitArea.setInteractive({ useHandCursor: true });
        hitArea.on('pointerdown', () => this.toggleSettingsModal());
        this.settingsButtonUI.add(hitArea);

        this.settingsModalUI = this.add.container(0, 0).setDepth(3000).setVisible(false);
    }

    private generateDevelopmentButton() {
        this.developmentButtonUI = this.add.dom(0, 0, 'button',
            'width: 44px; height: 44px; padding: 0; border: 2px solid #d9b36c; border-radius: 50%; background: #8f5b2f; color: #f7e4bd; font: bold 25px Georgia; cursor: pointer; pointer-events: auto;',
            '✦');
        this.developmentButtonUI.setDepth(6000);
        this.developmentButtonUI.node.setAttribute('title', 'End development phase');
        this.developmentButtonUI.node.addEventListener('click', () => this.finishDevelopmentPhase());
    }

    private finishDevelopmentPhase() {
        if (this.victoryModalUI) return;
        const winnerId = Phaser.Math.Between(0, this.gameState.players.length - 1);
        this.gameState.players[winnerId].points += 10;
        this.updateUIStats();
        this.showVictory(winnerId);
    }

    private createMenuButton(x: number, y: number, width: number, height: number, label: string, color: number, action: () => void) {
        const button = this.add.container(x, y);
        const bg = this.add.graphics();
        bg.fillStyle(color, 1);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
        bg.lineStyle(2, 0xf7e4bd, 0.8);
        bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
        button.add(bg);
        button.add(this.add.text(0, 0, label, { fontSize: '17px', color: '#fff8e7', fontStyle: 'bold' }).setOrigin(0.5));
        bg.setInteractive(new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height), Phaser.Geom.Rectangle.Contains);
        bg.on('pointerover', () => bg.setAlpha(0.82));
        bg.on('pointerout', () => bg.setAlpha(1));
        bg.on('pointerdown', action);
        return button;
    }

    private toggleSettingsModal() {
        const shouldOpen = !this.settingsModalUI.visible;
        if (shouldOpen) this.renderSettingsModal();
        this.settingsModalUI.setVisible(shouldOpen);
    }

    private renderSettingsModal() {
        const width = this.scale.width;
        const height = this.scale.height;
        this.settingsModalUI.removeAll(true);
        const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x08131c, 0.7).setInteractive();
        overlay.on('pointerdown', () => this.settingsModalUI.setVisible(false));
        this.settingsModalUI.add(overlay);
        const panelWidth = Math.min(420, width - 40);
        const panelHeight = 330;
        const panelX = width / 2 - panelWidth / 2;
        const panelY = height / 2 - panelHeight / 2;
        const panel = this.add.graphics();
        this.drawWoodenPanel(panelX, panelY, panelWidth, panelHeight, panel);
        this.drawParchmentPanel(panelX + 12, panelY + 12, panelWidth - 24, panelHeight - 24, panel);
        this.settingsModalUI.add(panel);
        this.settingsModalUI.add(this.add.text(width / 2, panelY + 52, 'SETTINGS', { fontSize: '30px', color: '#243447', fontStyle: 'bold' }).setOrigin(0.5));
        this.settingsModalUI.add(this.createMenuButton(width / 2, panelY + 135, 230, 50, 'RESUME GAME', 0x2d6a5a, () => this.settingsModalUI.setVisible(false)));
        this.settingsModalUI.add(this.createMenuButton(width / 2, panelY + 205, 230, 50, 'MAIN MENU', 0x7a4d35, () => {
            this.scene.start('MainMenuScene');
        }));
        this.settingsModalUI.add(this.add.text(width / 2, panelY + 275, 'Current game will be abandoned', { fontSize: '13px', color: '#80644f', fontStyle: 'italic' }).setOrigin(0.5));
    }

    private toggleRulesManual() {
        const shouldOpen = !this.rulesModalUI.visible;
        if (shouldOpen) {
            this.renderRulesManual();
        } else {
            this.closeRulesManual();
        }
        this.rulesModalUI.setVisible(shouldOpen);
    }

    private closeRulesManual() {
        this.rulesModalUI.setVisible(false);
    }

    private renderRulesManual() {
        const width = this.scale.width;
        const height = this.scale.height;
        this.rulesModalUI.removeAll(true);

        const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55);
        overlay.setInteractive({ useHandCursor: true });
        overlay.on('pointerdown', () => this.closeRulesManual());
        this.rulesModalUI.add(overlay);

        const panelWidth = Math.min(900, width - 80);
        const panelHeight = Math.min(620, height - 80);
        const panelX = width / 2 - panelWidth / 2;
        const panelY = height / 2 - panelHeight / 2;

        const panel = this.add.graphics();
        this.drawWoodenPanel(panelX, panelY, panelWidth, panelHeight, panel);
        this.drawParchmentPanel(panelX + 16, panelY + 16, panelWidth - 32, panelHeight - 32, panel);
        this.rulesModalUI.add(panel);

        const title = this.add.text(width / 2, panelY + 38, 'CATAN MANUAL (QUICK RULES)', {
            fontSize: '30px', color: '#3e2723', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.rulesModalUI.add(title);

        const rulesText = [
            '1) TURA TA: Roll Dice -> Trade/Build -> End Turn.',
            '2) RESURSE: Se primesc de la hexuri cu numarul aruncat (oras = 2, settlement = 1).',
            '3) BUILD COSTS: Road(lemn+caramida), Settlement(lemn+caramida+lana+grau), City(2 grau+3 piatra), Dev Card(lana+grau+piatra).',
            '4) REGULI PLASARE:',
            '   - Settlement doar la distanta de cel putin 1 intersectie de alt settlement/oras.',
            '   - Settlement nou trebuie conectat la unul din drumurile tale.',
            '   - Road nou trebuie conectat la settlement/road de-al tau.',
            '5) PORTURI SI TRADE CU BANK:',
            '   - Standard: 4:1.',
            '   - Port generic (?): 3:1 pentru orice resursa.',
            '   - Port specializat (2:1): doar pentru resursa icon-ului portului.',
            '   - Jocul alege automat cel mai bun ratio activ in functie de asezarile tale pe porturi.',
            '6) DEV CARDS:',
            '   - Max 1 carte jucata pe tura.',
            '   - Nu poti juca in tura in care ai cumparat cartea.',
            '   - Victory Point este pasiva (nu se joaca manual).',
            '7) TITLURI SPECIALE: Longest Road (+2), Largest Army (+2).',
            '8) VICTORIE: primul la 10 puncte reale.'
        ].join('\n');

        const body = this.add.text(panelX + 36, panelY + 76, rulesText, {
            fontSize: '20px',
            color: '#3e2723',
            align: 'left',
            wordWrap: { width: panelWidth - 72 }
        });
        this.rulesModalUI.add(body);

        const closeBtn = this.add.circle(panelX + panelWidth - 28, panelY + 28, 15, 0x5C4033, 1);
        closeBtn.setInteractive({ useHandCursor: true });
        closeBtn.on('pointerdown', () => this.closeRulesManual());
        this.rulesModalUI.add(closeBtn);
        this.rulesModalUI.add(this.add.text(panelX + panelWidth - 28, panelY + 28, 'X', {
            fontSize: '16px', color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5));
    }

    private renderSetupSpots() {
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];

        if (this.gameState.turnPhase !== 'SETUP') return;
        if (this.network && this.gameState.currentPlayerIndex !== this.myPlayerIndex) return;

        const myIdx = this.myPlayerIndex;
        const playerColor = this.gameState.players[myIdx].colorHex;

        if (this.gameState.setupState.phase === 'SETTLEMENT') {
            this.intersections.forEach(int => {
                if (int.owner !== null) return;
                if (this.hasAdjacentBuilding(int)) return;
                
                const spot = this.add.circle(int.x, int.y, 14, 0xffffff, 0.6);
                spot.setInteractive({ useHandCursor: true });
                
                spot.on('pointerover', () => spot.setFillStyle(playerColor, 0.9));
                spot.on('pointerout', () => spot.setFillStyle(0xffffff, 0.6));
                
                spot.on('pointerdown', () => {
                    int.owner = myIdx;
                    int.type = 'SETTLEMENT';
                    int.buildingSprite = this.drawSettlement(int.x, int.y, playerColor);
                    this.gameState.players[myIdx].points += 1;
                    this.updateUIStats();
                    this.lastBuiltSettlement = int;
                    
                    if (this.gameState.setupState.count === 1) {
                        this.collectSetupResources(int);
                    }

                    if (this.network && this.network.isConnected()) {
                        this.network.send('SETUP_PLACEMENT', {
                            kind: 'settlement',
                            x: int.x,
                            y: int.y,
                            colorHex: playerColor,
                            owner: myIdx
                        });
                    }
                    
                    this.gameState.setupState.phase = 'ROAD';
                    this.updateSetupBanner();
                    this.renderSetupSpots();
                });
                
                this.buildingsContainer.add(spot);
                this.interactiveSpots.push(spot);
            });
        } 
        else if (this.gameState.setupState.phase === 'ROAD') {
            this.edges.forEach(edge => {
                if (edge.owner !== null) return;
                
                if (this.lastBuiltSettlement) {
                    const dist1 = Phaser.Math.Distance.Between(edge.x1, edge.y1, this.lastBuiltSettlement.x, this.lastBuiltSettlement.y);
                    const dist2 = Phaser.Math.Distance.Between(edge.x2, edge.y2, this.lastBuiltSettlement.x, this.lastBuiltSettlement.y);
                    if (dist1 > 10 && dist2 > 10) return; 
                }

                const spot = this.add.circle(edge.cx, edge.cy, 12, 0xffffff, 0.6);
                spot.setInteractive({ useHandCursor: true });
                
                spot.on('pointerover', () => spot.setFillStyle(playerColor, 0.9));
                spot.on('pointerout', () => spot.setFillStyle(0xffffff, 0.6));
                
                spot.on('pointerdown', () => {
                    edge.owner = myIdx;
                    this.drawRoad(edge.cx, edge.cy, edge.angle, playerColor);
                    
                    if (this.network && this.network.isConnected()) {
                        this.network.send('SETUP_PLACEMENT', {
                            kind: 'road',
                            cx: edge.cx,
                            cy: edge.cy,
                            angle: edge.angle,
                            colorHex: playerColor,
                            owner: myIdx
                        });
                    }
                    
                    this.gameState.setupState.count++;
                    
                    if (this.network && this.network.isConnected()) {
                        this.interactiveSpots.forEach(s => s.destroy());
                        this.interactiveSpots = [];
                        this.network.send('SETUP_DONE', { playerIndex: myIdx });
                        this.advanceMultiplayerSetup();
                        return;
                    }

                    if (this.gameState.setupState.count >= 2) {
                        this.gameState.setupState.phase = 'DONE';
                        if (this.setupBannerContainer) {
                            this.setupBannerContainer.destroy();
                        }
                        this.interactiveSpots.forEach(s => s.destroy());
                        this.startGameAfterSetup();
                    } else {
                        this.gameState.setupState.phase = 'SETTLEMENT';
                        this.runBotSetupPhase();
                    }
                });

                this.buildingsContainer.add(spot);
                this.interactiveSpots.push(spot);
            });
        }
    }

    private drawSettlement(x: number, y: number, colorHex: number): Phaser.GameObjects.Graphics {
        const iconGraphics = this.add.graphics();
        iconGraphics.fillStyle(colorHex, 1);
        iconGraphics.fillRect(x - 10, y - 6, 20, 14);
        iconGraphics.fillTriangle(x - 10, y - 6, x + 10, y - 6, x, y - 16);
        iconGraphics.lineStyle(2, 0x3e2723, 1);
        iconGraphics.strokeRect(x - 10, y - 6, 20, 14);
        iconGraphics.strokeTriangle(x - 10, y - 6, x + 10, y - 6, x, y - 16);
        this.buildingsContainer.add(iconGraphics);
        
        iconGraphics.setScale(0);
        this.tweens.add({
            targets: iconGraphics,
            scale: 1,
            duration: 300,
            ease: 'Back.Out'
        });
        
        return iconGraphics;
    }

    private drawCity(x: number, y: number, colorHex: number): Phaser.GameObjects.Graphics {
        const graphics = this.add.graphics();
        graphics.fillStyle(colorHex, 1);
        graphics.fillRect(x - 12, y - 10, 24, 16);
        graphics.fillRect(x - 12, y - 20, 12, 10);
        graphics.fillTriangle(x - 12, y - 20, x, y - 20, x - 6, y - 28);
        graphics.lineStyle(2, 0x3e2723, 1);
        graphics.strokeRect(x - 12, y - 10, 24, 16);
        graphics.strokeRect(x - 12, y - 20, 12, 10);
        graphics.strokeTriangle(x - 12, y - 20, x, y - 20, x - 6, y - 28);
        this.buildingsContainer.add(graphics);
        
        graphics.setScale(0);
        this.tweens.add({
            targets: graphics,
            scale: 1,
            duration: 400,
            ease: 'Bounce.Out'
        });
        
        return graphics;
    }

    private drawRoad(cx: number, cy: number, angle: number, colorHex: number) {
        const container = this.add.container(cx, cy);
        const rect = this.add.graphics();
        rect.fillStyle(colorHex, 1);
        rect.fillRect(-18, -4, 36, 8);
        rect.lineStyle(2, 0x3e2723, 1);
        rect.strokeRect(-18, -4, 36, 8);
        container.add(rect);
        container.setRotation(angle);
        this.buildingsContainer.add(container);
        
        container.setAlpha(0);
        this.tweens.add({
            targets: container,
            alpha: 1,
            duration: 250,
            ease: 'Linear'
        });
    }

    private runBotSetupPhase() {
        this.gameState.currentPlayerIndex = 0;
        this.gameState.turnPhase = 'SETUP';
        this.gameState.botSetupState = { phase: 'SETTLEMENT', botIndex: 1, round: 0 };
        
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];
        
        if (this.setupBannerContainer) {
            this.setupBannerContainer.setVisible(false);
        }
        
        this.showSetupMessage(`Bots are setting up...`);
        this.processNextBotSetupStep();
    }

    private showSetupMessage(msg: string) {
        if (this.buildErrorText) {
            this.buildErrorText.destroy();
        }
        this.buildErrorText = this.add.text(this.scale.width / 2, 80, msg, {
            fontSize: '18px', color: '#3e2723', fontStyle: 'bold', align: 'center',
            stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5);
        this.buildErrorText.setDepth(100);
        this.time.delayedCall(2500, () => {
            if (this.buildErrorText) {
                this.buildErrorText.destroy();
                this.buildErrorText = null;
            }
        });
    }

    private resumeHumanSetup() {
        this.gameState.currentPlayerIndex = 0;
        this.gameState.turnPhase = 'SETUP';
        this.gameState.setupState.phase = 'SETTLEMENT';

        if (this.setupBannerContainer) {
            this.setupBannerContainer.setVisible(true);
        }
        this.updateSetupBanner();
        this.renderSetupSpots();
        this.refreshAllButtonStates();
    }

    private startGameAfterSetup() {
        this.gameState.turnOrder = Phaser.Utils.Array.Shuffle(this.gameState.players.map(player => player.id));
        const humanPosition = this.gameState.turnOrder.indexOf(0);
        const openingBots = this.gameState.turnOrder.slice(0, humanPosition);
        let delay = 0;
        openingBots.forEach(botIndex => {
            delay += 3000;
            this.time.delayedCall(delay, () => {
                this.gameState.currentPlayerIndex = botIndex;
                this.gameState.turnPhase = 'ROLL';
                this.playBotTurn(botIndex);
            });
        });
        this.gameState.turnPhase = 'ROLL';
        this.gameState.currentPlayerIndex = openingBots.length ? openingBots[openingBots.length - 1] : 0;
        this.time.delayedCall(delay + (openingBots.length ? 3000 : 0), () => {
            this.gameState.currentPlayerIndex = 0;
            this.gameState.myTurnNumber += 1;
            this.gameState.playedDevCardThisTurn = false;
            this.refreshAllButtonStates();
            this.updateDiceVisuals();
        });
        this.refreshAllButtonStates();
        this.updateDiceVisuals();
    }

    private processNextBotSetupStep() {
        const setup = this.gameState.botSetupState;
        
        if (setup.phase === 'DONE') {
            this.resumeHumanSetup();
            return;
        }
        
        if (setup.phase === 'SETTLEMENT') {
            this.time.delayedCall(400, () => {
                this.botSetupPlaceSettlement(setup.botIndex);
            });
        } else if (setup.phase === 'ROAD') {
            this.time.delayedCall(400, () => {
                this.botSetupPlaceRoad(setup.botIndex);
            });
        }
    }

    private botSetupPlaceSettlement(botIndex: number) {
        const bot = this.gameState.players[botIndex];
        
        let bestSpot: Intersection | null = null;
        let bestScore = -1;
        
        this.intersections.forEach(int => {
            if (int.owner !== null) return;
            if (this.hasAdjacentBuilding(int)) return;
            
            let score = 0;
            this.hexes.forEach(hex => {
                if (hex.resource && !hex.hasRobber && Phaser.Math.Distance.Between(hex.x, hex.y, int.x, int.y) < 70) {
                    score += this.getNumberProbability(hex.numberToken || 0) * 2;
                }
            });
            
            this.ports.forEach(port => {
                if (port.intersectionIndices.includes(this.intersections.indexOf(int))) {
                    score += 4;
                }
            });
            
            if (score > bestScore) {
                bestScore = score;
                bestSpot = int;
            }
        });
        
        if (!bestSpot) {
            bestSpot = this.intersections.find(int => int.owner === null && !this.hasAdjacentBuilding(int)) || null;
        }
        
        if (bestSpot) {
            bestSpot.owner = botIndex;
            bestSpot.type = 'SETTLEMENT';
            bestSpot.buildingSprite = this.drawSettlement(bestSpot.x, bestSpot.y, bot.colorHex);
            bot.points += 1;
            
            if (this.gameState.botSetupState.round === 1) {
                this.collectBotSetupResources(bestSpot, botIndex);
            }
            
            this.lastBotSettlement = bestSpot;
            
            this.updateUIStats();
            
            this.gameState.botSetupState.phase = 'ROAD';
            this.processNextBotSetupStep();
        }
    }

    private collectBotSetupResources(settlement: Intersection, botIndex: number) {
        this.hexes.forEach(hex => {
            if (hex.resource && !hex.hasRobber && Phaser.Math.Distance.Between(hex.x, hex.y, settlement.x, settlement.y) < 70) {
                const resKey = hex.resource as keyof PlayerData['resources'];
                this.gameState.players[botIndex].resources[resKey] += 1;
            }
        });
        this.updateUIStats();
    }

    private botSetupPlaceRoad(botIndex: number) {
        const bot = this.gameState.players[botIndex];
        
        let validSpots = this.edges.filter(edge => {
            if (edge.owner !== null) return false;
            if (this.lastBotSettlement) {
                return this.edgeTouchesIntersection(edge, this.lastBotSettlement);
            }
            return false;
        });
        
        if (validSpots.length === 0) {
            const mySettlements = this.intersections.filter(i => i.owner === botIndex);
            const myRoads = this.edges.filter(e => e.owner === botIndex);
            validSpots = this.edges.filter(edge => {
                if (edge.owner !== null) return false;
                return mySettlements.some(s => this.edgeTouchesIntersection(edge, s)) ||
                       myRoads.some(r => this.edgesAreAdjacent(edge, r));
            });
        }
        
        if (validSpots.length > 0) {
            let bestRoad = validSpots[0];
            let bestScore = -1;
            
            validSpots.forEach(road => {
                let score = 0;
                [road.x1, road.x2].forEach((x, idx) => {
                    const y = idx === 0 ? road.y1 : road.y2;
                    const nearbyInt = this.intersections.find(i => 
                        i.owner === null && !this.hasAdjacentBuilding(i) && 
                        Phaser.Math.Distance.Between(i.x, i.y, x, y) < 10
                    );
                    if (nearbyInt) {
                        this.hexes.forEach(hex => {
                            if (hex.resource && !hex.hasRobber && Phaser.Math.Distance.Between(hex.x, hex.y, nearbyInt.x, nearbyInt.y) < 70) {
                                score += this.getNumberProbability(hex.numberToken || 0);
                            }
                        });
                    }
                });
                if (score > bestScore) {
                    bestScore = score;
                    bestRoad = road;
                }
            });
            
            bestRoad.owner = botIndex;
            this.drawRoad(bestRoad.cx, bestRoad.cy, bestRoad.angle, bot.colorHex);
            console.log(`Bot ${botIndex} placed a road in setup`);
        }
        
        const setup = this.gameState.botSetupState;
        const nextBot = setup.botIndex + (setup.round === 0 ? 1 : -1);
        
        if (setup.round === 0) {
            if (nextBot >= this.gameState.players.length) {
                setup.round = 1;
                setup.botIndex = this.gameState.players.length - 1;
            } else {
                setup.botIndex = nextBot;
            }
            setup.phase = 'SETTLEMENT';
        } else {
            if (nextBot < 1) {
                setup.phase = 'DONE';
            } else {
                setup.botIndex = nextBot;
                setup.phase = 'SETTLEMENT';
            }
        }
        
        this.processNextBotSetupStep();
    }

    private collectSetupResources(settlement: Intersection) {
        this.hexes.forEach(hex => {
            if (hex.resource && !hex.hasRobber && Phaser.Math.Distance.Between(hex.x, hex.y, settlement.x, settlement.y) < 70) {
                const resKey = hex.resource as keyof PlayerData['resources'];
                this.gameState.players[this.myPlayerIndex].resources[resKey] += 1;
            }
        });
        this.updateUIStats();
        this.showBuildError('2nd Settlement placed! Collected starting resources.');
    }

    private generateDiceUI() {
        const bg = this.add.graphics();
        this.drawWoodenPanel(-90, -45, 180, 90, bg);
        this.diceUI.add(bg);

        this.rollDiceBg = this.add.graphics();
        this.rollDiceBg.fillStyle(0x3e2723, 1);
        this.rollDiceBg.fillRoundedRect(-70, -20, 140, 40, 8);
        this.diceUI.add(this.rollDiceBg);

        this.rollDiceText = this.add.text(0, 0, 'ROLL DICE', {
            fontSize: '13px', color: '#DEB887', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.diceUI.add(this.rollDiceText);

        this.rollDiceHitArea = this.add.rectangle(0, 0, 140, 40, 0x000000, 0);
        this.rollDiceHitArea.setInteractive({ useHandCursor: true });
        this.rollDiceHitArea.on('pointerdown', () => this.rollDice());
        this.diceUI.add(this.rollDiceHitArea);

        this.turnIndicatorText = this.add.text(0, -38, '', {
            fontSize: '12px', color: '#3e2723', fontStyle: 'bold', align: 'center',
            stroke: '#FFF8DC', strokeThickness: 2
        }).setOrigin(0.5);
        this.diceUI.add(this.turnIndicatorText);

        this.updateDiceVisuals();
    }

    private updateDiceVisuals() {
        const existingDice = this.diceUI.getAll('name', 'dice-visual');
        existingDice.forEach(d => d.destroy());

        const isRollingPhaseForMe = this.isMyTurnAndPhase('ROLL');
        const isSetupPhase = this.gameState.turnPhase === 'SETUP';

        if (this.turnIndicatorText) {
            const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
            if (isSetupPhase) {
                this.turnIndicatorText.setText('SETUP PHASE');
                this.turnIndicatorText.setColor('#cc0000');
            } else if (this.gameState.currentPlayerIndex === this.myPlayerIndex) {
                this.turnIndicatorText.setText('YOUR TURN');
                this.turnIndicatorText.setColor('#1b5e20');
            } else {
                this.turnIndicatorText.setText(`${currentPlayer.name.toUpperCase()}'S TURN`);
                this.turnIndicatorText.setColor('#cc0000');
            }
        }

        if (isSetupPhase) {
            this.rollDiceBg.setVisible(false);
            this.rollDiceText.setVisible(false);
            this.rollDiceHitArea.disableInteractive();
        } else if (isRollingPhaseForMe) {
            this.rollDiceBg.setVisible(true);
            this.rollDiceText.setVisible(true);
            this.rollDiceHitArea.setInteractive({ useHandCursor: true });
        } else {
            this.rollDiceBg.setVisible(false);
            this.rollDiceText.setVisible(false);
            this.rollDiceHitArea.disableInteractive();

            const drawDie = (x: number, y: number, value: number, isRed: boolean) => {
                const dieContainer = this.add.container(x, y);
                dieContainer.setName('dice-visual');

                const dieGraphics = this.add.graphics();
                dieGraphics.fillStyle(isRed ? 0xcc0000 : 0xffffff, 1);
                dieGraphics.fillRoundedRect(-18, -18, 36, 36, 6);
                dieGraphics.lineStyle(2, 0x111111, 1);
                dieGraphics.strokeRoundedRect(-18, -18, 36, 36, 6);
                dieContainer.add(dieGraphics);

                const dieText = this.add.text(0, 0, value.toString(), {
                    fontSize: '22px', color: isRed ? '#ffffff' : '#000000', fontStyle: 'bold'
                }).setOrigin(0.5);
                dieContainer.add(dieText);

                this.diceUI.add(dieContainer);
            };

            drawDie(-22, 5, this.gameState.lastDice.d1, false);
            drawDie(22, 5, this.gameState.lastDice.d2, true); 

            const totalText = this.add.text(0, -30, `Rolled: ${this.gameState.lastDice.total}`, {
                fontSize: '16px', color: '#3e2723', fontStyle: 'bold'
            }).setOrigin(0.5);
            totalText.setName('dice-visual');
            this.diceUI.add(totalText);
        }
    }

    private endTurnHitArea!: Phaser.GameObjects.Rectangle;
    private endTurnBtnGraphics!: Phaser.GameObjects.Graphics;

    private generateEndTurnUI() {
        this.endTurnBtnGraphics = this.add.graphics();
        
        const drawButton = (isHover: boolean) => {
            this.endTurnBtnGraphics.clear();
            this.endTurnBtnGraphics.fillStyle(isHover ? 0x3e2723 : 0x5C4033, 1); 
            this.endTurnBtnGraphics.fillRoundedRect(-30, -30, 60, 60, 10);
            this.endTurnBtnGraphics.lineStyle(3, isHover ? 0xDEB887 : 0x8B5A2B, 1);
            this.endTurnBtnGraphics.strokeRoundedRect(-30, -30, 60, 60, 10);
            
            this.endTurnBtnGraphics.fillStyle(0xDEB887, 1);
            this.endTurnBtnGraphics.fillTriangle(-14, -12, 1, 0, -14, 12); 
            this.endTurnBtnGraphics.fillTriangle(1, -12, 16, 0, 1, 12);  
        };

        drawButton(false);
        this.endTurnUI.add(this.endTurnBtnGraphics);

        this.endTurnHitArea = this.add.rectangle(0, 0, 60, 60, 0x000000, 0);
        
        this.endTurnHitArea.on('pointerdown', () => this.endTurn());
        this.endTurnHitArea.on('pointerover', () => {
            if(this.isMyTurnAndPhase('TRADE_BUILD')) drawButton(true);
        });
        this.endTurnHitArea.on('pointerout', () => {
            if(this.isMyTurnAndPhase('TRADE_BUILD')) drawButton(false);
        });

        this.endTurnUI.add(this.endTurnHitArea);
    }

    private generateBuildMenu() {
        const bg = this.add.graphics();
        this.drawWoodenPanel(0, 0, 360, 240, bg);
        this.bottomLeftUI.add(bg);

        const title = this.add.text(180, 20, '- BUILD -', {
            fontSize: '18px', color: '#3e2723', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.bottomLeftUI.add(title);

        const hoverGraphics = this.add.graphics();
        this.bottomLeftUI.add(hoverGraphics);

        const resourceNamesEN: Record<string, string> = {
            log: 'Lumber', brick: 'Brick', sheep: 'Wool', wheat: 'Grain', stone: 'Ore'
        };

        const createBuildRow = (y: number, name: string, costs: {key: string, qty: number}[]) => {
            const line = this.add.graphics();
            line.lineStyle(2, 0x8B5A2B, 0.3);
            line.beginPath();
            line.moveTo(20, y - 20);
            line.lineTo(340, y - 20);
            line.strokePath();
            this.bottomLeftUI.add(line);

            const iconGraphics = this.add.graphics();
            if (name === 'Road') {
                iconGraphics.fillStyle(0x8B5A2B, 1);
                iconGraphics.fillRect(20, y - 6, 22, 8);
                iconGraphics.lineStyle(1, 0x3e2723, 1);
                iconGraphics.strokeRect(20, y - 6, 22, 8);
            } else if (name === 'Settlement') {
                iconGraphics.fillStyle(0xcc0000, 1);
                iconGraphics.fillRect(22, y - 4, 16, 12);
                iconGraphics.fillTriangle(22, y - 4, 38, y - 4, 30, y - 12);
                iconGraphics.lineStyle(1, 0x3e2723, 1);
                iconGraphics.strokeRect(22, y - 4, 16, 12);
                iconGraphics.strokeTriangle(22, y - 4, 38, y - 4, 30, y - 12);
            } else if (name === 'City') {
                iconGraphics.fillStyle(0xcc0000, 1);
                iconGraphics.fillRect(20, y - 2, 24, 12); 
                iconGraphics.fillRect(20, y - 12, 12, 10); 
                iconGraphics.fillTriangle(20, y - 12, 32, y - 12, 26, y - 20); 
                iconGraphics.lineStyle(1, 0x3e2723, 1);
                iconGraphics.strokeRect(20, y - 2, 24, 12);
                iconGraphics.strokeRect(20, y - 12, 12, 10);
                iconGraphics.strokeTriangle(20, y - 12, 32, y - 12, 26, y - 20);
            } else if (name === 'Dev Card') {
                iconGraphics.fillStyle(0xFFF8DC, 1);
                iconGraphics.fillRect(22, y - 14, 18, 24);
                iconGraphics.lineStyle(2, 0x3e2723, 1);
                iconGraphics.strokeRect(22, y - 14, 18, 24);
                iconGraphics.fillStyle(0x3e2723, 1);
                iconGraphics.fillCircle(31, y - 2, 4); 
            }
            this.bottomLeftUI.add(iconGraphics);

            const nameText = this.add.text(55, y, name, {
                fontSize: '15px', color: '#3e2723', fontStyle: 'bold'
            }).setOrigin(0, 0.5);
            this.bottomLeftUI.add(nameText);

            let startX = 160;
            costs.forEach(cost => {
                const icon = this.add.image(startX, y, cost.key);
                icon.setDisplaySize(20, 20);
                this.bottomLeftUI.add(icon);

                const qtyText = this.add.text(startX + 12, y, `x${cost.qty}`, {
                    fontSize: '12px', color: '#3e2723', fontStyle: 'bold'
                }).setOrigin(0, 0.5);
                this.bottomLeftUI.add(qtyText);

                startX += 40; 
            });

            const hitArea = this.add.rectangle(180, y, 320, 36, 0x000000, 0);
            hitArea.setInteractive({ useHandCursor: true });
            
            hitArea.on('pointerover', () => {
                if(this.isMyTurnAndPhase('TRADE_BUILD')) {
                    hoverGraphics.clear();
                    hoverGraphics.fillStyle(0x000000, 0.15);
                    hoverGraphics.fillRoundedRect(15, y - 18, 330, 36, 6);
                }
            });
            hitArea.on('pointerout', () => hoverGraphics.clear());

            hitArea.on('pointerdown', () => {
                if(!this.isMyTurnAndPhase('TRADE_BUILD')) {
                    this.showBuildError(`You can only build during your turn!`);
                    return;
                }

                const myRes = this.gameState.players[this.myPlayerIndex].resources;
                const missing: string[] = [];

                costs.forEach(cost => {
                    const available = myRes[cost.key as keyof typeof myRes];
                    if (available < cost.qty) {
                        missing.push(`${cost.qty - available}x ${resourceNamesEN[cost.key]}`);
                    }
                });

                if (missing.length > 0) {
                    this.showBuildError(`Cannot build: ${name}\nMissing: ${missing.join(', ')}`);
                } else {
                    this.executeBuild(name);
                }
            });
            
            this.bottomLeftUI.add(hitArea);
        };

        createBuildRow(55, 'Road', [{key: 'log', qty: 1}, {key: 'brick', qty: 1}]);
        createBuildRow(100, 'Settlement', [{key: 'log', qty: 1}, {key: 'brick', qty: 1}, {key: 'wheat', qty: 1}, {key: 'sheep', qty: 1}]);
        createBuildRow(145, 'City', [{key: 'wheat', qty: 2}, {key: 'stone', qty: 3}]);
        createBuildRow(190, 'Dev Card', [{key: 'sheep', qty: 1}, {key: 'wheat', qty: 1}, {key: 'stone', qty: 1}]);
    }

    private showBuildError(msg: string) {
        if (this.buildErrorText) {
            this.buildErrorText.destroy();
        }

        this.buildErrorText = this.add.text(180, -10, msg, {
            fontSize: '14px', color: '#ff4444', fontStyle: 'bold', align: 'center', 
            stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5, 1);
        
        this.bottomLeftUI.add(this.buildErrorText);

        this.time.delayedCall(3000, () => {
            if (this.buildErrorText) {
                this.buildErrorText.destroy();
                this.buildErrorText = null;
            }
        });
    }

    private executeBuild(buildType: string) {
        switch (buildType) {
            case 'Road':
                this.startRoadPlacement();
                break;
            case 'Settlement':
                this.startSettlementPlacement();
                break;
            case 'City':
                this.startCityUpgrade();
                break;
            case 'Dev Card':
                this.buyDevCard();
                break;
        }
    }

    private payResources(costs: {key: string, qty: number}[]) {
        const player = this.gameState.players[this.myPlayerIndex];
        costs.forEach(cost => {
            player.resources[cost.key as keyof typeof player.resources] -= cost.qty;
        });
        this.updateUIStats();
    }

    private startRoadPlacement() {
        this.showBuildError('Click on a valid road spot to build');
        this.renderRoadSpots();
    }

    private renderRoadSpots() {
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];

        const playerColor = this.gameState.players[this.myPlayerIndex].colorHex;
        const mySettlements = this.intersections.filter(i => i.owner === this.myPlayerIndex);
        const myRoads = this.edges.filter(e => e.owner === this.myPlayerIndex);

        this.edges.forEach(edge => {
            if (edge.owner !== null) return;

            const touchesMySettlement = mySettlements.some(settlement => this.edgeTouchesIntersection(edge, settlement));
            const touchesMyRoad = myRoads.some(road => this.edgesAreAdjacent(edge, road));
            const canBuild = touchesMySettlement || touchesMyRoad;

            if (!canBuild) return;

            const spot = this.add.circle(edge.cx, edge.cy, 12, 0xffffff, 0.6);
            spot.setInteractive({ useHandCursor: true });
            
            spot.on('pointerover', () => spot.setFillStyle(playerColor, 0.9));
            spot.on('pointerout', () => spot.setFillStyle(0xffffff, 0.6));
            
            spot.on('pointerdown', () => {
                this.buildRoad(edge);
            });

            this.buildingsContainer.add(spot);
            this.interactiveSpots.push(spot);
        });
    }

    private buildRoad(edge: Edge) {
        const costs = [{key: 'log', qty: 1}, {key: 'brick', qty: 1}];
        if (this.pendingFreeRoads > 0) {
            this.pendingFreeRoads--;
        } else {
            this.payResources(costs);
        }
        
        edge.owner = this.myPlayerIndex;
        this.drawRoad(edge.cx, edge.cy, edge.angle, this.gameState.players[this.myPlayerIndex].colorHex);
        
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];

        if (this.pendingFreeRoads > 0) {
            this.showBuildError(`Choose another road (${this.pendingFreeRoads} left)`);
            this.renderRoadSpots();
        }
        
        this.checkLongestRoad();
        this.checkVictory();

        if (this.network && this.network.isConnected()) {
            this.network.send('BUILD_ROAD', {
                cx: edge.cx, cy: edge.cy, angle: edge.angle,
                colorHex: this.gameState.players[this.myPlayerIndex].colorHex,
                owner: this.myPlayerIndex
            });
        }
    }

    private startSettlementPlacement() {
        this.showBuildError('Click on a valid intersection to build settlement');
        this.renderSettlementSpots();
    }

    private renderSettlementSpots() {
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];

        const playerColor = this.gameState.players[this.myPlayerIndex].colorHex;
        const myRoads = this.edges.filter(e => e.owner === this.myPlayerIndex);

        this.intersections.forEach(int => {
            if (int.owner !== null) return;

            if (this.hasAdjacentBuilding(int)) return;

            const connected = myRoads.some(road => this.edgeTouchesIntersection(road, int));
            if (!connected) return;

            const spot = this.add.circle(int.x, int.y, 14, 0xffffff, 0.6);
            spot.setInteractive({ useHandCursor: true });
            
            spot.on('pointerover', () => spot.setFillStyle(playerColor, 0.9));
            spot.on('pointerout', () => spot.setFillStyle(0xffffff, 0.6));
            
            spot.on('pointerdown', () => {
                this.buildSettlement(int);
            });

            this.buildingsContainer.add(spot);
            this.interactiveSpots.push(spot);
        });
    }

    private buildSettlement(int: Intersection) {
        const costs = [{key: 'log', qty: 1}, {key: 'brick', qty: 1}, {key: 'wheat', qty: 1}, {key: 'sheep', qty: 1}];
        this.payResources(costs);
        
        int.owner = this.myPlayerIndex;
        int.type = 'SETTLEMENT';
        int.buildingSprite = this.drawSettlement(int.x, int.y, this.gameState.players[this.myPlayerIndex].colorHex);
        
        this.gameState.players[this.myPlayerIndex].points += 1;
        
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];
        
        this.updateUIStats();
        this.checkVictory();

        if (this.network && this.network.isConnected()) {
            this.network.send('BUILD_SETTLEMENT', {
                x: int.x, y: int.y,
                colorHex: this.gameState.players[this.myPlayerIndex].colorHex,
                owner: this.myPlayerIndex
            });
        }
    }

    private startCityUpgrade() {
        this.showBuildError('Click on your settlement to upgrade to city');
        this.renderCityUpgradeSpots();
    }

    private renderCityUpgradeSpots() {
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];

        this.intersections.forEach(int => {
            if (int.owner !== this.myPlayerIndex || int.type !== 'SETTLEMENT') return;

            const spot = this.add.circle(int.x, int.y, 16, 0xFFD700, 0.6);
            spot.setInteractive({ useHandCursor: true });
            
            spot.on('pointerover', () => spot.setFillStyle(0xFFD700, 0.9));
            spot.on('pointerout', () => spot.setFillStyle(0xFFD700, 0.6));
            
            spot.on('pointerdown', () => {
                this.upgradeToCity(int);
            });

            this.buildingsContainer.add(spot);
            this.interactiveSpots.push(spot);
        });
    }

    private upgradeToCity(int: Intersection) {
        const costs = [{key: 'wheat', qty: 2}, {key: 'stone', qty: 3}];
        this.payResources(costs);
        
        int.type = 'CITY';
        if (int.buildingSprite && int.buildingSprite.active) {
            int.buildingSprite.destroy();
        }
        int.buildingSprite = this.drawCity(int.x, int.y, this.gameState.players[this.myPlayerIndex].colorHex);
        
        this.gameState.players[this.myPlayerIndex].points += 1;
        
        this.interactiveSpots.forEach(s => s.destroy());
        this.interactiveSpots = [];
        
        this.updateUIStats();
        this.checkVictory();

        if (this.network && this.network.isConnected()) {
            this.network.send('BUILD_CITY', {
                x: int.x, y: int.y,
                colorHex: this.gameState.players[this.myPlayerIndex].colorHex,
                owner: this.myPlayerIndex
            });
        }
    }

    private buyDevCard() {
        if (this.gameState.bankDevCards <= 0) {
            this.showBuildError('No development cards left in bank!');
            return;
        }
        
        const costs = [{key: 'sheep', qty: 1}, {key: 'wheat', qty: 1}, {key: 'stone', qty: 1}];
        this.payResources(costs);
        
        this.gameState.bankDevCards--;
        this.gameState.players[this.myPlayerIndex].devCards++;
        
        const card = this.gameState.devDeck.pop()!;
        this.gameState.myDevCards.push({
            type: card,
            boughtOnTurn: this.gameState.myTurnNumber
        });
        this.gameState.bankDevCards = this.gameState.devDeck.length;
        if (card === 'Victory Point') {
            this.gameState.players[this.myPlayerIndex].hiddenVictoryPoints += 1;
            this.showBuildError('You drew a development card.');
        } else {
            this.showBuildError(`You drew: ${card}!`);
        }
        
        this.updateBankDisplay();
        this.updateUIStats();
        this.updateDevCardUI();
        this.checkVictory();

        if (this.network && this.network.isConnected()) {
            this.network.send('BUY_DEV_CARD', { owner: this.myPlayerIndex });
        }
    }

    private generateDevCardUI() {
        this.updateDevCardUI();
    }

    private updateDevCardUI() {
        if (!this.devCardUI) return;
        this.devCardUI.removeAll(true);

        const bg = this.add.graphics();
        this.drawWoodenPanel(0, 0, 340, 220, bg);
        this.drawParchmentPanel(10, 12, 320, 198, bg);
        bg.lineStyle(2, 0x8B5A2B, 0.5);
        bg.beginPath();
        bg.moveTo(24, 38);
        bg.lineTo(316, 38);
        bg.strokePath();
        this.devCardUI.add(bg);

        const title = this.add.text(170, 24, 'DEVELOPMENT CARDS', {
            fontSize: '20px', color: '#3e2723', fontStyle: 'bold'
        }).setOrigin(0.5);
        this.devCardUI.add(title);

        const grouped = new Map<DevCardType, number>();
        this.gameState.myDevCards.forEach(card => grouped.set(card.type, (grouped.get(card.type) ?? 0) + 1));
        const cards = [...grouped.entries()];
        if (cards.length === 0) {
            this.devCardUI.add(this.add.text(170, 120, 'No cards in hand', {
                fontSize: '24px', color: '#5C4033', fontStyle: 'italic'
            }).setOrigin(0.5));
            return;
        }

        cards.forEach(([card, count], index) => {
            const x = 18 + (index % 2) * 154;
            const y = 50 + Math.floor(index / 2) * 56;
            const cardFace = this.add.graphics();
            cardFace.fillStyle(0xFAEFC9, 1);
            cardFace.fillRoundedRect(x, y, 148, 42, 6);
            cardFace.lineStyle(2, 0x8B5A2B, 1);
            cardFace.strokeRoundedRect(x, y, 148, 42, 6);
            cardFace.fillStyle(0x2C5F2D, 1);
            cardFace.fillRoundedRect(x + 6, y + 7, 28, 28, 4);
            cardFace.lineStyle(1, 0x4A8F4D, 1);
            cardFace.strokeRoundedRect(x + 6, y + 7, 28, 28, 4);
            this.drawCardGeometry(cardFace, card, x + 20, y + 21);
            this.devCardUI.add(cardFace);

            this.devCardUI.add(this.add.text(x + 92, y + 21, `${card}  x${count}`, {
                fontSize: '12px', color: '#3e2723', fontStyle: 'bold'
            }).setOrigin(0.5));

            if (card !== 'Victory Point') {
                const hitArea = this.add.rectangle(x + 74, y + 21, 148, 42, 0x000000, 0);
                hitArea.setInteractive({ useHandCursor: true });
                hitArea.on('pointerdown', () => this.playDevCard(card));
                hitArea.on('pointerover', () => cardFace.setAlpha(0.85));
                hitArea.on('pointerout', () => cardFace.setAlpha(1));
                this.devCardUI.add(hitArea);
            } else {
                this.devCardUI.add(this.add.text(x + 128, y + 35, 'Passive', {
                    fontSize: '9px', color: '#7a5b3a', fontStyle: 'italic'
                }).setOrigin(0.5));
            }
        });
    }

    private drawCardGeometry(graphics: Phaser.GameObjects.Graphics, card: DevCardType, x: number, y: number) {
        graphics.fillStyle(0xFFD700, 1);
        graphics.lineStyle(1, 0xFFF8DC, 1);
        if (card === 'Knight') {
            graphics.fillTriangle(x, y - 9, x - 8, y + 7, x + 8, y + 7);
            graphics.fillCircle(x, y - 2, 3);
        } else if (card === 'Victory Point') {
            graphics.fillTriangle(x, y - 10, x + 8, y, x, y + 10);
            graphics.fillTriangle(x, y - 10, x - 8, y, x, y + 10);
        } else if (card === 'Road Building') {
            graphics.fillRect(x - 9, y - 6, 18, 5);
            graphics.fillRect(x - 6, y + 2, 18, 5);
            graphics.strokeRect(x - 9, y - 6, 18, 5);
            graphics.strokeRect(x - 6, y + 2, 18, 5);
        } else if (card === 'Year of Plenty') {
            graphics.fillCircle(x - 5, y, 5);
            graphics.fillCircle(x + 5, y, 5);
            graphics.fillRect(x - 2, y - 9, 4, 18);
        } else {
            graphics.fillCircle(x, y, 8);
            graphics.fillStyle(0x2C5F2D, 1);
            graphics.fillCircle(x, y, 3);
        }
    }

    private playDevCard(card: DevCardType) {
        if (!this.isMyTurnAndPhase('TRADE_BUILD')) {
            this.showBuildError('Play development cards during your turn.');
            return;
        }
        if (this.gameState.playedDevCardThisTurn) {
            this.showBuildError('You can play only one development card per turn.');
            return;
        }
        if (card === 'Victory Point') {
            this.showBuildError('Victory Point cards are passive and cannot be played.');
            return;
        }

        const cardIndex = this.gameState.myDevCards.findIndex(c => c.type === card && c.boughtOnTurn < this.gameState.myTurnNumber);
        if (cardIndex < 0) {
            if (this.gameState.myDevCards.some(c => c.type === card)) {
                this.showBuildError('You can play this development card starting next turn.');
            }
            return;
        }
        this.gameState.myDevCards.splice(cardIndex, 1);
        this.gameState.players[this.myPlayerIndex].devCards--;
        this.gameState.playedDevCardThisTurn = true;

        switch (card) {
            case 'Knight':
                this.gameState.players[this.myPlayerIndex].playedKnights += 1;
                this.checkLargestArmy();
                this.gameState.turnPhase = 'MOVE_ROBBER';
                this.showBuildError('Knight played. Move the robber.');
                this.prepareRobberMovement();
                break;
            case 'Road Building':
                this.pendingFreeRoads = 2;
                this.showBuildError('Road Building: choose two road spots.');
                this.renderRoadSpots();
                break;
            case 'Year of Plenty': {
                const resourceKeys = ['log', 'brick', 'sheep', 'wheat', 'stone'] as const;
                const first = resourceKeys[Phaser.Math.Between(0, resourceKeys.length - 1)];
                const second = resourceKeys[Phaser.Math.Between(0, resourceKeys.length - 1)];
                this.gameState.players[this.myPlayerIndex].resources[first]++;
                this.gameState.players[this.myPlayerIndex].resources[second]++;
                this.showBuildError(`Year of Plenty: gained ${first} and ${second}.`);
                break;
            }
            case 'Monopoly': {
                const resourceKeys = ['log', 'brick', 'sheep', 'wheat', 'stone'] as const;
                const target = resourceKeys.reduce((best, key) => {
                    const amount = this.gameState.players.filter(p => p.id !== this.myPlayerIndex).reduce((sum, player) => sum + player.resources[key], 0);
                    const bestAmount = this.gameState.players.filter(p => p.id !== this.myPlayerIndex).reduce((sum, player) => sum + player.resources[best], 0);
                    return amount > bestAmount ? key : best;
                }, resourceKeys[0]);
                let stolen = 0;
                this.gameState.players.forEach(player => {
                    if (player.id !== this.myPlayerIndex) {
                        stolen += player.resources[target];
                        player.resources[target] = 0;
                    }
                });
                this.gameState.players[this.myPlayerIndex].resources[target] += stolen;
                this.showBuildError(`Monopoly: took ${stolen} ${target}.`);
                break;
            }
        }

        this.updateUIStats();
        this.updateDevCardUI();
        this.checkVictory();
        this.refreshAllButtonStates();
    }

    private updateBankDisplay() {
        const bankDevCardText = this.leftUI.getAll('text').find(t => 
            t instanceof Phaser.GameObjects.Text && t.text.includes('x') && t.x > 250
        ) as Phaser.GameObjects.Text | undefined;
        if (bankDevCardText) {
            bankDevCardText.setText(`x${this.gameState.bankDevCards}`);
        }
    }

    private checkLongestRoad() {
        const lengths = this.gameState.players.map(player => this.computeLongestRoadLength(player.id));
        const bestLength = Math.max(...lengths);
        const topPlayers = lengths
            .map((length, playerId) => ({ length, playerId }))
            .filter(entry => entry.length === bestLength);

        let nextOwner: number | null = null;
        if (bestLength >= 5) {
            if (topPlayers.length === 1) {
                nextOwner = topPlayers[0].playerId;
            } else if (
                this.gameState.longestRoadOwner !== null &&
                topPlayers.some(entry => entry.playerId === this.gameState.longestRoadOwner)
            ) {
                nextOwner = this.gameState.longestRoadOwner;
            }
        }

        const previousOwner = this.gameState.longestRoadOwner;
        if (previousOwner === nextOwner) return;

        if (previousOwner !== null) {
            this.gameState.players[previousOwner].points -= 2;
        }
        if (nextOwner !== null) {
            this.gameState.players[nextOwner].points += 2;
            if (nextOwner === this.myPlayerIndex) {
                this.showBuildError('You now have Longest Road (+2 points).');
            }
        }
        this.gameState.longestRoadOwner = nextOwner;
        this.updateUIStats();
    }

    private checkLargestArmy() {
        const knightCounts = this.gameState.players.map(player => player.playedKnights);
        const bestCount = Math.max(...knightCounts);
        const topPlayers = knightCounts
            .map((count, playerId) => ({ count, playerId }))
            .filter(entry => entry.count === bestCount);

        let nextOwner: number | null = null;
        if (bestCount >= 3) {
            if (topPlayers.length === 1) {
                nextOwner = topPlayers[0].playerId;
            } else if (
                this.gameState.largestArmyOwner !== null &&
                topPlayers.some(entry => entry.playerId === this.gameState.largestArmyOwner)
            ) {
                nextOwner = this.gameState.largestArmyOwner;
            }
        }

        const previousOwner = this.gameState.largestArmyOwner;
        if (previousOwner === nextOwner) return;

        if (previousOwner !== null) {
            this.gameState.players[previousOwner].points -= 2;
        }
        if (nextOwner !== null) {
            this.gameState.players[nextOwner].points += 2;
            if (nextOwner === this.myPlayerIndex) {
                this.showBuildError('You now have Largest Army (+2 points).');
            }
        }
        this.gameState.largestArmyOwner = nextOwner;
        this.updateUIStats();
    }

    private checkVictory() {
        const player = this.gameState.players[this.myPlayerIndex];
        if (this.getRealPoints(player) >= 10) {
            this.showVictory(this.myPlayerIndex);
        }
    }

    private showVictory(winnerId = this.myPlayerIndex) {
        if (this.victoryModalUI) {
            this.victoryModalUI.destroy();
        }
        if (this.victoryLobbyButton) {
            this.victoryLobbyButton.destroy();
            this.victoryLobbyButton = undefined;
        }
        
        const width = this.scale.width;
        const height = this.scale.height;
        
        this.victoryModalUI = this.add.container(width / 2, height / 2);
        this.victoryModalUI.setDepth(5000);

        const overlay = this.add.rectangle(0, 0, width * 2, height * 2, 0x000000, 0.7);
        overlay.setInteractive({ useHandCursor: true });
        this.victoryModalUI.add(overlay);

        const panelWidth = Math.min(600, width - 100);
        const panelHeight = Math.min(400, height - 100);
        const bg = this.add.graphics();
        this.drawWoodenPanel(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, bg);
        this.drawParchmentPanel(-panelWidth / 2 + 16, -panelHeight / 2 + 16, panelWidth - 32, panelHeight - 32, bg);
        this.victoryModalUI.add(bg);

        const trophy = this.add.graphics();
        trophy.fillStyle(0xFFD700, 1);
        trophy.lineStyle(3, 0xB8860B, 1);
        trophy.fillCircle(0, -panelHeight / 2 + 80, 30);
        trophy.strokeCircle(0, -panelHeight / 2 + 80, 30);
        trophy.fillRect(-8, -panelHeight / 2 + 105, 16, 20);
        trophy.fillRect(-20, -panelHeight / 2 + 125, 40, 6);
        this.victoryModalUI.add(trophy);

        const title = this.add.text(0, -40, '🏆 VICTORY! 🏆', { 
            fontSize: '48px', color: '#FFD700', fontStyle: 'bold', 
            stroke: '#000000', strokeThickness: 6 
        }).setOrigin(0.5);
        this.victoryModalUI.add(title);

        const winner = this.gameState.players[winnerId];
        const didWin = winnerId === this.myPlayerIndex;
        trophy.setAlpha(didWin ? 1 : 0.35);
        const msg = this.add.text(0, 30, didWin
            ? `You won with ${this.getRealPoints(winner)} points!`
            : `${winner.name} won with ${this.getRealPoints(winner)} points.`, {
            fontSize: '24px', color: '#3e2723', fontStyle: 'bold' 
        }).setOrigin(0.5);
        this.victoryModalUI.add(msg);

        title.setText(didWin ? '🏆 VICTORY! 🏆' : 'DEFEAT');
        title.setColor(didWin ? '#FFD700' : '#a94442');

        const hint = this.add.text(0, 90, 'Return to the lobby to play again', { 
            fontSize: '14px', color: '#5C4033', fontStyle: 'italic' 
        }).setOrigin(0.5);
        this.victoryModalUI.add(hint);

        this.victoryLobbyButton = this.add.dom(width / 2, height / 2 + 145, 'button',
            'width: 250px; height: 48px; border: 2px solid #f7e4bd; border-radius: 8px; background: #7a4d35; color: #fff8e7; font: bold 17px Georgia; cursor: pointer; pointer-events: auto;',
            'RETURN TO LOBBY');
        this.victoryLobbyButton.setDepth(6000);
        this.victoryLobbyButton.node.addEventListener('click', () => this.returnToLobby());

        this.victoryModalUI.setScale(0);
        this.tweens.add({
            targets: this.victoryModalUI,
            scale: 1,
            duration: 500,
            ease: 'Back.Out'
        });

    }

    private returnToLobby() {
        const players = this.gameState.players.map(player => ({
            name: player.name,
            colorStr: player.colorStr,
            colorHex: player.colorHex,
            isBot: player.isBot
        }));
        this.victoryLobbyButton?.destroy();
        this.victoryLobbyButton = undefined;
        this.registry.set('returnLobbyPlayers', players);
        this.scene.start('GameSelectionScene', { players });
    }

    private drawDevCardStack(container: Phaser.GameObjects.Container, count: number) {
        const visibleCount = Math.min(count, 5);
        for (let i = 0; i < visibleCount; i++) {
            const offset = i * 2;
            const card = this.add.graphics();
            card.fillStyle(0xFFF8DC, 1);
            card.fillRoundedRect(-12 + offset, -14 - offset, 24, 32, 3);
            card.lineStyle(2, 0x8B5A2B, 1);
            card.strokeRoundedRect(-12 + offset, -14 - offset, 24, 32, 3);
            card.fillStyle(0x2C5F2D, 1);
            card.fillRoundedRect(-8 + offset, -10 - offset, 16, 24, 2);
            card.lineStyle(1, 0x4A8F4D, 1);
            card.strokeRoundedRect(-8 + offset, -10 - offset, 16, 24, 2);
            card.fillStyle(0xFFD700, 1);
            card.fillCircle(offset, -2 - offset, 3);
            container.add(card);
        }
        if (count > 0) {
            const countText = this.add.text(16, 14, `x${count}`, { 
                fontSize: '12px', color: '#3e2723', fontStyle: 'bold', stroke: '#FFF8DC', strokeThickness: 2 
            }).setOrigin(0.5);
            container.add(countText);
        }
    }

    private drawWoodenPanel(x: number, y: number, w: number, h: number, graphics: Phaser.GameObjects.Graphics) {
        graphics.fillStyle(0x2b1d16, 0.28);
        graphics.fillRoundedRect(x + 5, y + 6, w, h, 12);
        graphics.fillStyle(0xDEB887, 1); 
        graphics.fillRoundedRect(x, y, w, h, 12);
        graphics.lineStyle(6, 0x5C4033, 1); 
        graphics.strokeRoundedRect(x, y, w, h, 12);
        
        graphics.lineStyle(2, 0x8B5A2B, 0.4); 
        graphics.strokeRoundedRect(x + 6, y + 6, w - 12, h - 12, 8);
        
        graphics.fillStyle(0x222222, 1);
        const margin = 12;
        graphics.fillCircle(x + margin, y + margin, 4);
        graphics.fillCircle(x + w - margin, y + margin, 4);
        graphics.fillCircle(x + margin, y + h - margin, 4);
        graphics.fillCircle(x + w - margin, y + h - margin, 4);
    }

    private drawParchmentPanel(x: number, y: number, w: number, h: number, graphics: Phaser.GameObjects.Graphics) {
        graphics.fillStyle(0x2b1d16, 0.22);
        graphics.fillRoundedRect(x + 4, y + 5, w, h, 8);
        graphics.fillStyle(0xFFF8DC, 1); 
        graphics.fillRoundedRect(x, y, w, h, 8);
        graphics.lineStyle(3, 0x8B5A2B, 1); 
        graphics.strokeRoundedRect(x, y, w, h, 8);
    }

    private generateUI() {
        const scorePanel = this.add.graphics();
        this.drawWoodenPanel(0, -145, 340, 290, scorePanel);
        this.leftUI.add(scorePanel);

        const scoreTitle = this.add.text(170, -120, '- SCOREBOARD -', { fontSize: '20px', color: '#3e2723', fontStyle: 'bold' }).setOrigin(0.5);
        this.leftUI.add(scoreTitle);

        let startY = -80;
        this.gameState.players.forEach((p, index) => {
            const pawn = this.add.graphics();
            pawn.fillStyle(p.colorHex, 1);
            pawn.lineStyle(1, 0x3e2723, 1); 
            const px = 28; const py = startY + 7; 
            
            pawn.fillEllipse(px, py + 6, 16, 5);
            pawn.strokeEllipse(px, py + 6, 16, 5);
            pawn.beginPath();
            pawn.moveTo(px - 5, py + 5);
            pawn.lineTo(px + 5, py + 5);
            pawn.lineTo(px + 2, py - 5);
            pawn.lineTo(px - 2, py - 5);
            pawn.closePath();
            pawn.fillPath();
            pawn.strokePath();
            pawn.fillEllipse(px, py - 4, 9, 3);
            pawn.strokeEllipse(px, py - 4, 9, 3);
            pawn.fillCircle(px, py - 9, 5);
            pawn.strokeCircle(px, py - 9, 5);
            this.leftUI.add(pawn);

            const nameText = this.add.text(50, startY, p.name, { fontSize: '16px', color: p.colorStr, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 });
            const totalRes = p.resources.log + p.resources.brick + p.resources.sheep + p.resources.wheat + p.resources.stone;
            const initialStats = index === this.myPlayerIndex
                ? `Pts: ${p.points} | Real: ${this.getRealPoints(p)} | Res: ${totalRes} | Cards: ${p.devCards}`
                : `Pts: ${p.points} | Res: ${totalRes} | Cards: ${p.devCards}`;
            const statsText = this.add.text(50, startY + 22, initialStats, { fontSize: '13px', color: '#5C4033', fontStyle: 'bold' });
            
            this.uiPlayerStatsTexts.push(statsText);
            this.uiPlayerNameTexts.push(nameText);
            this.leftUI.add(nameText);
            this.leftUI.add(statsText);
            startY += 55;
        });

        const titlesPanel = this.add.graphics();
        this.drawWoodenPanel(0, 0, 340, 100, titlesPanel);
        this.titlesUI.add(titlesPanel);

        const titlesTitle = this.add.text(170, 22, '- TITLES -', { fontSize: '16px', color: '#3e2723', fontStyle: 'bold' }).setOrigin(0.5);
        this.titlesUI.add(titlesTitle);

        const longestRoadText = this.add.text(14, 45, '', { fontSize: '13px', color: '#5C4033', fontStyle: 'bold' });
        this.titleTexts[0] = longestRoadText;
        this.titlesUI.add(longestRoadText);

        const largestArmyText = this.add.text(14, 68, '', { fontSize: '13px', color: '#5C4033', fontStyle: 'bold' });
        this.titleTexts[1] = largestArmyText;
        this.titlesUI.add(largestArmyText);

        const bankPanel = this.add.graphics();
        this.drawWoodenPanel(0, 155, 340, 50, bankPanel);
        this.leftUI.add(bankPanel);

        const bankTitle = this.add.text(12, 180, 'BANK:', { fontSize: '14px', color: '#3e2723', fontStyle: 'bold' }).setOrigin(0, 0.5);
        this.leftUI.add(bankTitle);

        const bankResources = [ 
            { key: 'log', count: 19 }, { key: 'brick', count: 19 }, { key: 'sheep', count: 19 }, 
            { key: 'wheat', count: 19 }, { key: 'stone', count: 19 }
        ];
        
        let bankResX = 65;
        bankResources.forEach((res) => {
            const icon = this.add.image(bankResX, 180, res.key);
            icon.setDisplaySize(20, 20); 
            this.leftUI.add(icon);

            const countText = this.add.text(bankResX + 11, 180, `x${res.count}`, { fontSize: '13px', color: '#3e2723', fontStyle: 'bold' }).setOrigin(0, 0.5);
            this.leftUI.add(countText);
            bankResX += 45; 
        });

        const devCardContainer = this.add.container(bankResX + 5, 180);
        this.drawDevCardStack(devCardContainer, this.gameState.bankDevCards);
        this.leftUI.add(devCardContainer);

        const charColorHex = this.gameState.players[this.myPlayerIndex].colorHex; 
        const charColorLight = this.lightenColor(charColorHex, 70);

        const profileGraphics = this.add.graphics();
        profileGraphics.fillStyle(0x5C4033, 1);
        profileGraphics.fillCircle(0, 0, 75);
        profileGraphics.fillStyle(0xDEB887, 1);
        profileGraphics.fillCircle(0, 0, 68);
        profileGraphics.fillStyle(charColorLight, 0.9);
        profileGraphics.fillCircle(0, 0, 55);
        profileGraphics.lineStyle(4, charColorHex, 1);
        profileGraphics.strokeCircle(0, 0, 55);

        profileGraphics.fillStyle(charColorHex, 1);
        profileGraphics.lineStyle(2, 0xffffff, 0.5);
        profileGraphics.fillEllipse(0, 18, 42, 14);
        profileGraphics.strokeEllipse(0, 18, 42, 14);
        profileGraphics.beginPath();
        profileGraphics.moveTo(-14, 14);
        profileGraphics.lineTo(14, 14);
        profileGraphics.lineTo(6, -12);
        profileGraphics.lineTo(-6, -12);
        profileGraphics.closePath();
        profileGraphics.fillPath();
        profileGraphics.strokePath();
        profileGraphics.fillEllipse(0, -9, 22, 9);
        profileGraphics.strokeEllipse(0, -9, 22, 9);
        profileGraphics.fillCircle(0, -24, 13);
        profileGraphics.strokeCircle(0, -24, 13);
        this.rightUI.add(profileGraphics);

        const resBgWidth = 75;
        const resBgHeight = 250;
        const resStartX = -resBgWidth / 2; 
        const resStartY = -340; 

        const resBg = this.add.graphics();
        this.drawParchmentPanel(resStartX, resStartY, resBgWidth, resBgHeight, resBg);
        this.rightUI.add(resBg);

        const myRes = this.gameState.players[this.myPlayerIndex].resources;
        const resKeys = ['stone', 'wheat', 'sheep', 'brick', 'log'] as const;

        resKeys.forEach((key, index) => {
            const currentY = resStartY + 28 + (index * 48);
            const icon = this.add.image(resStartX + 20, currentY, key);
            icon.setDisplaySize(30, 30);
            this.rightUI.add(icon);

            const countText = this.add.text(resStartX + 38, currentY, `x${myRes[key]}`, { fontSize: '16px', color: '#3e2723', fontStyle: 'bold' }).setOrigin(0, 0.5);
            this.uiMyResourcesTexts[key] = countText; 
            this.rightUI.add(countText);
        });
    }

    private generateTradeMenu() {
        const menuWidth = 400;
        const menuHeight = 320;
        const bg = this.add.graphics();
        
        bg.fillStyle(0xDEB887, 1); 
        bg.fillRoundedRect(0, 0, menuWidth, menuHeight, 15);
        bg.lineStyle(2, 0xCdaa7d, 0.6); 
        for (let i = 0; i < 7; i++) {
            bg.strokeEllipse(menuWidth / 2, menuHeight / 2, menuWidth - 20 - (i * 50), menuHeight - 10 - (i * 40));
        }
        bg.lineStyle(6, 0x5C4033, 1);
        bg.strokeRoundedRect(0, 0, menuWidth, menuHeight, 15);
        bg.lineStyle(4, 0x5C4033, 0.9);
        bg.beginPath();
        bg.moveTo(80, 0);
        bg.lineTo(80, menuHeight);
        bg.strokePath();

        this.topRightUI.add(bg);

        this.tradeButtonsContainer = this.add.container(0, 0);
        this.topRightUI.add(this.tradeButtonsContainer);
        this.tradeContentContainer = this.add.container(80, 0);
        this.topRightUI.add(this.tradeContentContainer);

        this.renderTradeButtons();
        this.updateTradeContent();
    }

    private renderTradeButtons() {
        this.tradeButtonsContainer.removeAll(true);
        const btnY = [45, 102, 160, 217, 275];
        const btnX = 40;

        this.createTradeButton(btnX, btnY[0], 'BANK', () => this.drawBankIcon(btnX, btnY[0]));
        this.createTradeButton(btnX, btnY[1], 'ALL', () => this.drawAllPlayersIcon(btnX, btnY[1]));
        this.createTradeButton(btnX, btnY[2], 'RED BOT', () => this.drawMiniPawn(btnX, btnY[2], 0xff4444));
        this.createTradeButton(btnX, btnY[3], 'GREEN BOT', () => this.drawMiniPawn(btnX, btnY[3], 0x44ff44));
        this.createTradeButton(btnX, btnY[4], 'ORANGE BOT', () => this.drawMiniPawn(btnX, btnY[4], 0xffa500));
    }

    private createTradeButton(x: number, y: number, targetName: TradeTarget, drawIconCallback: () => void) {
        const isSelected = (this.currentTradeTarget === targetName);
        const btnGraphics = this.add.graphics();
        
        if (isSelected) {
            btnGraphics.fillStyle(0x000000, 0.25); 
            btnGraphics.fillCircle(x, y, 26);
            btnGraphics.lineStyle(3, 0x3e2723, 1); 
        } else {
            btnGraphics.lineStyle(2, 0x8B5A2B, 0.5); 
        }
        
        btnGraphics.strokeCircle(x, y, 26);
        this.tradeButtonsContainer.add(btnGraphics);
        drawIconCallback();

        const hitArea = this.add.circle(x, y, 26, 0x000000, 0);
        hitArea.setInteractive({ useHandCursor: true });
        hitArea.on('pointerdown', () => {
            if (this.currentTradeTarget !== targetName) {
                this.currentTradeTarget = targetName;
                this.renderTradeButtons(); 
                this.updateTradeContent(); 
            }
        });
        this.tradeButtonsContainer.add(hitArea);
    }

    private drawBankIcon(x: number, y: number) {
        const graphics = this.add.graphics();
        graphics.fillStyle(0x3e2723, 1); 
        graphics.fillTriangle(x, y - 12, x - 15, y - 2, x + 15, y - 2);
        graphics.fillRect(x - 12, y - 2, 4, 12);
        graphics.fillRect(x - 2, y - 2, 4, 12);
        graphics.fillRect(x + 8, y - 2, 4, 12);
        graphics.fillRect(x - 15, y + 10, 30, 4);
        this.tradeButtonsContainer.add(graphics);
    }

    private drawAllPlayersIcon(x: number, y: number) {
        this.drawMiniPawn(x - 8, y + 4, 0xff4444, 0.7);
        this.drawMiniPawn(x + 8, y + 4, 0xffa500, 0.7);
        this.drawMiniPawn(x, y - 4, 0x44ff44, 0.7); 
    }

    private drawMiniPawn(x: number, y: number, color: number, scale: number = 1) {
        const pawn = this.add.graphics();
        pawn.fillStyle(color, 1);
        pawn.lineStyle(1, 0x3e2723, 0.8); 
        
        pawn.fillEllipse(x, y + 8 * scale, 16 * scale, 6 * scale);
        pawn.strokeEllipse(x, y + 8 * scale, 16 * scale, 6 * scale);
        pawn.beginPath();
        pawn.moveTo(x - 6 * scale, y + 8 * scale);
        pawn.lineTo(x + 6 * scale, y + 8 * scale);
        pawn.lineTo(x + 3 * scale, y - 4 * scale);
        pawn.lineTo(x - 3 * scale, y - 4 * scale);
        pawn.closePath();
        pawn.fillPath();
        pawn.strokePath();
        pawn.fillEllipse(x, y - 3 * scale, 10 * scale, 4 * scale);
        pawn.strokeEllipse(x, y - 3 * scale, 10 * scale, 4 * scale);
        pawn.fillCircle(x, y - 9 * scale, 6 * scale);
        pawn.strokeCircle(x, y - 9 * scale, 6 * scale);
        this.tradeButtonsContainer.add(pawn);
    }

    private getBankTradeRatio(resource: ResourceKey, playerId: number): number {
        let bestRatio = 4;
        this.ports.forEach(port => {
            const isConnected = port.intersectionIndices.some(index =>
                index >= 0 && this.intersections[index].owner === playerId
            );
            if (!isConnected) return;
            if (port.resource === null) {
                bestRatio = Math.min(bestRatio, port.ratio);
                return;
            }
            if (port.resource === resource) {
                bestRatio = Math.min(bestRatio, port.ratio);
            }
        });
        return bestRatio;
    }

    private getBotIndexByTarget(target: TradeTarget): number | null {
        if (target === 'RED BOT') return 1;
        if (target === 'GREEN BOT') return 2;
        if (target === 'ORANGE BOT') return 3;
        return null;
    }

    private cycleTradeResource(kind: 'give' | 'receive', delta: number) {
        const resources: ResourceKey[] = ['log', 'brick', 'sheep', 'wheat', 'stone'];
        const selected = kind === 'give' ? this.tradeGiveResource : this.tradeReceiveResource;
        const currentIndex = resources.indexOf(selected);
        const nextIndex = (currentIndex + delta + resources.length) % resources.length;
        const nextValue = resources[nextIndex];
        if (kind === 'give') {
            this.tradeGiveResource = nextValue;
        } else {
            this.tradeReceiveResource = nextValue;
        }
        this.updateTradeContent();
    }

    private adjustTradeAmount(kind: 'give' | 'receive', delta: number) {
        if (this.currentTradeTarget === 'BANK' && kind === 'give') return;
        if (kind === 'give') {
            this.tradeGiveAmount = Phaser.Math.Clamp(this.tradeGiveAmount + delta, 1, 4);
        } else {
            this.tradeReceiveAmount = Phaser.Math.Clamp(this.tradeReceiveAmount + delta, 1, 4);
        }
        this.updateTradeContent();
    }

    private botAcceptsTrade(botIndex: number): boolean {
        const bot = this.gameState.players[botIndex];
        if (bot.resources[this.tradeReceiveResource] < this.tradeReceiveAmount) return false;
        const netForBot = this.tradeGiveAmount - this.tradeReceiveAmount;
        if (netForBot >= 1) return true;
        if (netForBot === 0) return Math.random() > 0.35;
        if (netForBot === -1) return Math.random() > 0.7;
        return Math.random() > 0.9;
    }

    private applyTradeWithBot(botIndex: number) {
        const player = this.gameState.players[this.myPlayerIndex];
        const bot = this.gameState.players[botIndex];
        player.resources[this.tradeGiveResource] -= this.tradeGiveAmount;
        player.resources[this.tradeReceiveResource] += this.tradeReceiveAmount;
        bot.resources[this.tradeGiveResource] += this.tradeGiveAmount;
        bot.resources[this.tradeReceiveResource] -= this.tradeReceiveAmount;
    }

    private executeTradeOffer() {
        if (!this.isMyTurnAndPhase('TRADE_BUILD')) {
            this.showTradeError('You can trade only during your trade/build phase.');
            return;
        }
        if (this.tradeGiveResource === this.tradeReceiveResource) {
            this.showTradeError('Choose different resources for give and receive.');
            return;
        }

        const player = this.gameState.players[this.myPlayerIndex];

        if (this.currentTradeTarget === 'BANK') {
            const bankRatio = this.getBankTradeRatio(this.tradeGiveResource, this.myPlayerIndex);
            const requiredGive = bankRatio * this.tradeReceiveAmount;
            if (player.resources[this.tradeGiveResource] < requiredGive) {
                this.showTradeError(`Need ${requiredGive} ${this.tradeGiveResource} (${bankRatio}:1) for bank trade.`);
                return;
            }
            player.resources[this.tradeGiveResource] -= requiredGive;
            player.resources[this.tradeReceiveResource] += this.tradeReceiveAmount;
            this.updateUIStats();
            this.showTradeNotification(`Bank trade accepted: ${requiredGive} ${this.tradeGiveResource} → ${this.tradeReceiveAmount} ${this.tradeReceiveResource}.`);
            return;
        }

        if (this.network && this.network.isConnected()) {
            const remoteIndex = this.myPlayerIndex === 0 ? 1 : 0;
            this.network.send('TRADE', {
                giverIndex: this.myPlayerIndex,
                receiverIndex: remoteIndex,
                giveResource: this.tradeGiveResource,
                receiveResource: this.tradeReceiveResource,
                giveAmount: this.tradeGiveAmount,
                receiveAmount: this.tradeReceiveAmount
            });
            player.resources[this.tradeGiveResource] -= this.tradeGiveAmount;
            this.gameState.players[remoteIndex].resources[this.tradeReceiveResource] += this.tradeReceiveAmount;
            this.updateUIStats();
            this.showTradeNotification('Ofertă trimisă adversarului.');
            return;
        }

        if (player.resources[this.tradeGiveResource] < this.tradeGiveAmount) {
            this.showTradeError(`You need ${this.tradeGiveAmount} ${this.tradeGiveResource}.`);
            return;
        }

        const directBot = this.getBotIndexByTarget(this.currentTradeTarget);
        if (directBot !== null) {
            if (!this.botAcceptsTrade(directBot)) {
                this.showTradeError(`${this.gameState.players[directBot].name} rejected your offer.`);
                return;
            }
            this.applyTradeWithBot(directBot);
            this.updateUIStats();
            this.showTradeNotification(`${this.gameState.players[directBot].name} accepted your trade.`);
            return;
        }

        const candidates = [1, 2, 3].filter(botIndex => this.botAcceptsTrade(botIndex));
        if (candidates.length === 0) {
            this.showTradeError('No bot accepted this offer.');
            return;
        }
        const chosen = candidates[Phaser.Math.Between(0, candidates.length - 1)];
        this.applyTradeWithBot(chosen);
        this.updateUIStats();
        this.showTradeNotification(`${this.gameState.players[chosen].name} accepted your trade.`);
    }

    private updateTradeContent() {
        this.tradeContentContainer.removeAll(true);
        const title = this.add.text(160, 28, `TRADE WITH: ${this.currentTradeTarget}`, { fontSize: '17px', color: '#3e2723', fontStyle: 'bold' }).setOrigin(0.5);
        this.tradeContentContainer.add(title);

        const isActive = this.isMyTurnAndPhase('TRADE_BUILD');
        const isBank = this.currentTradeTarget === 'BANK';
        const bankRatio = isBank ? this.getBankTradeRatio(this.tradeGiveResource, this.myPlayerIndex) : 4;
        const giveAmount = isBank ? bankRatio * this.tradeReceiveAmount : this.tradeGiveAmount;

        const drawSelector = (y: number, label: string, resource: ResourceKey, amount: number, kind: 'give' | 'receive') => {
            const row = this.add.graphics();
            row.fillStyle(0xFFF8DC, 1);
            row.fillRoundedRect(14, y - 24, 292, 50, 7);
            row.lineStyle(2, 0x8B5A2B, 1);
            row.strokeRoundedRect(14, y - 24, 292, 50, 7);
            this.tradeContentContainer.add(row);

            const labelText = this.add.text(28, y - 8, label, { fontSize: '14px', color: '#5C4033', fontStyle: 'bold' });
            this.tradeContentContainer.add(labelText);

            const icon = this.add.image(88, y + 2, resource);
            icon.setDisplaySize(22, 22);
            this.tradeContentContainer.add(icon);

            const nameText = this.add.text(106, y - 8, resource.toUpperCase(), { fontSize: '13px', color: '#3e2723', fontStyle: 'bold' });
            this.tradeContentContainer.add(nameText);

            const amountText = this.add.text(222, y - 8, `x${amount}`, { fontSize: '13px', color: '#3e2723', fontStyle: 'bold' });
            this.tradeContentContainer.add(amountText);

            const leftResource = this.add.text(180, y - 8, '<', { fontSize: '18px', color: '#5C4033', fontStyle: 'bold' });
            const rightResource = this.add.text(198, y - 8, '>', { fontSize: '18px', color: '#5C4033', fontStyle: 'bold' });
            leftResource.setInteractive({ useHandCursor: true });
            rightResource.setInteractive({ useHandCursor: true });
            leftResource.on('pointerdown', () => this.cycleTradeResource(kind, -1));
            rightResource.on('pointerdown', () => this.cycleTradeResource(kind, 1));
            this.tradeContentContainer.add(leftResource);
            this.tradeContentContainer.add(rightResource);

            if (!(isBank && kind === 'give')) {
                const minus = this.add.text(254, y - 8, '-', { fontSize: '18px', color: '#5C4033', fontStyle: 'bold' });
                const plus = this.add.text(272, y - 8, '+', { fontSize: '18px', color: '#5C4033', fontStyle: 'bold' });
                minus.setInteractive({ useHandCursor: true });
                plus.setInteractive({ useHandCursor: true });
                minus.on('pointerdown', () => this.adjustTradeAmount(kind, -1));
                plus.on('pointerdown', () => this.adjustTradeAmount(kind, 1));
                this.tradeContentContainer.add(minus);
                this.tradeContentContainer.add(plus);
            } else {
                const fixed = this.add.text(248, y - 8, `${bankRatio}:1`, { fontSize: '12px', color: '#7a5b3a', fontStyle: 'italic' });
                this.tradeContentContainer.add(fixed);
            }
        };

        drawSelector(88, 'GIVE', this.tradeGiveResource, giveAmount, 'give');
        drawSelector(154, 'RECEIVE', this.tradeReceiveResource, this.tradeReceiveAmount, 'receive');

        const hintText = this.add.text(160, 198,
            isBank ? `Bank ratio active: ${bankRatio}:1 (ports are considered automatically).` : 'Bots evaluate and may accept or reject your offer.',
            { fontSize: '11px', color: '#5C4033', fontStyle: 'italic', align: 'center' }
        ).setOrigin(0.5);
        this.tradeContentContainer.add(hintText);

        const btnBg = this.add.graphics();
        btnBg.fillStyle(isActive ? 0x3e2723 : 0x222222, 1); 
        btnBg.fillRoundedRect(62, 232, 196, 44, 8);
        btnBg.setAlpha(isActive ? 1 : 0.5);
        this.tradeContentContainer.add(btnBg);

        const btnText = this.add.text(160, 254, 'SEND OFFER', { fontSize: '16px', color: '#DEB887', fontStyle: 'bold' }).setOrigin(0.5);
        btnText.setAlpha(isActive ? 1 : 0.5);
        this.tradeContentContainer.add(btnText);

        if (isActive) {
            const hitArea = this.add.rectangle(160, 254, 196, 44, 0x000000, 0);
            hitArea.setInteractive({ useHandCursor: true });
            hitArea.on('pointerdown', () => this.executeTradeOffer());
            this.tradeContentContainer.add(hitArea);
        }
    }

    private showTradeError(msg: string) {
        const errorText = this.add.text(160, 216, msg, { fontSize: '12px', color: '#cc0000', fontStyle: 'bold', align: 'center', stroke: '#ffffff', strokeThickness: 2 }).setOrigin(0.5);
        this.tradeContentContainer.add(errorText);
        this.time.delayedCall(2000, () => errorText.destroy());
    }

    private showTradeNotification(message: string) {
        const info = this.add.text(160, 216, message, {
            fontSize: '12px', color: '#1b5e20', fontStyle: 'bold', align: 'center', stroke: '#ffffff', strokeThickness: 2
        }).setOrigin(0.5);
        this.tradeContentContainer.add(info);
        this.time.delayedCall(2000, () => info.destroy());
    }

    private getClosestIntersectionIndex(target: Phaser.Math.Vector2): number {
        let bestIndex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        this.intersections.forEach((intersection, index) => {
            const dist = Phaser.Math.Distance.Between(intersection.x, intersection.y, target.x, target.y);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestIndex = index;
            }
        });
        return bestDistance <= 20 ? bestIndex : -1;
    }

    private getPortResource(icon: PortData['icon']): ResourceKey | null {
        return icon === 'question' ? null : icon;
    }

    private applyBoardSeed(seed: number) {
        this.boardSeed = seed >>> 0;
        this.boardRng = new SeededRandom(this.boardSeed);
        this.devRng = new SeededRandom(this.boardSeed ^ 0x5bf03635);
    }

    private regenerateBoard() {
        this.boardContainer?.removeAll(true);
        this.buildingsContainer = this.add.container(0, 0);
        this.intersections = [];
        this.edges = [];
        this.hexes = [];
        this.ports = [];
        this.interactiveSpots = [];
        this.lastBuiltSettlement = null;
        this.lastBotSettlement = null;
        this.robberGraphics = undefined as unknown as Phaser.GameObjects.Graphics;

        this.boardRng = new SeededRandom(this.boardSeed);
        this.generateBoard();
        this.boardContainer.add(this.buildingsContainer);
        this.renderSetupSpots();
    }

    private generateBoard() {
        this.ports = [];
        const hexSize = 65;
        const RES = {
            LUMBER: { color: 0x228B22, icon: 'log' }, WOOL: { color: 0x90EE90, icon: 'sheep' }, GRAIN: { color: 0xFFD700, icon: 'wheat' },
            BRICK: { color: 0xD2691E, icon: 'brick' }, ORE: { color: 0x708090, icon: 'stone' }, DESERT: { color: 0xF5DEB3, icon: null }
        };

        const terrainDeck = [...Array(4).fill(RES.LUMBER), ...Array(4).fill(RES.WOOL), ...Array(4).fill(RES.GRAIN), ...Array(3).fill(RES.BRICK), ...Array(3).fill(RES.ORE), RES.DESERT];
        this.boardRng.shuffle(terrainDeck);

        const numberDeck = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
        this.boardRng.shuffle(numberDeck);

        let desertPos = { x: 0, y: 0 };

        for (let q = -2; q <= 2; q++) {
            for (let r = -2; r <= 2; r++) {
                if (Math.abs(q + r) <= 2) {
                    const x = hexSize * Math.sqrt(3) * (q + r / 2);
                    const y = hexSize * 3 / 2 * r;
                    const hexData = terrainDeck.pop()!;

                    let numberToken = null;
                    if (hexData.icon !== null) { numberToken = numberDeck.pop()!; } else { desertPos = { x, y }; }
                    this.drawHexagon(x, y, hexSize, hexData, numberToken);
                }
            }
        }

        const portData: PortData[] = [
            { q: 0, r: -3, tq: 0, tr: -2, ratio: '3:1', icon: 'question' }, { q: 2, r: -3, tq: 1, tr: -2, ratio: '2:1', icon: 'wheat' },
            { q: 3, r: -2, tq: 2, tr: -2, ratio: '2:1', icon: 'stone' }, { q: 3, r: 0, tq: 2, tr: 0, ratio: '3:1', icon: 'question' },
            { q: 1, r: 2, tq: 0, tr: 2, ratio: '2:1', icon: 'sheep' }, { q: -1, r: 3, tq: -1, tr: 2, ratio: '3:1', icon: 'question' },
            { q: -3, r: 3, tq: -2, tr: 2, ratio: '3:1', icon: 'question' }, { q: -3, r: 1, tq: -2, tr: 1, ratio: '2:1', icon: 'brick' },
            { q: -2, r: -1, tq: -2, tr: 0, ratio: '2:1', icon: 'log' }
        ];
        portData.forEach(port => this.drawBoatAndDocks(port, hexSize));
        this.createRobber(desertPos.x, desertPos.y);
    }

    private drawHexagon(x: number, y: number, size: number, hexData: any, numberToken: number | null) {
        const graphics = this.add.graphics();
        graphics.fillStyle(hexData.color, 1);
        graphics.lineStyle(4, 0x111111, 0.8);
        
        const currentPoints: Intersection[] = [];
        
        graphics.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle_rad = Math.PI / 180 * (60 * i - 30);
            const px = x + size * Math.cos(angle_rad);
            const py = y + size * Math.sin(angle_rad);
            
            if (i === 0) graphics.moveTo(px, py);
            else graphics.lineTo(px, py);

            let foundInt = this.intersections.find(int => Phaser.Math.Distance.Between(int.x, int.y, px, py) < 10);
            if (!foundInt) {
                foundInt = { x: px, y: py, owner: null, type: null };
                this.intersections.push(foundInt);
            }
            currentPoints.push(foundInt);
        }
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();
        this.boardContainer.add(graphics);

        for (let i = 0; i < 6; i++) {
            const p1 = currentPoints[i];
            const p2 = currentPoints[(i + 1) % 6];
            
            let foundEdge = this.edges.find(e => 
                (Phaser.Math.Distance.Between(e.x1, e.y1, p1.x, p1.y) < 10 && Phaser.Math.Distance.Between(e.x2, e.y2, p2.x, p2.y) < 10) ||
                (Phaser.Math.Distance.Between(e.x1, e.y1, p2.x, p2.y) < 10 && Phaser.Math.Distance.Between(e.x2, e.y2, p1.x, p1.y) < 10)
            );
            
            if (!foundEdge) {
                this.edges.push({
                    x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, owner: null,
                    cx: (p1.x + p2.x)/2, cy: (p1.y + p2.y)/2,
                    angle: Phaser.Math.Angle.Between(p1.x, p1.y, p2.x, p2.y)
                });
            }
        }

        const resKey = hexData.icon;
        this.hexes.push({ x, y, resource: resKey, numberToken, hasRobber: resKey === null });

        if (hexData.icon !== null && numberToken !== null) {
            const resIcon = this.add.image(x, y - 18, hexData.icon);
            resIcon.setDisplaySize(35, 35);
            this.boardContainer.add(resIcon);

            graphics.fillStyle(0xFFF8DC, 1); 
            graphics.lineStyle(2, 0x111111, 0.5);
            graphics.fillCircle(x, y + 12, 16);
            graphics.strokeCircle(x, y + 12, 16);

            const fontColor = (numberToken === 6 || numberToken === 8) ? '#ff0000' : '#000000';
            const text = this.add.text(x, y + 12, numberToken.toString(), { fontSize: '18px', color: fontColor, fontFamily: 'Arial', fontStyle: 'bold' }).setOrigin(0.5);
            this.boardContainer.add(text);
        }
    }

    private createRobber(x: number, y: number) {
        this.robberGraphics = this.add.graphics();
        this.robberGraphics.setPosition(x, y);
        this.robberGraphics.fillStyle(0x111111, 1);
        this.robberGraphics.lineStyle(1.5, 0xffffff, 0.5);
        this.robberGraphics.fillEllipse(0, 12, 24, 10);
        this.robberGraphics.strokeEllipse(0, 12, 24, 10);
        this.robberGraphics.beginPath();
        this.robberGraphics.moveTo(-8, 10);
        this.robberGraphics.lineTo(8, 10);
        this.robberGraphics.lineTo(4, -8);
        this.robberGraphics.lineTo(-4, -8);
        this.robberGraphics.closePath();
        this.robberGraphics.fillPath();
        this.robberGraphics.strokePath();
        this.robberGraphics.fillEllipse(0, -6, 14, 6);
        this.robberGraphics.strokeEllipse(0, -6, 14, 6);
        this.robberGraphics.fillCircle(0, -14, 8);
        this.robberGraphics.strokeCircle(0, -14, 8);
        this.boardContainer.add(this.robberGraphics);
    }

    private drawBoatAndDocks(portInfo: PortData, hexSize: number) {
        let px = hexSize * Math.sqrt(3) * (portInfo.q + portInfo.r / 2);
        let py = hexSize * 3 / 2 * portInfo.r;

        const dir = new Phaser.Math.Vector2(px, py).normalize();
        px += dir.x * 55;
        py += dir.y * 55;

        const tx = hexSize * Math.sqrt(3) * (portInfo.tq + portInfo.tr / 2);
        const ty = hexSize * 3 / 2 * portInfo.tr;

        const landVertices = [];
        for (let i = 0; i < 6; i++) {
            const angle_rad = Math.PI / 180 * (60 * i - 30);
            landVertices.push(new Phaser.Math.Vector2(tx + hexSize * Math.cos(angle_rad), ty + hexSize * Math.sin(angle_rad)));
        }

        landVertices.sort((a, b) => Phaser.Math.Distance.Between(px, py, a.x, a.y) - Phaser.Math.Distance.Between(px, py, b.x, b.y));

        const graphics = this.add.graphics();
        this.boardContainer.add(graphics);

        const drawBridge = (startX: number, startY: number, endX: number, endY: number) => {
            graphics.lineStyle(6, 0x5C4033, 1);
            graphics.beginPath();
            graphics.moveTo(startX, startY);
            graphics.lineTo(endX, endY);
            graphics.strokePath();

            const dx = endX - startX, dy = endY - startY;
            const length = Math.sqrt(dx * dx + dy * dy);
            const nx = dx / length, ny = dy / length;
            
            graphics.lineStyle(2, 0x111111, 0.85);
            for (let d = 12; d < length - 5; d += 12) {
                const cx = startX + nx * d, cy = startY + ny * d;
                graphics.beginPath();
                graphics.moveTo(cx - (-ny) * 5, cy - nx * 5);
                graphics.lineTo(cx + (-ny) * 5, cy + nx * 5);
                graphics.strokePath();
            }
        };

        drawBridge(px, py, landVertices[0].x, landVertices[0].y);
        drawBridge(px, py, landVertices[1].x, landVertices[1].y);

        const firstIndex = this.getClosestIntersectionIndex(landVertices[0]);
        const secondIndex = this.getClosestIntersectionIndex(landVertices[1]);
        if (firstIndex >= 0 && secondIndex >= 0) {
            this.ports.push({
                ratio: parseInt(portInfo.ratio[0], 10),
                resource: this.getPortResource(portInfo.icon),
                intersectionIndices: [firstIndex, secondIndex]
            });
            
            [firstIndex, secondIndex].forEach(intIndex => {
                const int = this.intersections[intIndex];
                const portIndicator = this.add.graphics();
                portIndicator.lineStyle(3, 0xFFD700, 0.9);
                portIndicator.strokeCircle(int.x, int.y, 18);
                portIndicator.fillStyle(0xFFD700, 0.15);
                portIndicator.fillCircle(int.x, int.y, 18);
                this.boardContainer.add(portIndicator);
            });
        }

        const boatImg = this.add.image(px, py, 'boat');
        boatImg.setDisplaySize(136, 136); 
        this.boardContainer.add(boatImg);

        const text = this.add.text(px, py + 36, portInfo.ratio, { fontSize: '24px', color: '#ffffff', fontFamily: 'Arial', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5);
        this.boardContainer.add(text);

        const resourceImg = this.add.image(px, py - 24, portInfo.icon);
        resourceImg.setDisplaySize(60, 60); 
        this.boardContainer.add(resourceImg);
    }

    private updateBackgroundSize(width: number, height: number) {
        this.bg.setPosition(width / 2, height / 2);
        const scale = Math.max(width / this.bg.width, height / this.bg.height); 
        this.bg.setScale(scale);
    }

    private lightenColor(color: number, amount: number): number {
        const red = Math.min(255, ((color >> 16) & 0xff) + amount);
        const green = Math.min(255, ((color >> 8) & 0xff) + amount);
        const blue = Math.min(255, (color & 0xff) + amount);
        return (red << 16) | (green << 8) | blue;
    }
}

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO, parent: 'game-container',
    dom: { createContainer: true },
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [MainMenuScene, GameSelectionScene, MultiplayerScene, MainScene],
};

new Phaser.Game(config);