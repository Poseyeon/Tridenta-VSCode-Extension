# Tridenta VS Code Extension

Diese Extension stellt ein SQL-Panel als VS-Code-WebView in der linken VS-Code-Sidebar bereit.

## Features

- Login- bzw. Setup-Screen fuer TridentaDB
- Kommunikation zwischen WebView und Extension-Backend via `postMessage`
- TCP-Anbindung an den vorhandenen Tridenta-Server aus `src/bin/server.rs`
- SQL-Eingabe im WebView-Editor
- Tabellenanzeige fuer `SELECT`-Ergebnisse

## Entwicklung

1. Im Root-Projekt den Server starten:

```bash
cargo run --bin tridenta_db_server
```

2. Im Extension-Ordner Abhaengigkeiten installieren und kompilieren:

```bash
cd Tridenta-VSCode-Extension
npm install
npm run compile
```

3. In VS Code die Extension im Development Host starten.

4. In der linken Activity Bar das Tridenta-Icon oeffnen.

Standardverbindung ist `127.0.0.1:5555`.
