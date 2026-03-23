import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

const app = express();
const port = process.env.PORT || 8080;

// Initialize the LLM
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

// In-memory storage for tasks (replaces the database)
const taskMemory = [];

app.use(express.json());

// Serve the two frontend files securely
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));

// API to get memory
app.get('/api/tasks', (req, res) => {
  res.json(taskMemory.slice().reverse()); // Send newest first
});

// API to trigger a task
app.post('/api/task', async (req, res) => {
  const { objective } = req.body;
  if (!objective) return res.status(400).json({ error: 'Objective required' });

  res.status(202).json({ message: 'Task received.' });
  
  // Start agent loop in background
  runAgentLoop(objective).catch(console.error);
});

// The core ReAct loop
async function runAgentLoop(objective) {
  console.log(`\n🎯 [NEW TASK] ${objective}`);
  
  const currentTask = { id: Date.now(), objective, result: 'Running...', actionsTaken: [], createdAt: new Date() };
  taskMemory.push(currentTask);

  let conversationHistory = `You are an autonomous Node.js agent. Objective: "${objective}"
You have one tool: "BASH_COMMAND". 
Respond ONLY with a JSON object: {"thought": "reasoning", "action": "BASH_COMMAND" or "DONE", "payload": "command to run or final summary"}`;

  let isComplete = false;
  let loops = 0;

  while (!isComplete && loops < 10) {
    loops++;
    try {
      const result = await model.generateContent(conversationHistory);
      const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      const llmDecision = JSON.parse(text);

      currentTask.actionsTaken.push(llmDecision);
      let observation = "";

      if (llmDecision.action === "DONE") {
        isComplete = true;
        observation = "Complete.";
        currentTask.result = 'Success';
      } else if (llmDecision.action === "BASH_COMMAND") {
        try {
          const { stdout, stderr } = await execAsync(llmDecision.payload);
          observation = stdout || stderr || "Success, no output.";
        } catch (error) {
          observation = `ERROR: ${error.message}`;
        }
      }

      conversationHistory += `\n\nAction: ${JSON.stringify(llmDecision)}\nObservation: ${observation}\nNext step? (JSON only)`;
    } catch (error) {
      conversationHistory += `\n\nERROR: Invalid JSON. Fix formatting.`;
    }
  }
  
  if (!isComplete) currentTask.result = 'Failed (Max Loops)';
  console.log(`💾 [COMPLETE] Status: ${currentTask.result}`);
}

app.listen(Number(port), "0.0.0.0", () => {
  console.log(`🚀 Minimalist Agent framework running on port ${port}`);
});
