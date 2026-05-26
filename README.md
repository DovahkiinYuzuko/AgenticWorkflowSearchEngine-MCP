# Agentic Workflow Search Engine MCP

[JPN] OllamaとPlaywrightを活用した、自律的で多段階なWeb・学術論文検索とコンテンツ要約を行うModel Context Protocol (MCP) サーバーです。  
[ENG] An autonomous, multi-stage web and academic search engine MCP server utilizing Ollama and Playwright.

[![Node.js](https://img.shields.io/badge/Node.js-v18+-blue.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-orange.svg)](https://modelcontextprotocol.io)
[![Playwright](https://img.shields.io/badge/Playwright-v1.40+-green.svg)](https://playwright.dev/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_AI-red.svg)](https://ollama.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[日本語](#日本語) | [English](#english)

---

## 日本語

本プロジェクトは、AIエージェント（Claude Desktop、Cursor、Roo Codeなど）が、単なる検索キーワードのクエリを超えて、自律的かつ高度なWeb・学術調査タスクを実行できるように設計されたMCPサーバーです。

### 開発の背景・設計思想 (Motivation & Philosophy)

本ツールは、単なる利便性だけでなく「安全性」と「透明性」を重視して設計されています。
- **サイト運営者への配慮 (Be gentle to web servers)**: 大量リクエストを送りつけるスクレイピングではなく、あえてPlaywrightによる「ブラウザ経由での通常のアクセス手法」を採用し、サイト運営側のサーバー負荷を最小限に抑えています。
- **透明性の確保 (Transparency)**: ブラウザをHeadlessモードにせず意図的に可視化し、さらにOllamaの推論過程を別ウィンドウ（Viewer）で表示する仕様にしています。これにより、「AIが今どのページを見て、何を考えているのか」がブラックボックス化せず、ユーザーが常に監視・把握できるようになっています。
- **コンテキスト汚染の防止 (Preventing Context Pollution)**: ページごとにセッションを完全に区切り、長文は適切に文字数制限でチャンク分割して処理することで、LLMのハルシネーション（情報の混同）やメモリ溢れをシステムレベルで防いでいます。

### 主な機能

1. **ブラウザ経由のクローリング＆Markdown/PDF抽出**:
   Playwrightで対象のWebページにブラウザとしてアクセスし、ヘッダーや広告などを除外したMarkdownテキストへ抽出します。対象URLがPDFファイルの場合はダウンロードしてテキスト解析を行います。
2. **ローカルOllamaによる情報抽出 (Refinement)**:
   ローカルで動作するOllamaのモデルを用いて、ユーザーの「検索意図 (intent)」に基づいた情報抽出と要約の生成を行います。
3. **学術検索モード (Academic Search Mode)**:
   arXivやPubMedの公式APIを利用して学術論文を直接検索・取得する専用モード（`mode="academic"`）を搭載しています。スクレイピング不要のため安定した論文検索が可能です。
4. **自律的二段階検索 (Autonomous Deep-Dive)**:
   最初の調査結果をAIが評価し、さらに深掘りすべきトピックが見つかった場合、自ら次の検索キーワードを設定して二次調査を実行します。
5. **逆引き物理インデックス機能**:
   調査結果はすべて `artifacts/` 配下に「検索キーワード」ごとに整理されて保存されます。各調査には `index.csv` というマップテーブルが自動生成され、MCPのリソース機能 (`mcp://artifacts/{keyword}/index.csv`) 経由でAIがこれらの生データへアクセスできます。

---

### 前提条件

動作には以下の環境が必要です：
- **Node.js**: `v18.0.0` 以上
- **Ollama**: ローカル環境で起動していること（デフォルト: `http://127.0.0.1:11434`）
  - 使用するモデル（例: `gemma4-e4b-custom-uncensored:latest` や `gemma:latest` など）が事前にプルされている必要があります。
  - モデル名やホストURLは `config.json` で自由に変更可能です。

---

### インストール・実行方法

本ツールはnpmパッケージとして公開されているため、事前のインストールやGitクローンは不要です。`npx` コマンドで直接実行できます。

```powershell
# 初回実行時にパッケージとPlaywrightブラウザが自動セットアップされます
npx aw-se --help
```
*(※ソースコードを直接編集したい開発者の場合は、従来通り `git clone` してご利用ください)*

---

### AIアシスタントへの導入方法 (Installation for AI Assistants)

npmパッケージとして公開されているため、各AIアシスタントのCLIや設定から一発で導入可能です。

#### 1. CLIから一撃で導入する場合 (推奨)

**Claude Code**:
```bash
claude mcp add aw-se-mcp -- npx -y agentic-workflow-search-engine-mcp
```

**Antigravity 2.0**:
```bash
antigravity mcp add aw-se-mcp -- npx -y agentic-workflow-search-engine-mcp
```

**Cursor / Windsurf など**:
Universal MCP Installerを使用すると自動で設定ファイルに書き込まれます。
```bash
npx universal-mcp-installer install agentic-workflow-search-engine-mcp
```

#### 2. 手動で設定ファイル (claude_desktop_config.json 等) に追記する場合

Claude Desktopなどの場合は、以下の設定を `mcpServers` に追加してください。

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS / Linux**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "npx",
      "args": [
        "-y",
        "agentic-workflow-search-engine-mcp"
      ]
    }
  }
}
```
これだけで、次回起動時に自動で最新版がダウンロードされ、MCPサーバーとして認識されます。

---

### 提供されるツールとパラメータ仕様

MCPサーバーを登録すると、AIは以下の `search_and_extract` ツールを利用できるようになります。

#### ツール名: `search_and_extract`
キーワード検索を実行し、Playwrightで各ページの中身を取得・クレンジングしたのち、ローカルOllamaを用いて「検索意図」に沿って情報を抽出します。

##### パラメータ仕様:

| パラメータ名    |    型     |  必須   | デフォルト値 | 説明                                                                                                                                                  |
| :-------------- | :-------: | :-----: | :----------: | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keywords`      | `string`  | **Yes** |      -       | 検索したいキーワードを入力します。（例: `"量子コンピューター 実用化 2026"`）                                                                          |
| `intent`        | `string`  | **Yes** |      -       | 検索で『どういう情報を取捨選択し、どう整理してほしいか』という具体的な目的を入力します。（例: `"企業別のロードマップと実用化予定時期を抽出"`）        |
| `limit`         | `number`  |   No    |     `5`      | 検索結果から実際に巡回・クローリングする最大ページ数を指定します。                                                                                    |
| `final_summary` | `boolean` |   No    |   `false`    | 全ページを巡回し個別の抽出が終わった後に、全体の情報を総合した最終まとめレポートを生成するかどうか。                                                  |
| `mode`          | `string`  |   No    |   `"web"`    | 検索のモード。`"web"` (通常のWebクローリング) または `"academic"` (arXiv & PubMedの公式API経由の論文検索)。                                           |
| `deep_dive`     | `string`  |   No    |   `"auto"`   | 自律的な二段階検索の挙動。`"auto"` (一次結果をAIが評価し自動で深掘り検索を実行)、または `"none"` (深掘りを行わず、推奨検索キーワードの提示に留める)。 |

---

### 設定ファイル (config.json) のカスタマイズ

本ツールはダウンロード時に同梱されている `config.json` の設定をデフォルト値として動作します。環境に合わせて適宜書き換えて使用してください。設定ファイルが存在しない場合（`npx` での初回起動時など）は、自動的にデフォルト設定ファイルが生成されます。

| カテゴリ   | パラメータ名      | デフォルト値               | 役割・作用                                                           |
| :--------- | :---------------- | :------------------------- | :------------------------------------------------------------------- |
| **search** | `engine`          | `"https://www.bing.com"`   | 最初に使用する検索エンジンのURL。                                    |
|            | `defaultLimit`    | `5`                        | デフォルトの巡回ページ数（APIからの指定で上書き可能）。              |
|            | `slowMo`          | `500`                      | （サイト負荷軽減）ブラウザ操作の遅延時間（ミリ秒）。                 |
|            | `waitAfterSearch` | `3000`                     | （サイト負荷軽減）検索結果表示後の待機時間（ミリ秒）。               |
|            | `viewTime`        | `4000`                     | （サイト負荷軽減）各ページアクセス時の待機時間（ミリ秒）。           |
|            | `concurrency`     | `2`                        | 並列で処理する最大タブ数。増やすと速くなりますがメモリを消費します。 |
| **ollama** | `model`           | `"gemma4:e4b-it-q4_K_M"`   | 情報抽出に使用するローカルLLMのモデル名。                            |
|            | `host`            | `"http://127.0.0.1:11434"` | OllamaサーバーのエンドポイントURL。                                  |
|            | `maxInputChars`   | `-1`                       | LLMに渡すテキストの最大文字数制限。`-1` で無制限。                   |
|            | `system`          | (長文のため省略)           | 事前設定されるシステムプロンプト。客観的な情報抽出を指示しています。 |

---

### スタンドアロンCLIでの使い方

MCPサーバーとしてではなく、単体のコマンドラインツール（CLI）としてターミナルから直接実行し、調査レポートを出力させることも可能です。

```bash
# npx経由で実行（推奨・多機能）
npx aw-se --keywords "AIスマートグラス 最新動向" --intent "各メーカーのスペックと価格情報の抽出" --limit 3 --mode web --deep-dive auto --final-summary

# 位置引数による指定（簡易的）
# npx aw-se <キーワード> <検索意図> <件数> <最終要約フラグ: true/false>
npx aw-se "量子コンピューター 実用化 2026" "ロードマップの抽出" 3 true
```

---

### 成果物 (Artifacts) の構造

調査が完了すると、プロジェクトのルートにある `artifacts/` ディレクトリ配下に、検索クエリに基づいた以下のフォルダおよびファイルが物理的に出力されます。

```text
artifacts/
└── [検索キーワード]/
    ├── index.csv                   # クロールした全ページのタイトル、URL、対応ファイルパスの逆引きマップテーブル
    ├── summary.md                  # 全ページを横断した総合要約レポート（final_summaryが有効な場合）
    ├── page1_[ページタイトル].md   # キャプチャしたページの生テキストをクレンジングしたMarkdown
    └── page1_[ページタイトル].json # Ollamaによって検索意図に沿って構造化・抽出されたJSONデータ
```

---

### ライセンス

本プロジェクトは **MIT ライセンス** の下で公開されています。
著作権表記: Copyright (c) 2026 YuzukoUnderson

---

## English

This project is an MCP server designed to enable AI agents (such as Claude Desktop, Cursor, Roo Code, etc.) to perform highly autonomous and advanced web and academic research tasks, going far beyond simple keyword matching.

### Motivation & Philosophy

This tool is designed with a strong emphasis on "Safety" and "Transparency," beyond mere convenience.
- **Be gentle to web servers**: Instead of aggressive scraping that floods servers with requests, it uses standard browser automation via Playwright to navigate pages, minimizing the load on site operators.
- **Transparency**: The browser is intentionally kept visible (not headless), and Ollama's reasoning process is displayed in a separate viewer window. This prevents the AI's actions from becoming a black box, allowing users to monitor exactly what the AI is viewing and thinking in real-time.
- **Preventing Context Pollution**: By completely isolating sessions per page and chunking long texts appropriately, it systematically prevents LLM hallucinations (information mix-ups) and memory overflows.

### Key Features

1. **Browser-based Crawling & Markdown/PDF Extraction**:
   Accesses target web pages via Playwright and extracts content into Markdown, filtering out noise like headers and ads. If the target URL is a PDF, it downloads and parses the text directly.
2. **Local Ollama-Driven Content Refinement**:
   Uses a local Ollama model to extract information and generate summaries based on the user's specific "search intent."
3. **Academic Search Mode**:
   Provides a dedicated mode (`mode="academic"`) to search and retrieve academic papers directly using arXiv and PubMed official APIs, ensuring stable research without scraping.
4. **Autonomous Secondary Deep-Dive**:
   The AI evaluates the initial research findings and, if it identifies topics requiring further investigation, autonomously formulates the next search queries to execute a secondary deep-dive search.
5. **Dynamic Resource Indexing**:
   All research results are organized under the `artifacts/` folder by search keyword, automatically generating an `index.csv` mapping table. AI agents can access these raw data files via the MCP resource URI scheme (`mcp://artifacts/{keyword}/index.csv`).

---

### Prerequisites

- **Node.js**: `v18.0.0` or higher
- **Ollama**: Must be running locally (default: `http://127.0.0.1:11434`)
  - The model you plan to use (e.g., `gemma4-e4b-custom-uncensored:latest` or `gemma:latest`) must be pulled in advance.
  - You can customize the model name and endpoint host in `config.json`.

---

### Installation & Usage

Because this tool is published as an npm package, you do not need to clone the repository. You can run it instantly using `npx`.

```bash
# Run directly (Playwright browser will be setup automatically on first run)
npx aw-se --help
```
*(If you wish to modify the source code, you can still `git clone` the repository as usual.)*

---

### Installation for AI Assistants

Since the package is published on npm, you can install it instantly using CLI commands or configuration files.

#### 1. Quick Installation via CLI (Recommended)

**Claude Code**:
```bash
claude mcp add aw-se-mcp -- npx -y agentic-workflow-search-engine-mcp
```

**Antigravity 2.0**:
```bash
antigravity mcp add aw-se-mcp -- npx -y agentic-workflow-search-engine-mcp
```

**Cursor / Windsurf, etc.**:
Use the Universal MCP Installer to automatically configure your editor.
```bash
npx universal-mcp-installer install agentic-workflow-search-engine-mcp
```

#### 2. Manual Configuration (claude_desktop_config.json, etc.)

For Claude Desktop, add the following configuration to your `mcpServers` object.

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS / Linux**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "npx",
      "args": [
        "-y",
        "agentic-workflow-search-engine-mcp"
      ]
    }
  }
}
```
That's it! The client will automatically download and run the latest version on startup.

---

### Exposed Tool & Argument Specification

Once configured, the AI will gain access to the `search_and_extract` tool.

#### Tool Name: `search_and_extract`
Performs keyword searches, crawls each page using Playwright, sanitizes content to markdown, and utilizes a local Ollama model to refine and extract facts based on the search intent.

##### Parameters:

| Parameter       |   Type    | Required | Default  | Description                                                                                                                              |
| :-------------- | :-------: | :------: | :------: | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `keywords`      | `string`  | **Yes**  |    -     | The search terms. (e.g., `"academic hair follicle regeneration gene"`)                                                                   |
| `intent`        | `string`  | **Yes**  |    -     | Precise criteria describing what details to extract and organize. (e.g., `"Extract specific gene names and clinical trial phases"`)      |
| `limit`         | `number`  |    No    |   `5`    | Maximum number of search results to visit.                                                                                               |
| `final_summary` | `boolean` |    No    | `false`  | Whether to generate a single synthesized final answer crossing all pages.                                                                |
| `mode`          | `string`  |    No    | `"web"`  | Search mode: `"web"` (dynamic crawl) or `"academic"` (scrape-free API search via arXiv & PubMed).                                        |
| `deep_dive`     | `string`  |    No    | `"auto"` | Multi-phase deep-dive behavior: `"auto"` (AI autonomously plans and executes a secondary search) or `"none"` (AI only recommends terms). |

---

### Customizing Configuration (config.json)

The tool operates using the settings in the included `config.json` as default values. Please modify them according to your environment. If the file is missing (e.g., first run via `npx`), default settings will be generated automatically.

| Category   | Parameter         | Default Value              | Description                                                           |
| :--------- | :---------------- | :------------------------- | :-------------------------------------------------------------------- |
| **search** | `engine`          | `"https://www.bing.com"`   | The default search engine URL.                                        |
|            | `defaultLimit`    | `5`                        | Default number of pages to crawl (can be overridden by API).          |
|            | `slowMo`          | `500`                      | (Server load reduction) Delay between browser actions in ms.          |
|            | `waitAfterSearch` | `3000`                     | (Server load reduction) Wait time after loading search results in ms. |
|            | `viewTime`        | `4000`                     | (Server load reduction) Wait time on each visited page in ms.         |
|            | `concurrency`     | `2`                        | Maximum number of concurrent browser tabs.                            |
| **ollama** | `model`           | `"gemma4:e4b-it-q4_K_M"`   | The local LLM model name to use for extraction.                       |
|            | `host`            | `"http://127.0.0.1:11434"` | The endpoint URL of your Ollama server.                               |
|            | `maxInputChars`   | `-1`                       | Maximum characters sent to LLM per chunk. `-1` means unlimited.       |
|            | `system`          | (Omitted for brevity)      | The system prompt instructing the AI to remain objective and factual. |

---

### Standalone CLI Usage

You can also run this program as a standalone command-line interface directly in your terminal.

```bash
# Executing via npx with flags (Recommended)
npx aw-se --keywords "quantum computing roadmap" --intent "Extract timeline and major players" --limit 3 --mode web --deep-dive auto --final-summary

# Executing via npx with positional arguments (Simplified)
# npx aw-se <keywords> [intent] [limit] [final_summary]
npx aw-se "quantum computing roadmap" "Extract timeline" 3 true
```

---

### Output Artifacts Directory Structure

Once execution completes, research materials are saved in the `artifacts/` folder:

```text
artifacts/
└── [Keywords]/
    ├── index.csv                   # Dynamic index mapping crawled URLs to local files
    ├── summary.md                  # Comprehensive global synthesis (if final_summary=true)
    ├── page1_[PageTitle].md        # Crawled page content converted to sanitized Markdown
    └── page1_[PageTitle].json       # Structured JSON data containing the intent-refined facts
```

---

### License

This project is licensed under the **MIT License**.
Copyright (c) 2026 YuzukoUnderson
