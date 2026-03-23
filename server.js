import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs'; // NEW: Imported for file writing

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

const app = express();
const port = process.env.PORT || 8080;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

const taskMemory = [];

app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));

app.get('/api/tasks', (req, res) => {
  res.json(taskMemory.slice().reverse());
});

app.post('/api/task', async (req, res) => {
  const { objective } = req.body;
  if (!objective) return res.status(400).json({ error: 'Objective required' });

  res.status(202).json({ message: 'Task received.' });
  runAgentLoop(objective).catch(console.error);
});

async function runAgentLoop(objective) {
  console.log(`\n🎯 [NEW TASK] ${objective}`);
  
  const currentTask = { id: Date.now(), objective, result: 'Running...', actionsTaken: [], createdAt: new Date() };
  taskMemory.push(currentTask);

  // UPGRADED PROMPT WITH NEW TOOLS
  let conversationHistory = `You are an autonomous Node.js agent running on a Linux server. 
Your Objective: "${objective}"

You have access to the following tools:
1. "BASH_COMMAND" - Run terminal commands. Payload: the bash string.
2. "WRITE_FILE" - Write text/code directly to a file. Payload: object with "filename" and "content".
3. "HTTP_GET" - Fetch data from a URL. Payload: the URL string.
4. "DONE" - Use this when the objective is completely achieved. Payload: Final summary.

RULES:
- You MUST respond with ONLY a raw JSON object. Do not include markdown or conversational text.
- If a tool fails, DO NOT try the exact same thing again. Try a different approach.

JSON FORMAT TO RETURN:
{
  "thought": "Explain what you are going to do and why",
  "action": "BASH_COMMAND" or "WRITE_FILE" or "HTTP_GET" or "DONE",
  "payload": "Depends on the tool (see above)"
}`;

  let isComplete = false;
  let loops = 0;
  const MAX_LOOPS = 15; // 15 is plenty if it has the right tools!

  while (!isComplete && loops < MAX_LOOPS) {
    loops++;
    console.log(`\n⏳ [LOOP ${loops}] Agent is thinking...`);
    
    try {
      const result = await model.generateContent(conversationHistory);
      let text = result.response.text();
      console.log(`[RAW AI RESPONSE]:\n${text}`);

      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON object found.");
      
      const cleanJsonStr = text.substring(jsonStart, jsonEnd + 1);
      const llmDecision = JSON.parse(cleanJsonStr);

      currentTask.actionsTaken.push(llmDecision);
      let observation = "";

      // NEW EXECUTION BLOCK WITH NEW TOOLS
      if (llmDecision.action === "DONE") {
        isComplete = true;
        observation = "Objective achieved.";
        currentTask.result = 'Success';
        console.log(`✅ [DONE] ${llmDecision.payload}`);
      } 
      else if (llmDecision.action === "BASH_COMMAND") {
        try {
          const { stdout, stderr } = await execAsync(llmDecision.payload);
          observation = stdout || stderr || "Command succeeded with no output.";
        } catch (error) {
          observation = `ERROR EXECUTING BASH: ${error.message}`;
        }
      }
      else if (llmDecision.action === "WRITE_FILE") {
        try {
          // Extracts filename and content from the JSON payload
          fs.writeFileSync(llmDecision.payload.filename, llmDecision.payload.content);
          observation = `Success: Wrote file ${llmDecision.payload.filename}`;
        } catch (error) {
          observation = `ERROR WRITING FILE: ${error.message}`;
        }
      }
      else if (llmDecision.action === "HTTP_GET") {
        try {
          const response = await fetch(llmDecision.payload);
          const data = await response.text();
          // Truncate output so we don't blow up the AI's context window with massive HTML files
          observation = data.substring(0, 2000) + (data.length > 2000 ? "...[TRUNCATED]" : ""); 
        } catch (error) {
          observation = `ERROR FETCHING URL: ${error.message}`;
        }
      }
      else {
         observation = `ERROR: Invalid action type.`;
      }

      console.log(`👀 [OBSERVATION]\n${observation.substring(0, 150)}...`);

      conversationHistory += `\n\nAgent Action Taken: ${JSON.stringify(llmDecision)}\nSystem Observation: ${observation}\nWhat is your next step? (JSON ONLY)`;
      
    } catch (error) {
      console.error(`❌ [ERROR] ${error.message}`);
      conversationHistory += `\n\nSYSTEM ERROR: You returned invalid JSON (${error.message}). Please output pure JSON.`;
    }
  }
  
  if (!isComplete) {
      currentTask.result = 'Failed (Max Loops)';
  }
}

app.listen(Number(port), "0.0.0.0", () => {
  console.log(`🚀 Advanced Agent framework running on port ${port}`);
});
