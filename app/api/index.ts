import express, { Request, Response } from 'express';
import cors from 'cors';
import { classifyIntent } from './services/intent-classifier';
import { generatePlan } from './services/planner';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'Jarvis API is running'
  });
});

app.post('/api/classify', async (req: Request, res: Response) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    console.log(`Classifying prompt: "${prompt}"`);
    const result = await classifyIntent(prompt);
    
    res.json({
      originalPrompt: prompt,
      ...result
    });
  } catch (error: any) {
    console.error('Classification error:', error.message);
    res.status(500).json({ 
      error: 'Failed to classify intent',
      details: error.message 
    });
  }
});

app.post('/api/plan', (req: Request, res: Response) => {
  const { intent, entities } = req.body;

  if (!intent) {
    return res.status(400).json({ error: 'Intent is required' });
  }

  try {
    console.log(`Generating plan for intent: "${intent}"`);
    const plan = generatePlan(intent, entities || []);
    res.json(plan);
  } catch (error: any) {
    console.error('Planning error:', error.message);
    res.status(500).json({ 
      error: 'Failed to generate plan',
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis API server running on port ${PORT}`);
});
