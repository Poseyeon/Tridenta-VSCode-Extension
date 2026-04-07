import * as net from "net";
import * as vscode from "vscode";

type AuthMode = "login" | "setup";

type WebviewRequest =
    | {
          type: "ready";
      }
    | {
          type: "submitLogin";
          payload: ConnectionPayload;
      }
    | {
          type: "executeQuery";
          payload: {
              sql: string;
          };
      }
    | {
          type: "refreshTables";
      };

type ConnectionPayload = {
    mode: AuthMode;
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
};

type SessionState = {
    authenticated: boolean;
    connection?: ConnectionPayload;
    tables: string[];
};

type StructuredResult = {
    raw: string;
    kind: "message" | "table" | "error";
    message?: string;
    columns?: string[];
    rows?: string[][];
};

export function activate(context: vscode.ExtensionContext): void {
    const provider = new TridentaSidebarViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("tridenta.sidebarView", provider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        })
    );
}

export function deactivate(): void {
    return;
}

class TridentaSidebarViewProvider implements vscode.WebviewViewProvider {
    private readonly extensionUri: vscode.Uri;
    private view?: vscode.WebviewView;
    private readonly state: SessionState = {
        authenticated: false,
        tables: []
    };

    public constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        this.registerMessageHandlers(webviewView.webview);
    }

    private registerMessageHandlers(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(async (message: WebviewRequest) => {
            switch (message.type) {
                case "ready":
                    this.postState();
                    break;
                case "submitLogin":
                    await this.handleAuthentication(message.payload);
                    break;
                case "executeQuery":
                    await this.handleExecuteQuery(message.payload.sql);
                    break;
                case "refreshTables":
                    await this.refreshTables();
                    break;
                default:
                    break;
            }
        });
    }

    private async handleAuthentication(payload: ConnectionPayload): Promise<void> {
        const host = payload.host.trim() || "127.0.0.1";
        const port = Number(payload.port) || 5555;
        const username = payload.username.trim();
        const password = payload.password.trim();
        const databaseName = payload.databaseName.trim();

        if (!username || !password) {
            this.postMessage({
                type: "authResult",
                success: false,
                error: "Bitte Benutzername und Passwort angeben."
            });
            return;
        }

        if (payload.mode === "setup" && !databaseName) {
            this.postMessage({
                type: "authResult",
                success: false,
                error: "Für das Setup wird ein Datenbankname benötigt."
            });
            return;
        }

        const sql =
            payload.mode === "setup"
                ? `CREATE DATABASE ${databaseName}\nWITH USER ${username}\nSET PASSWORD ${password};`
                : `LOGIN USER ${username} SET PASSWORD ${password};`;

        try {
            const raw = await queryServer(host, port, sql);
            const success = !raw.toLowerCase().startsWith("error");

            if (!success) {
                this.postMessage({
                    type: "authResult",
                    success: false,
                    error: raw
                });
                return;
            }

            this.state.authenticated = true;
            this.state.connection = {
                ...payload,
                host,
                port,
                username,
                password,
                databaseName
            };

            await this.refreshTables();

            this.postMessage({
                type: "authResult",
                success: true,
                message: raw
            });
        } catch (error) {
            this.postMessage({
                type: "authResult",
                success: false,
                error: toErrorMessage(error)
            });
        }
    }

    private async handleExecuteQuery(sql: string): Promise<void> {
        if (!this.state.authenticated || !this.state.connection) {
            this.postMessage({
                type: "queryResult",
                result: {
                    kind: "error",
                    raw: "Nicht angemeldet.",
                    message: "Bitte zuerst erfolgreich verbinden."
                }
            });
            return;
        }

        const trimmed = sql.trim();
        if (!trimmed) {
            this.postMessage({
                type: "queryResult",
                result: {
                    kind: "message",
                    raw: "",
                    message: "Bitte eine SQL-Query eingeben."
                }
            });
            return;
        }

        try {
            const raw = await queryServer(
                this.state.connection.host,
                this.state.connection.port,
                trimmed
            );
            const result = parseResult(raw);
            this.postMessage({
                type: "queryResult",
                result
            });

            if (/^\s*(create|truncate|insert|update|show)\b/i.test(trimmed)) {
                await this.refreshTables();
            }
        } catch (error) {
            this.postMessage({
                type: "queryResult",
                result: {
                    kind: "error",
                    raw: toErrorMessage(error),
                    message: toErrorMessage(error)
                }
            });
        }
    }

    private async refreshTables(): Promise<void> {
        if (!this.state.authenticated || !this.state.connection) {
            this.state.tables = [];
            this.postState();
            return;
        }

        try {
            const raw = await queryServer(
                this.state.connection.host,
                this.state.connection.port,
                "SHOW TABLES"
            );
            this.state.tables = raw
                .split(/\r?\n/g)
                .filter((line) => line.startsWith("- "))
                .map((line) => line.slice(2).trim());
        } catch {
            this.state.tables = [];
        }

        this.postState();
    }

    private postState(): void {
        this.postMessage({
            type: "state",
            state: {
                authenticated: this.state.authenticated,
                tables: this.state.tables,
                connection: this.state.connection
                    ? {
                          mode: this.state.connection.mode,
                          host: this.state.connection.host,
                          port: this.state.connection.port,
                          databaseName: this.state.connection.databaseName,
                          username: this.state.connection.username
                      }
                    : undefined
            }
        });
    }

    private postMessage(message: unknown): void {
        this.view?.webview.postMessage(message);
    }

    private getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "main.js")
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "styles.css")
        );
        const nonce = createNonce();

        return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Tridenta SQL Panel</title>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function queryServer(host: string, port: number, query: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let response = "";

        client.setTimeout(10_000);

        client.connect(port, host, () => {
            client.write(query);
        });

        client.on("data", (chunk: Buffer) => {
            response += chunk.toString("utf8");
        });

        client.on("end", () => {
            resolve(response.trim());
        });

        client.on("timeout", () => {
            client.destroy();
            reject(new Error("Zeitüberschreitung bei der Verbindung zum Tridenta-Server."));
        });

        client.on("error", (error: Error) => {
            reject(
                new Error(
                    `Verbindung zu ${host}:${port} fehlgeschlagen. Läuft \`cargo run --bin tridenta_db_server\`? (${error.message})`
                )
            );
        });
    });
}

function parseResult(raw: string): StructuredResult {
    const trimmed = raw.trim();

    if (!trimmed) {
        return {
            kind: "message",
            raw,
            message: "(Keine Ausgabe)"
        };
    }

    if (trimmed.toLowerCase().startsWith("error")) {
        return {
            kind: "error",
            raw,
            message: trimmed
        };
    }

    const lines = trimmed.split(/\r?\n/g).map((line) => line.trimEnd());
    if (lines.length >= 3 && /^\-+$/.test(lines[1].replace(/\s/g, "")) && lines[0].includes(" | ")) {
        const columns = lines[0].split(" | ").map((value) => value.trim());
        const rows = lines.slice(2).map((line) => line.split(" | ").map((value) => value.trim()));
        const isConsistent = rows.every((row) => row.length === columns.length);

        if (isConsistent) {
            return {
                kind: "table",
                raw,
                columns,
                rows
            };
        }
    }

    return {
        kind: "message",
        raw,
        message: trimmed
    };
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function createNonce(): string {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";
    for (let index = 0; index < 32; index += 1) {
        value += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return value;
}
