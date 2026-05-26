# Skill Definition: Agentic Workflow Search Engine MCP

## 1. Overview and Purpose
This document serves as the canonical skill instruction set for autonomous AI agents (such as Antigravity, Roo Code, Claude Desktop) interfacing with the `aw-se-mcp` (Agentic Workflow Search Engine MCP). 
This tool is not a standard keyword search. It is a highly autonomous, multi-phase research engine that mimics a human researcher's workflow. It automatically crawls pages, renders PDFs, extracts clean markdown, structures data via a local Ollama LLM based on specific extraction intents, and can even autonomously execute secondary "deep dive" searches based on its initial findings.

As an AI agent, you must utilize this tool when the user requests deep research, structured data gathering across multiple sources, or academic literature reviews.

## 2. Core Tool: `search_and_extract`
This is the primary tool exposed by the MCP server. You must call this tool with precise parameters to trigger the autonomous research pipeline.

### Parameters Specification:
- **`keywords`** (Type: `string`, **Required**):
  The exact search query to execute. 
  *Instruction*: Do not pass conversational sentences. Break down the user's prompt into optimized, highly relevant search terms (e.g., instead of "Tell me about quantum computing in 2026", use `"quantum computing commercialization roadmap 2026"`).

- **`intent`** (Type: `string`, **Required**):
  The extraction criteria. This is the most critical parameter for the local Ollama LLM to understand what data to extract from the crawled pages.
  *Instruction*: Be extremely specific. State exactly what information should be retained and how it should be structured. (e.g., `"Extract a comprehensive timeline of product releases, highlighting key features and estimated MSRPs for each manufacturer. Ignore marketing fluff."`)

- **`limit`** (Type: `number`, Optional, Default: `5`):
  The maximum number of search results to actually crawl and process.
  *Instruction*: Increase this for highly comprehensive research (e.g., `10`), but keep it lower (e.g., `3`) for quick overviews to save processing time.

- **`final_summary`** (Type: `boolean`, Optional, Default: `false`):
  If `true`, the engine will run a Phase 5 global synthesis across all individually extracted JSON/Markdown files to create one unified, cross-referenced final report.
  *Instruction*: Always set this to `true` if the user expects a synthesized answer covering all sources. Set to `false` only if the user just wants the raw data files or if you plan to synthesize the data yourself.

- **`mode`** (Type: `string`, Optional, Default: `"web"`):
  The target environment for the search.
  - `"web"`: Uses Playwright to dynamically crawl traditional web pages and search engines (Bing/Google). Handles JavaScript-heavy sites.
  - `"academic"`: Uses official APIs (PubMed, arXiv) to directly fetch peer-reviewed papers and academic literature without web scraping.
  *Instruction*: Automatically switch to `"academic"` if the user's prompt involves medical studies, physics, computer science papers, or requests for "peer-reviewed sources."

- **`deep_dive`** (Type: `string`, Optional, Default: `"auto"`):
  Controls the autonomous secondary search behavior.
  - `"auto"`: The tool will evaluate the initial findings. If the data is incomplete or reveals new critical keywords, it will autonomously spawn a secondary search and combine the results.
  - `"none"`: The tool will execute only the primary search and suggest follow-up queries at the end of the report without executing them.
  *Instruction*: Use `"auto"` for complex queries where the answer might not be on the first page of results.

## 3. The 5-Phase Internal Architecture
You should understand how the server operates to anticipate its execution time (which can take several minutes) and interpret its logs:
1. **Phase 1: Search** - Queries the search engine or academic APIs to retrieve a list of candidate URLs.
2. **Phase 2: Capture** - Uses Playwright to visit each URL, waiting for DOM load and network idle, and optionally rendering the page as a PDF for structural integrity.
3. **Phase 3: Extract** - Converts the captured HTML/PDF into clean, readable Markdown, stripping navigation bars and ads.
4. **Phase 4: Structure** - Passes the Markdown to a local Ollama LLM along with your provided `intent` to generate a structured JSON object containing only the relevant facts.
5. **Phase 5: Finalize** - (If `final_summary=true`) Synthesizes all structured JSONs into a comprehensive global report, handling contradictions between sources.

## 4. Resource URIs and Artifact Retrieval
As an MCP client, you have access to the generated artifacts via the MCP Resource protocol.
Once `search_and_extract` completes, it will save all outputs physically in the `artifacts/` directory within the project root.

You can access these resources using the custom URI scheme:
- `mcp://artifacts/{keyword_hash}/index.csv`: Returns the mapping table of all crawled pages, their original URLs, and the paths to their local Markdown/JSON representations.
- `mcp://artifacts/{keyword_hash}/...`: Returns the specific Markdown or JSON file.

*Instruction*: If the user asks for direct quotes, specific raw data, or if you need to perform additional analysis beyond the final summary, you MUST fetch the raw JSON files from the `artifacts/` directory using the MCP resource URIs.

## 5. Security and Rate Limiting Compliance
- The `search_and_extract` tool implements aggressive delays (`waitAfterSearch`, `viewTime`, `slowMo`) defined in `config.json` to prevent DDoS-like behavior on target websites.
- **Do not attempt to rapidly call the tool multiple times in a loop.** Pass a well-thought-out query and let the autonomous `deep_dive` handle subsequent queries.
- Do not attempt to read files outside the `artifacts/` directory through the MCP protocol, as the server restricts access for security.
