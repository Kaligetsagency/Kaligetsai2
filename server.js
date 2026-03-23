import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ES Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

const app = express();
const port = process.env.PORT || 8080;

// Initialize the LLM
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// Using gemini-1.5-pro for better reasoning, but gemini-1.5-flash works too
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

// In-memory storage for tasks (Resets on redeploy)
const taskMemory = [];

app.use(express.json());

// Serve the frontend files securely
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));

// API to get memory for the UI
app.get('/api/tasks', (req, res) => {
  res.json(taskMemory.slice().reverse()); // Send newest first
});

// API to trigger a new task
app.post('/api/task', async (req, res) => {
  const { objective } = req.body;
  if (!objective) return res.status(400).json({ error: 'Objective required' });

  // Acknowledge the request immediately
  res.status(202).json({ message: 'Task received.' });
  
  // Start agent loop in the background
  runAgentLoop(objective).catch(console.error);
});

// The core ReAct (Reasoning + Acting) loop
async function runAgentLoop(objective) {
  console.log(`\n🎯 [NEW TASK] ${objective}`);
  
  // Create a record in memory
  const currentTask = { id: Date.now(), objective, result: 'Running...', actionsTaken: [], createdAt: new Date() };
  taskMemory.push(currentTask);

  // STRONGER PROMPT: Force the LLM to behave strictly like an API
  let conversationHistory = `You are an autonomous Node.js agent running on a Linux server. 
Your Objective: "${objective}"

You have access to ONE tool: "BASH_COMMAND".

RULES:
1. You MUST respond with ONLY a raw JSON object. 
2. Do not include markdown formatting (like \`\`\`json).
3. Do not include ANY conversational text before or after the JSON.
4. Once you have achieved the objective, you MUST use the "DONE" action.

JSON FORMAT TO RETURN:
{
  "thought": "Explain what you are going to do and why",
  "action": "BASH_COMMAND" or "DONE",
  "payload": "The terminal command to run, or the final result summary if DONE"
}`;

  let isComplete = false;
  let loops = 0;
  const MAX_LOOPS = 10;

  while (!isComplete && loops < MAX_LOOPS) {
    loops++;
    console.log(`\n⏳ [LOOP ${loops}] Agent is thinking...`);
    
    try {
      // 1. Ask the AI what to do
      const result = await model.generateContent(conversationHistory);
      let text = result.response.text();
      
      console.log(`[RAW AI RESPONSE]:\n${text}`);

      // 2. SMART JSON EXTRACTOR: Ignore extra conversational text
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      
      if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error("No JSON object found in the AI response.");
      }
      
      const cleanJsonStr = text.substring(jsonStart, jsonEnd + 1);
      const llmDecision = JSON.parse(cleanJsonStr);

      // Save the action to memory for the UI
      currentTask.actionsTaken.push(llmDecision);
      let observation = "";

      // 3. EXECUTE the chosen action
      if (llmDecision.action === "DONE") {
        isComplete = true;
        observation = "Objective achieved.";
        currentTask.result = 'Success';
        console.log(`✅ [DONE] ${llmDecision.payload}`);
      } 
      else if (llmDecision.action === "BASH_COMMAND") {
        try {
          console.log(`▶️  [EXECUTING] ${llmDecision.payload}`);
          // Run the command on the server
          const { stdout, stderr } = await execAsync(llmDecision.payload);
          // Capture the output
          observation = stdout || stderr || "Command succeeded with no output.";
        } catch (error) {
          // If the bash command fails, capture the error to show the AI
          observation = `ERROR EXECUTING COMMAND: ${error.message}`;
        }
      } 
      else {
         observation = `ERROR: Invalid action type '${llmDecision.action}'. Use BASH_COMMAND or DONE.`;
      }

      console.log(`👀 [OBSERVATION]\n${observation.substring(0, 150)}...`);

      // 4. Update the history so the AI learns from the result of its command
      conversationHistory += `\n\nAgent Action Taken: ${JSON.stringify(llmDecision)}\nSystem Observation: ${observation}\nWhat is your next step? (JSON ONLY)`;
      
    } catch (error) {
      console.error(`❌ [JSON ERROR] ${error.message}`);
      // Tell the AI it messed up the formatting so it can correct itself on the next loop
      conversationHistory += `\n\nSYSTEM ERROR: You returned invalid JSON or caused a crash (${error.message}). Please output pure JSON.`;
    }
  }
  
  if (!isComplete) {
      currentTask.result = 'Failed (Max Loops)';
      console.log(`🛑 [FAILED] Hit maximum loop limit of ${MAX_LOOPS}.`);
  }
}

// Bind to 0.0.0.0 so Railway's proxy can route traffic correctly
app.listen(Number(port), "0.0.0.0", () => {
  console.log(`🚀 Minimalist Agent framework running on port ${port}`);
});
