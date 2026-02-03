/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { z } from "zod";
import { CopilotClient, defineTool } from "@github/copilot-sdk";

console.log("🚀 Starting Copilot SDK Example\n");

// Create client - will auto-start CLI server (searches PATH for "copilot")
const client = new CopilotClient({ logLevel: "info" });
const session = await client.createSession({ 
    sessionId: "test-skill-session",
    model: "gpt-4.1",
    skillDirectories: ["./.github/skills"],
    configDir: "./.copilot/config"
 });
console.log(`✅ Session created: ${session.sessionId}\n`);

// Listen to events
session.on((event) => {
    console.log(`📢 Event [${event.type}]:`, JSON.stringify(event.data, null, 2));
});

// Send a simple message
console.log("💬 Sending message...");
const result1 = await session.sendAndWait({ prompt: "在项目根目录下新建一个README_CN.md文件" });
console.log("📝 Response:", result1?.data.content);

// Clean up
await session.destroy();
await client.stop();
console.log("✅ Done!");