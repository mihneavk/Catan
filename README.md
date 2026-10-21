# 🏝️ Catan — The Island Awaits (Browser Edition)

Un joc de strategie inspirat din **Settlers of Catan**, construit pentru browser folosind **Phaser 3**, **TypeScript**, **Vite** și **WebSockets (`ws`)**. Jocul suportă atât modul **Singleplayer (împotriva boților AI)**, cât și modul **Multiplayer în timp real (2 jucători prin WebSocket)**.

---

## 📁 Arhitectura Proiectului și Cum Funcționează

Proiectul este împărțit în două componente principale: **Clientul (Frontend-ul Phaser)** și **Serverul de Multiplayer (Node.js WebSocket Relay)**.

### 1. Fișierele din `src/` (Clientul de Joc)
* **`src/main.ts`** — Conține întreaga logică a jocului Catan și 3 scene Phaser principale:
  * `MainMenuScene`: Ecranul de titlu unde jucătorul își alege numele (`username`) și selectează modul de joc (**Play Game** pentru joc cu boți sau **Multiplayer P2P** pentru joc în rețea).
  * `GameSelectionScene`: Lobby-ul local unde poți alege culoarea pionului și poți adăuga până la 3 boți AI.
  * `MainScene`: Tabla de joc propriu-zisă, randarea hexagoanelor, porturilor, intersecțiilor, drumurilor, meniul de construcție, schimburile comerciale (Trade), cărțile de dezvoltare (Dev Cards) și logica hoțului (Robber).
* **`src/multiplayer.ts` (`MultiplayerScene`)** — Interfața de conectare pentru Multiplayer. Permite introducerea adresei serverului WebSocket (`ws://localhost:9000`) și a ID-ului camerei (`roomId`), având opțiunile de **GAZDĂ (HOST)** și **ALĂTURĂ-TE (JOIN)**.
* **`src/network.ts` (`P2PNetwork`)** — Clasa care gestionează conexiunea WebSocket cu serverul și împachetează/despachetează toate acțiunile din joc (`ROLL_DICE`, `BUILD_ROAD`, `BUILD_SETTLEMENT`, `BUILD_CITY`, `BUY_DEV_CARD`, `TRADE`, `END_TURN`, `BOARD_SEED`, `SETUP_PLACEMENT`).
* **`src/rng.ts` (`SeededRandom`)** — Generator determinist de numere pseudo-aleatoare (algoritmul *Mulberry32*). Asigură că, pornind de la un singur număr (`boardSeed`) generat de Gazdă (Host), ambii jucători generează **exact aceeași tablă de joc** (aceleași resurse pe hexagoane, aceleași jetoane cu numere și același pachet de cărți de dezvoltare).

### 2. Serverul de Multiplayer
* **`multiplayer-server.js`** — Un server Node.js bazat pe librăria `ws` care ascultă pe portul `9000`:
  * Ține evidența camerelor de joc active (`rooms`) și a seed-ului tablei pentru fiecare cameră (`roomSeeds`).
  * Când Gazda creează o cameră (`JOIN_ROOM`), serverul salvează `seed`-ul tablei.
  * Când al doilea jucător intră în aceeași cameră, serverul îi trimite automat `seed`-ul salvat și notifică Gazda (`PEER_JOINED`) pentru a porni meciul.
  * Toate mesajele de tip `GAME_MESSAGE` trimise de un jucător sunt redirecționate (relay) instantaneu către celălalt jucător din cameră.

---

## 🛠️ Cerințe Preliminare

Asigură-te că ai instalat pe calculator:
* **Node.js** (versiunea 18+ recomandată)
* **npm** (vine instalat automat împreună cu Node.js)

---

## 🚀 Cum se instalează și se rulează proiectul

Pentru a juca în modul **Multiplayer**, ai nevoie de **două terminale deschise simultan** în folderul proiectului (`C:\Users\...\catan-clone`).

### Pasul 1: Instalarea dependențelor (se face o singură dată)
Deschide un terminal în folderul proiectului și rulează:
```bash
npm install