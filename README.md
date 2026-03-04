# Vertex AI CE Assessment Agent

A state-of-the-art interactive skill assessment platform for Google Cloud Customer Engineers (CEs). This tool uses the latest Gemini generative models and the Model Context Protocol (MCP) to dynamically generate and evaluate technical scenarios against official Google Cloud documentation.

## 🚀 Overview

The **CE Assessment Agent** is designed to validate technical mastery of Vertex AI. Unlike static quiz tools, it uses an **Agentic AI pattern** to browse the official Google Cloud documentation in real-time to ensure every question and evaluation is grounded in the "Ground Truth."

### Key Features

- **Batch Scenario Generation**: Pre-generates complex, multimodal-aware customer scenarios based on chosen Vertex AI topics into a fast local SQLite database.
- **Real-time Evaluation**: Evaluates candidate responses against live documentation using an agentic reasoning loop.
- **Documentation Grounding**: Explicitly cites source URLs from the Google Developer Knowledge MCP for every assessment.
- **Modern Tech Stack**: Built with TypeScript, Node.js, Express, SQLite (`better-sqlite3`), and a high-performance Vanilla UI.

## 🛠️ Architecture

- **AI Engine**: `gemini-3-flash-preview` via the `@google/genai` SDK.
- **Knowledge Layer**: Integrated with the **Developer Knowledge MCP Server** (`developerknowledge.googleapis.com`).
- **Backend**: Node.js & TypeScript with strict type-safety.
- **Frontend**: Premium Glassmorphism UI using Vanilla HTML/CSS/TS (bundled with Rollup).
- **Testing**: Unit tests provided via Vitest with isolated dependency mocking.

## 📦 Getting Started

### Prerequisites

- Node.js (v18+)
- npm
- **Google Cloud SDK (`gcloud`)**: Required for authenticating with the Developer Knowledge MCP Server.
- A Google Cloud Project (for Vertex AI) OR a Gemini API Key.

### 1. MCP Server Authentication & Setup

This agent connects to the **Google Developer Knowledge MCP Server** at `developerknowledge.googleapis.com`. To authorize the connection, follow these steps:

1.  **Enable the Service**: Run the following command to enable the Developer Knowledge MCP service in your project (requires `gcloud` beta components):

    ```bash
    # Update components if 'mcp' command is missing
    gcloud components update beta

    # Enable the service
    gcloud beta services mcp enable developerknowledge.googleapis.com --project=YOUR_PROJECT_ID
    ```

2.  **Set up Credentials**: Log in via Application Default Credentials (ADC) to authorize the agent:
    ```bash
    gcloud auth application-default login
    ```

The agent will automatically use these credentials to acquire OAuth2 tokens for communication with the managed MCP server.

### 2. Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd ce-assessment-agent
   ```

2. Install dependencies for the backend and frontend:

   ```bash
   # Install backend dependencies
   npm install

   # Install frontend dependencies
   cd public
   npm install
   cd ..
   ```

### 3. Configure Environment Variables

The application requires credentials to access Gemini models. We provide a `.env.example` file as a template.

1.  Copy the example file to `.env`:
    ```bash
    cp .env.example .env
    ```
2.  Open `.env` and configure **one** of the following methods:

    **Option A: Vertex AI (Recommended for Google Cloud Users)**

    ```env
    GOOGLE_CLOUD_PROJECT=your-project-id
    GOOGLE_CLOUD_LOCATION=us-central1
    ```

    _Ensure you have run `gcloud auth application-default login` on your machine._

    **Option B: Standard Gemini API**

    ```env
    GEMINI_API_KEY=your_api_key_here
    ```

## 🚀 Build & Launch

To get the application up and running, follow these steps:

### 1. Build the project

The project has both a backend (TypeScript) and a frontend (UI) that need to be compiled.

```bash
# Build everything from the root
npm run build
```

_Note: This command runs `npx tsc` for the backend and the Rollup build for the frontend._

### 2. Prepare the Database (Seed Questions)

Before launching the app, you need to pre-generate the assessment scenarios. This uses the agent to fetch official docs and create questions for 5 major Vertex AI Sales Plays, saving them into a local `questions.db` database.

```bash
npm run seed
```

### 3. Launch the Application

You can run the assessment in two modes:

#### **Web Interface (Recommended)**

This launches a local server with a premium graphical interface.

```bash
npm start
```

Go to **[http://localhost:3000](http://localhost:3000)** in your browser.

#### **CLI Mode (Interactive Terminal)**

For a quick text-based assessment directly in your terminal:

```bash
node dist/index.js
```

## 🧪 Testing

The project includes a comprehensive test suite using Vitest that mocks both the Gemini API and the MCP Server for fast, reliable local validation.

```bash
npm test
```

## 📜 Development Conventions & Global Rules

This project follows the **Typescript Best Practices** workflow:

- **No `any`**: All data structures are strictly typed via interfaces.
- **Centralized Config**: Environment variables are managed in `src/config.ts`.
- **Separation of Concerns**: AI prompts are isolated in `src/prompts.ts`.
- **DI Pattern**: The `CEAssessmentAgent` accepts configuration objects to facilitate testing.

### Updating Global Rules & AI Prompts

If you want to update the "global rules" for how the agent behaves, evaluates candidates, or generates scenarios, you should modify the system prompts. These act as the fundamental instructions for the LLM.

1. Open `src/prompts.ts`.
2. Edit `QUESTION_GENERATION_SYSTEM_PROMPT` to change how the agent writes scenarios.
3. Edit `EVALUATION_SYSTEM_PROMPT` to change how strictly the agent grades the candidate's answer and formatting rules.
4. Restart the server (`npm run dev` or `npm start`) for the new rules to take effect.

---
