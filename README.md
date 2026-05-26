# Agentic Workflow Search Engine MCP

OllamaとPlaywrightを活用した、自律的で多段階なWeb・学術論文検索とコンテンツ要約を行うユニバーサルなModel Context Protocol (MCP) サーバーです。

[![Node.js](https://img.shields.io/badge/Node.js-v18+-blue.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-orange.svg)](https://modelcontextprotocol.io)
[![Playwright](https://img.shields.io/badge/Playwright-v1.40+-green.svg)](https://playwright.dev/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_AI-red.svg)](https://ollama.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[日本語](#日本語) | [English](#english)

---

## 日本語

本プロジェクトは、AIエージェント（Claude Desktop、Cursor、Roo Codeなど）が、単なる検索キーワードのクエリを超えて、自律的かつ高度なWeb・学術調査タスクを実行できるように設計されたMCPサーバーです。

### 主な機能

1. **自律的クローリング＆PDF・Markdown変換**:
   Playwrightで対象のWebページにダイナミックにアクセスし、内容をPDFにレンダリングした上で、ノイズ（ヘッダー、フッター、広告など）を除外したきれいなMarkdownテキストへと自動抽出します。
2. **ローカルOllamaによる精緻な情報抽出 (Refinement)**:
   ローカルで動作するOllamaのモデルを用いて、ユーザーの「具体的な検索意図 (intent)」に完璧に合致する情報のみを抽出し、客観的で高精度なJSONデータおよび要約を生成します。
3. **学術モードへの自動フォールバック (Academic Mode)**:
   Webクローリング時にCAPTCHA（ロボット検証）などが発生してブロックされた場合、あるいは最初から論文を検索したい場合に、スクレイピング不要の公式API（arXiv & PubMed）へ自動的に切り替えて調査を続行します。
4. **自律的二段階検索 (Autonomous Deep-Dive)**:
   一次調査の結果をAI自身が自律的に評価し、未解決の問題やさらに深掘りすべきトピックを見つけ出すと、自ら次の検索キーワードと意図を設計して二次調査（深掘り）を自動実行します。
5. **逆引き物理インデックスとカスタムリソース機能**:
   調査結果はすべて `artifacts/` 配下に「検索キーワード」ごとに整理されて保存されます。各調査には `index.csv` という逆引きマップテーブルが自動生成され、MCPのリソース機能 (`mcp://artifacts/{keyword}/index.csv`) 経由でAIがいつでも生データへ物理的にピンポイントアクセスできます。

---

### 前提条件

動作には以下の環境が必要です：
- **Node.js**: `v18.0.0` 以上
- **Ollama**: ローカル環境で起動していること（デフォルト: `http://127.0.0.1:11434`）
  - 使用するモデル（例: `gemma4-e4b-custom-uncensored:latest` や `gemma:latest` など）が事前にプルされている必要があります。
  - モデル名やホストURLは `config.json` で自由に変更可能です。

---

### インストール方法

リポジトリをクローンし、依存パッケージのインストールとブラウザのセットアップを行います。

```powershell
# 1. リポジトリをクローン
git clone https://github.com/DovahkiinYuzuko/AgenticWorkflowSearchEngine-MCP.git
cd AgenticWorkflowSearchEngine-MCP

# 2. 依存パッケージのインストール
npm install

# 3. Playwrightのブラウザをインストール
npx playwright install chromium
```

---

### MCPサーバー設定方法（settings.jsonの書き方）

AIクライアント（例: Claude Desktop）でこのMCPサーバーを使用するための設定ファイルの記述例です。

#### 1. 設定ファイルの場所
各OSにおける設定ファイルの配置場所は以下の通りです：

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
  - エクスプローラーのアドレスバーに `%APPDATA%\Claude` と入力して移動できます。
- **macOS / Linux**: `~/Library/Application Support/Claude/claude_desktop_config.json`

#### 2. 設定JSONの記述例

お使いのOSと起動方法（`npx` での自動ビルド起動、または `node` での直接起動）に合わせて、以下のJSONを参考に `claude_desktop_config.json` に追記してください。

> [!WARNING]
> Windows環境では、パスのバックスラッシュ（`\`）をJSON内で正しくエスケープするために、必ずダブルスラッシュ（`\\`）またはスラッシュ（`/`）で記述してください。

##### オプションA: `npx` を利用した起動（推奨・ビルド不要で手軽）
リポジトリをダウンロードした場所の絶対パスを指定します。

**Windows用設定例:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "npx",
      "args": [
        "-y",
        "--prefix",
        "C:/Users/rikui/Documents/VSCode/AgenticWorkflowSearchEngine-MCP",
        "node",
        "./src/index.js"
      ]
    }
  }
}
```

**macOS / Linux用設定例:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "npx",
      "args": [
        "-y",
        "--prefix",
        "/Users/username/Documents/VSCode/AgenticWorkflowSearchEngine-MCP",
        "node",
        "./src/index.js"
      ]
    }
  }
}
```

##### オプションB: `node` で直接起動（高速・安定）
あらかじめリポジトリ内で `npm install` が完了している前提で、`node` コマンドで直接インデックスファイルを起動します。

**Windows用設定例:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "node",
      "args": [
        "C:/Users/rikui/Documents/VSCode/AgenticWorkflowSearchEngine-MCP/src/index.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**macOS / Linux用設定例:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "node",
      "args": [
        "/Users/username/Documents/VSCode/AgenticWorkflowSearchEngine-MCP/src/index.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

---

### 提供されるツールとパラメータ仕様

MCPサーバーを登録すると、AIは以下の `search_and_extract` ツールを利用できるようになります。

#### ツール名: `search_and_extract`
キーワード検索を実行し、Playwrightで各ページの中身を取得・クレンジングしたのち、ローカルOllamaを用いて「検索意図」に沿って情報を抽出します。

##### パラメータ仕様:

| パラメータ名 | 型 | 必須 | デフォルト値 | 説明 |
| :--- | :---: | :---: | :---: | :--- |
| `keywords` | `string` | **Yes** | - | 検索したいキーワードを入力します。（例: `"量子コンピューター 実用化 2026"`） |
| `intent` | `string` | **Yes** | - | 検索で『どういう情報を取捨選択し、どう整理してほしいか』という具体的な目的を入力します。（例: `"企業別のロードマップと実用化予定時期を抽出"`） |
| `limit` | `number` | No | `5` | 検索結果から実際に巡回・クローリングする最大ページ数を指定します。 |
| `final_summary` | `boolean` | No | `false` | 全ページを巡回し個別の抽出が終わった後に、全体の情報を総合した最終まとめレポートを生成するかどうか。 |
| `mode` | `string` | No | `"web"` | 検索のモード。`"web"` (通常のWebクローリング) または `"academic"` (arXiv & PubMedの公式API経由の論文検索)。 |
| `deep_dive` | `string` | No | `"auto"` | 自律的な二段階検索の挙動。`"auto"` (一次結果をAIが評価し自動で深掘り検索を実行)、または `"none"` (深掘りを行わず、推奨検索キーワードの提示に留める)。 |

---

### スタンドアロンCLIでの使い方

MCPサーバーとしてではなく、単体のコマンドラインツール（CLI）として直接実行して、調査レポートを端末に出力させることも可能です。

```bash
# フラグによる指定（推奨・多機能）
node src/cli.js --keywords "AIスマートグラス 最新動向" --intent "各メーカーのスペックと価格情報の抽出" --limit 3 --mode web --deep-dive auto --final-summary

# 位置引数による指定（簡易的）
# node src/cli.js <キーワード> <検索意図> <件数> <最終要約フラグ: true/false>
node src/cli.js "量子コンピューター 実用化 2026" "ロードマップの抽出" 3 true
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

### Key Features

1. **Autonomous Crawling & PDF/Markdown Conversion**:
   Dynamically visits target web pages using Playwright, renders them to PDFs, and automatically converts them into clean, noise-free Markdown text (excluding advertisements, headers, footers, etc.).
2. **Local Ollama-Driven Content Refinement**:
   Uses a local Ollama model to analyze and extract ONLY the facts that match the user's specific "search intent," outputting highly structured JSON data and precise summaries.
3. **Automated Academic Fallback**:
   If Playwright is blocked by CAPTCHAs or web security during crawling, or if academic papers are preferred, the pipeline automatically falls back to clean, scrape-free official APIs (arXiv & PubMed) to ensure uninterrupted research.
4. **Autonomous Secondary Deep-Dive**:
   The AI autonomously evaluates the primary research findings. If it identifies unresolved questions or critical gaps, it automatically formulates a new search query and intent to execute a secondary, deep-dive search.
5. **Dynamic Resource Indexing & CSV Mapping**:
   All outputs are neatly organized under the `artifacts/` folder. Every search creates an `index.csv` mapping table. AI agents can dynamically query this table using the MCP resource URI scheme (`mcp://artifacts/{keyword}/index.csv`) for pin-point access.

---

### Prerequisites

- **Node.js**: `v18.0.0` or higher
- **Ollama**: Must be running locally (default: `http://127.0.0.1:11434`)
  - The model you plan to use (e.g., `gemma4-e4b-custom-uncensored:latest` or `gemma:latest`) must be pulled in advance.
  - You can customize the model name and endpoint host in `config.json`.

---

### Installation

Clone the repository, install dependencies, and setup the Playwright browsers.

```bash
# 1. Clone the repository
git clone https://github.com/DovahkiinYuzuko/AgenticWorkflowSearchEngine-MCP.git
cd AgenticWorkflowSearchEngine-MCP

# 2. Install dependencies
npm install

# 3. Install Playwright browser engines
npx playwright install chromium
```

---

### MCP Configuration (Client settings.json Setup)

To use this server with an MCP client (such as Claude Desktop), configure your settings file.

#### 1. Configuration File Path
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS / Linux**: `~/Library/Application Support/Claude/claude_desktop_config.json`

#### 2. Configuration JSON Examples

Choose either Option A (using `npx`) or Option B (using `node` directly) and paste the configuration into your `claude_desktop_config.json`.

> [!WARNING]
> For Windows environments, you MUST escape backslashes in paths using double-backslashes (`\\`) or utilize forward slashes (`/`) to ensure the JSON is valid.

##### Option A: Launch using `npx` (Recommended - Automatic Setup)
Requires the absolute path to your cloned repository folder.

**For Windows:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "npx",
      "args": [
        "-y",
        "--prefix",
        "C:/Users/rikui/Documents/VSCode/AgenticWorkflowSearchEngine-MCP",
        "node",
        "./src/index.js"
      ]
    }
  }
}
```

**For macOS / Linux:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "npx",
      "args": [
        "-y",
        "--prefix",
        "/Users/username/Documents/VSCode/AgenticWorkflowSearchEngine-MCP",
        "node",
        "./src/index.js"
      ]
    }
  }
}
```

