---
name: Readme Tone
description: Maintains a consistent, professional, and grounded tone across all README.md files.
---

# README Tone Enforcer

## Objective

To ensure that all `README.md` files in this project maintain a consistent tone that is professional, clear, concise, and grounded in reality.

## Guidelines

1. **Avoid Superlatives & Marketing Fluff:**
   - Do NOT use terms like "state-of-the-art", "premium", "blazing fast", "high-performance", "next-generation", or "ultimate".
   - Stick to factual descriptions of the application's capabilities.
2. **Focus on Value:**
   - Clearly state what the application does, who it is for, and how to use it.
   - Example: "Evaluate your Google Cloud Customer Engineer (CE) skills against realistic customer scenarios."

3. **Be Direct and Objective:**
   - Use active voice.
   - Present technical architecture facts without qualitative exaggerations.
   - Example (Good): "Built with TypeScript, Node.js, and a Vanilla UI."
   - Example (Bad): "Built with an incredibly modern, high-performance tech stack using TS, Node, and a beautifully crafted Vanilla UI."

4. **Formatting Consistency:**
   - Use clear headers (`##`, `###`).
   - Use bold text sparingly, mainly for key concepts or UI elements.
   - Ensure code blocks are properly fenced and identify the language (e.g., `bash`, `typescript`).

## Instructions for Agents

1. When creating or modifying a `README.md` file, always review your changes against these guidelines. If an existing `README.md` contains superlatives, proactively sanitize the language to match this grounded and professional tone.
2. **Always Keep README Updated:** Whenever any significant changes are made to the codebase (such as updating dependencies, changing architecture, adding new features, or refactoring), you MUST automatically review and update the `README.md` to accurately reflect those changes without waiting for an explicit prompt.
