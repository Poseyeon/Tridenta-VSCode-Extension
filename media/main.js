(function () {
    const vscode = acquireVsCodeApi();

    const initialState = {
        authenticated: false,
        tables: [],
        connection: {
            mode: "login",
            host: "127.0.0.1",
            port: 5555,
            databaseName: "",
            username: ""
        },
        result: {
            kind: "message",
            message: "Bereit. Verbinde dich mit dem lokalen Tridenta-Server."
        }
    };

    const state = {
        ...initialState
    };

    const app = document.getElementById("app");

    function post(type, payload) {
        vscode.postMessage(payload ? { type, payload } : { type });
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function renderLogin() {
        const connection = state.connection || initialState.connection;
        app.innerHTML = `
            <section class="shell auth-shell">
                <div class="hero">
                    <p class="eyebrow">Tridenta SQL Panel</p>
                    <h1>VS Code WebView fuer TridentaDB</h1>
                    <p class="subtle">
                        Die Extension spricht ueber das Backend mit dem vorhandenen TCP-Server aus <code>src/bin/server.rs</code>.
                    </p>
                </div>
                <div class="card">
                    <div class="mode-toggle">
                        <button class="mode-btn ${connection.mode === "login" ? "active" : ""}" data-mode="login">Login</button>
                        <button class="mode-btn ${connection.mode === "setup" ? "active" : ""}" data-mode="setup">Setup</button>
                    </div>
                    <form id="auth-form" class="form-grid">
                        <label>
                            <span>Host</span>
                            <input name="host" value="${escapeHtml(connection.host || "127.0.0.1")}" />
                        </label>
                        <label>
                            <span>Port</span>
                            <input name="port" type="number" value="${escapeHtml(connection.port || 5555)}" />
                        </label>
                        <label class="${connection.mode === "setup" ? "" : "hidden"}" data-setup-only="true">
                            <span>Datenbankname</span>
                            <input name="databaseName" value="${escapeHtml(connection.databaseName || "")}" />
                        </label>
                        <label>
                            <span>Benutzername</span>
                            <input name="username" value="${escapeHtml(connection.username || "")}" />
                        </label>
                        <label>
                            <span>Passwort</span>
                            <input name="password" type="password" value="" />
                        </label>
                        <button type="submit" class="primary wide">
                            ${connection.mode === "setup" ? "Datenbank erstellen" : "Anmelden"}
                        </button>
                    </form>
                    ${renderResultCard()}
                </div>
            </section>
        `;

        app.querySelectorAll(".mode-btn").forEach((button) => {
            button.addEventListener("click", () => {
                state.connection.mode = button.getAttribute("data-mode");
                render();
            });
        });

        app.querySelector("#auth-form").addEventListener("submit", (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const payload = {
                mode: state.connection.mode || "login",
                host: String(formData.get("host") || "127.0.0.1"),
                port: Number(formData.get("port") || 5555),
                databaseName: String(formData.get("databaseName") || ""),
                username: String(formData.get("username") || ""),
                password: String(formData.get("password") || "")
            };

            state.connection = { ...state.connection, ...payload };
            state.result = { kind: "message", message: "Verbindung wird aufgebaut..." };
            render();
            post("submitLogin", payload);
        });
    }

    function renderWorkspace() {
        const connection = state.connection || initialState.connection;
        app.innerHTML = `
            <section class="shell workspace-shell">
                <aside class="sidebar card">
                    <div>
                        <p class="eyebrow">Verbunden</p>
                        <h2>${escapeHtml(connection.username || "Benutzer")}</h2>
                        <p class="subtle">${escapeHtml(connection.host)}:${escapeHtml(connection.port)}</p>
                    </div>
                    <div class="table-head">
                        <h3>Tabellen</h3>
                        <button id="refresh-tables" class="ghost">Aktualisieren</button>
                    </div>
                    <div class="table-list">
                        ${state.tables.length
                            ? state.tables
                                  .map(
                                      (table) =>
                                          `<button class="table-item" data-table="${escapeHtml(table)}">${escapeHtml(table)}</button>`
                                  )
                                  .join("")
                            : `<p class="subtle">Noch keine Tabellen gefunden.</p>`}
                    </div>
                </aside>
                <main class="main-stack">
                    <section class="card">
                        <div class="editor-head">
                            <div>
                                <p class="eyebrow">SQL</p>
                                <h2>Query ausfuehren</h2>
                            </div>
                            <div class="actions">
                                <button id="run-query" class="primary">Run Query</button>
                                <button id="clear-query" class="ghost">Clear</button>
                            </div>
                        </div>
                        <textarea id="sql-editor" spellcheck="false" placeholder="SELECT * FROM users;">${escapeHtml(
                            state.query || ""
                        )}</textarea>
                        <p class="subtle">Tipp: Mit Cmd/Ctrl + Enter ausfuehren.</p>
                    </section>
                    <section class="card">
                        <div class="editor-head">
                            <div>
                                <p class="eyebrow">Ergebnis</p>
                                <h2>Response</h2>
                            </div>
                        </div>
                        ${renderResultCard()}
                    </section>
                </main>
            </section>
        `;

        app.querySelector("#refresh-tables").addEventListener("click", () => {
            post("refreshTables");
        });

        app.querySelectorAll(".table-item").forEach((button) => {
            button.addEventListener("click", () => {
                const table = button.getAttribute("data-table");
                state.query = `SELECT * FROM ${table}`;
                render();
            });
        });

        const editor = app.querySelector("#sql-editor");
        editor.addEventListener("input", (event) => {
            state.query = event.currentTarget.value;
        });
        editor.addEventListener("keydown", (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                runQuery();
            }
        });

        app.querySelector("#run-query").addEventListener("click", runQuery);
        app.querySelector("#clear-query").addEventListener("click", () => {
            state.query = "";
            render();
        });
    }

    function runQuery() {
        state.result = { kind: "message", message: "Query wird ausgefuehrt..." };
        render();
        post("executeQuery", { sql: state.query || "" });
    }

    function renderResultCard() {
        const result = state.result || initialState.result;

        if (result.kind === "table") {
            return `
                <div class="result-wrap">
                    <table class="result-table">
                        <thead>
                            <tr>${result.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
                        </thead>
                        <tbody>
                            ${result.rows
                                .map(
                                    (row) =>
                                        `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`
                                )
                                .join("")}
                        </tbody>
                    </table>
                    <pre class="raw-output">${escapeHtml(result.raw)}</pre>
                </div>
            `;
        }

        return `
            <div class="result-wrap">
                <pre class="raw-output ${result.kind === "error" ? "error" : ""}">${escapeHtml(
                    result.message || result.raw || ""
                )}</pre>
            </div>
        `;
    }

    function render() {
        if (state.authenticated) {
            renderWorkspace();
        } else {
            renderLogin();
        }
    }

    window.addEventListener("message", (event) => {
        const message = event.data;

        switch (message.type) {
            case "state":
                state.authenticated = Boolean(message.state.authenticated);
                state.tables = Array.isArray(message.state.tables) ? message.state.tables : [];
                state.connection = {
                    ...state.connection,
                    ...(message.state.connection || {})
                };
                break;
            case "authResult":
                state.result = message.success
                    ? { kind: "message", message: message.message || "Login erfolgreich." }
                    : { kind: "error", message: message.error || "Login fehlgeschlagen." };
                if (message.success) {
                    state.authenticated = true;
                }
                break;
            case "queryResult":
                state.result = message.result;
                break;
            default:
                break;
        }

        render();
    });

    render();
    post("ready");
})();