##### Option B: Direct Launch using `node` (Fast & Stable)
Runs the server directly with node (requires `npm install` to have been run inside the project root).

**For Windows:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "node",
      "args": [
        "C:/Users/rikui/Documents/VSCode/AgenticWorkflowSearchEngine-MCP/src/index.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**For macOS / Linux:**
```json
{
  "mcpServers": {
    "agentic-workflow-search-engine": {
      "command": "node",
      "args": [
        "/Users/username/Documents/VSCode/AgenticWorkflowSearchEngine-MCP/src/index.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

---

### Exposed Tool & Argument Specification

Once configured, the AI will gain access to the `search_and_extract` tool.

#### Tool Name: `search_and_extract`
Performs keyword searches, crawls each page using Playwright, sanitizes content to markdown, and utilizes a local Ollama model to refine and extract facts based on the search intent.

##### Parameters:

| Parameter | Type | Required | Default | Description |
| :--- | :---: | :---: | :---: | :--- |
| `keywords` | `string` | **Yes** | - | The search terms. (e.g., `"academic hair follicle regeneration gene"`) |
| `intent` | `string` | **Yes** | - | Precise criteria describing what details to extract and organize. (e.g., `"Extract specific gene names and clinical trial phases"`) |
| `limit` | `number` | No | `5` | Maximum number of search results to visit. |
| `final_summary` | `boolean` | No | `false` | Whether to generate a single synthesized final answer crossing all pages. |
| `mode` | `string` | No | `"web"` | Search mode: `"web"` (dynamic crawl) or `"academic"` (scrape-free API search via arXiv & PubMed). |
| `deep_dive` | `string` | No | `"auto"` | Multi-phase deep-dive behavior: `"auto"` (AI autonomously plans and executes a secondary search) or `"none"` (AI only recommends terms). |

---

### Standalone CLI Usage

You can also run this program as a standalone command-line interface directly in your terminal.

```bash
# Executing with flags (Recommended)
node src/cli.js --keywords "quantum computing roadmap" --intent "Extract timeline and major players" --limit 3 --mode web --deep-dive auto --final-summary

# Executing with positional arguments (Simplified)
# node src/cli.js <keywords> [intent] [limit] [final_summary]
node src/cli.js "quantum computing roadmap" "Extract timeline" 3 true
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
