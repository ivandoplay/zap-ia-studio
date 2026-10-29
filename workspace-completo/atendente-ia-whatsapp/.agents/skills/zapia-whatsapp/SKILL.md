---
name: zapia-whatsapp-architecture
description: Use this skill when extending, customizing, or deploying ZAP-IA Studio — the universal Multi-AI WhatsApp customer service platform built with Baileys v7, Google GenAI SDK (@google/genai Interactions API), PIX EMV BRCode, and Kanban CRM.
---

# ZAP-IA Studio — Agent Skill Reference

## Core Rules
1. **Google Gemini SDK (`@google/genai` >= 2.31.0)**:
   - Always use `@google/genai` (never deprecated `@google/generative-ai`).
   - Default model: `gemini-3.8-flash` (or `gemini-3.5-flash-lite` / `gemini-4-argon`) via `ai.interactions.create` with fallback to `ai.models.generateContent`.
2. **WhatsApp Transport (`@whiskeysockets/baileys` v7)**:
   - Do NOT enable `printQRInTerminal` (deprecated).
   - Keep the 3-layer LID-to-Phone resolver (`resolvePhoneFromMessage` in `src/whatsappManager.js`) intact so `@lid` conversations resolve to real phone numbers.
   - Reconnect within 500ms on stream close code `515` (`DisconnectReason.restartRequired`) so 8-digit pairing completes cleanly.
   - Track outgoing bot message IDs in `sentByBotIds` so `fromMe` detection accurately distinguishes human owner replies from AI replies.
3. **Structured AI Actions (`src/aiEngine.js`)**:
   - Action tags `[[ENVIAR_ITEM:id]]`, `[[ENVIAR_PIX]]`, `[[ENVIAR_PIX:valor]]`, and `[[CHAMAR_HUMANO:resumo]]` are provider-agnostic across Gemini, OpenAI, Groq, and OpenRouter.
