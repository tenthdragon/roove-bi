// lib/opus-analyst.ts — Opus agentic loop for monthly report analysis
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFINITIONS, executeTool } from '@/lib/report-tools';

const MAX_ITERATIONS = 8;
const MODEL = 'claude-opus-4-6';

// Pricing per million tokens (USD) — Opus 4
const INPUT_PRICE_PER_M = 15;
const OUTPUT_PRICE_PER_M = 75;

const SYSTEM_PROMPT = `You are a senior business analyst for an Indonesian D2C/FMCG company called Roove.
You are given a monthly performance report. Your job is to:

1. Identify the most important trends and anomalies in the data
2. Build hypotheses about WHY metrics moved (up or down)
3. Use the available tools to query the database and VALIDATE your hypotheses
4. Provide actionable insights

IMPORTANT RULES:
- Always query data to support your claims — never speculate without evidence
- Compare this month vs last month to find meaningful changes
- Focus on the TOP 3 most impactful insights
- Write in Bahasa Indonesia
- Be concise — max 3-4 paragraphs for the final analysis
- Use numbers and percentages to support your points
- Format output in plain text suitable for Telegram (no markdown headers, use emoji sparingly)

When using tools, the "from" and "to" parameters must be in YYYY-MM-DD format.`;

export interface AnalysisResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  iterations: number;
  toolCalls: string[];
}

export async function analyzeMonthlyReport(reportText: string, thisMonthFrom: string, thisMonthTo: string, prevMonthFrom: string, prevMonthTo: string): Promise<AnalysisResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMessage = `Here is the monthly report:\n\n${reportText}\n\nCurrent month range: ${thisMonthFrom} to ${thisMonthTo}\nPrevious month range: ${prevMonthFrom} to ${prevMonthTo}\n\nPlease analyze this report. Use the tools to dig deeper into the data and find the root causes behind the numbers. Focus on what's most actionable.`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let iteration = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const toolCalls: string[] = [];

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[opus-analyst] Iteration ${iteration}`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS as any,
      messages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`[opus-analyst] Tool call: ${block.name}(${JSON.stringify(block.input)})`);
          toolCalls.push(block.name);
          const result = await executeTool(block.name, block.input as any);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    } else {
      const textBlocks = response.content.filter(b => b.type === 'text');
      const finalText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n');
      console.log(`[opus-analyst] Done after ${iteration} iterations, input=${totalInput}, output=${totalOutput}`);

      const costUsd = (totalInput / 1_000_000) * INPUT_PRICE_PER_M + (totalOutput / 1_000_000) * OUTPUT_PRICE_PER_M;

      return { text: finalText, inputTokens: totalInput, outputTokens: totalOutput, costUsd, iterations: iteration, toolCalls };
    }
  }

  const costUsd = (totalInput / 1_000_000) * INPUT_PRICE_PER_M + (totalOutput / 1_000_000) * OUTPUT_PRICE_PER_M;
  return { text: 'Analisis tidak dapat diselesaikan — terlalu banyak iterasi.', inputTokens: totalInput, outputTokens: totalOutput, costUsd, iterations: iteration, toolCalls };
}
