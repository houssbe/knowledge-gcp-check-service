# Test Your GCP Knowledge

Evaluate your Google Cloud skills against realistic scenarios. This tool uses Gemini and the Developer Knowledge API via the Model Context Protocol (MCP) to generate challenges and provide grounded, real-time evaluation of your technical proposals.

**Note**: The agent is explicitly configured to decline generating or evaluating questions regarding security or topics outside its designated Google Cloud scopes.

## 🚀 Overview

The **Test Your GCP Knowledge** application validates your technical mastery of Google Cloud topics such as AI, Data, and Modern Infrastructure. Unlike static quiz tools, it uses an **Agentic AI pattern** to browse official documentation in real-time, ensuring every assessment is grounded in the "Ground Truth."

### Key Features

- **Batch Scenario Generation**: Pre-generates customer scenarios based on chosen Google Cloud topics into a local SQLite database.
- **Real-time Evaluation**: Evaluates candidate responses against live documentation using an agentic reasoning loop.
- **Documentation Grounding**: Explicitly cites source URLs from the Google Developer Knowledge MCP for every assessment.
- **Tech Stack**: Built with TypeScript, Node.js, Express, SQLite (`better-sqlite3`), and a Vanilla UI.

## 🛠️ Architecture

- **AI Engine**: `gemini-3.1-flash-lite-preview` via the `@google/genai` SDK.
- **Knowledge Layer**: Integrated with the **Developer Knowledge MCP Server** (`developerknowledge.googleapis.com`).
- **Backend**: Node.js & TypeScript with strict type-safety.
- **Frontend**: Glassmorphism UI using Vanilla HTML/CSS/TS (bundled with Rollup).
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
   cd test-your-gcp-knowledge
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

Before launching the app, you need to pre-generate the assessment scenarios. This uses the agent to fetch official docs and create questions for several major Google Cloud Categories (including Vertex AI, Data Cloud, and Modern Infrastructure), saving them into a local `questions.db` database.

```bash
npm run seed
```

### 3. Database Utilities

Manage your local question bank with these helper commands:

- **List all questions**: View the IDs and text of every generated scenario in your database.
  ```bash
  npm run db:list
  ```
- **Clean database**: Remove any legacy "failure" or "error" entries that might have been generated during unstable network conditions.
  ```bash
  npm run db:clean
  ```

### 4. Launch the Application

You can run the assessment in two modes:

#### **Web Interface (Recommended)**

This launches a local server with a graphical interface.

```bash
npm start
```

Go to **[http://localhost:3000](http://localhost:3000)** in your browser.

#### **CLI Mode (Interactive Terminal)**

For a quick text-based assessment directly in your terminal, you have three options:

**1. Using `npx` (Requires build):**
Run the compiled CLI as an executable from anywhere in the project:

```bash
npx .
```

**2. Development Mode (No build required):**
Run the TypeScript source directly:

```bash
npm run cli
```

**3. Direct Node execution (Requires build):**

```bash
node dist/index.js
```

## 🧪 Testing

The project includes a test suite using Vitest that mocks both the Gemini API and the MCP Server for local validation.

```bash
npm test
```

## 📜 Development Conventions & Global Rules

This project follows the **Typescript Best Practices** workflow:

- **No `any`**: All data structures are strictly typed via interfaces.
- **Centralized Config**: Environment variables are managed in `src/config.ts`.
- **Separation of Concerns**: AI prompts are isolated in `src/prompts.ts`.
- **DI Pattern**: The `GCPKnowledgeService` accepts configuration objects to facilitate testing.

### Updating Global Rules & AI Prompts

If you want to update the "global rules" for how the agent behaves, evaluates candidates, or generates scenarios, you should modify the system prompts. These act as the fundamental instructions for the LLM.

1. Open `src/prompts.ts`.
2. Edit `QUESTION_GENERATION_SYSTEM_PROMPT` to change how the agent writes scenarios.
3. Edit `EVALUATION_SYSTEM_PROMPT` to change how strictly the agent grades the candidate's answer and formatting rules.
4. Restart the server (`npm run dev` or `npm start`) for the new rules to take effect.

---
