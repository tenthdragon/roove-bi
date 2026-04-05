// lib/opus-analyst.ts — Opus agentic loop for monthly report analysis
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFINITIONS, executeTool } from '@/lib/report-tools';

const MAX_ITERATIONS = 8;
const MODEL = 'claude-haiku-4-5-20251001';

// Pricing per million tokens (USD) — Haiku 4.5
const INPUT_PRICE_PER_M = 1;
const OUTPUT_PRICE_PER_M = 5;

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

FORMATTING (CRITICAL):
- Output is rendered in Telegram which uses HTML, NOT Markdown
- Use <b>bold</b> for emphasis (NOT **bold** or __bold__)
- Use <i>italic</i> for secondary info (NOT *italic* or _italic_)
- Do NOT use markdown headers (#, ##), bullet asterisks, or any markdown syntax
- Use plain dashes (-) or emoji for bullet points
- Keep it clean and readable on a phone screen
- IMPORTANT: After each section title/header, always add an empty line before the content

BUSINESS CONTEXT:
- Meta Ads is a demand creation channel. Customers often discover via Meta but purchase on marketplaces (Shopee, TikTok Shop). Do NOT assume Meta revenue = Meta-attributed sales.
- Not all brands have ad spend. Check ads_spend_by_source before attributing growth to ads. Orders with zero-spend brands are likely organic/marketplace-driven.
- Marketplace orders are manually inputted by ops into Scalev, so their draft_time ≈ shipped_time. Their CR is artificially ~100% and does NOT reflect real lead-to-close conversion.

When using tools, the "from" and "to" parameters must be in YYYY-MM-DD format.`;

/** Convert any remaining markdown to Telegram HTML */
function sanitizeForTelegram(text: string): string {
  return text
    // Bold: **text** or __text__ → <b>text</b>
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    // Italic: *text* or _text_ → <i>text</i> (but not inside HTML tags)
    .replace(/(?<![<\/\w])\*([^*\n]+?)\*(?![>])/g, '<i>$1</i>')
    .replace(/(?<![<\/\w])_([^_\n]+?)_(?![>])/g, '<i>$1</i>')
    // Headers: ### text → <b>text</b>
    .replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>')
    // Bullet: * text → - text
    .replace(/^\* /gm, '- ')
    // Code blocks: ```...``` → remove
    .replace(/```[\s\S]*?```/g, '')
    // Inline code: `text` → text
    .replace(/`([^`]+)`/g, '$1')
    // Ensure spacing after section headers (lines starting with emoji + bold title)
    .replace(/(^[^\n]*<\/b>)\n(?!\n)/gm, '$1\n\n');
}

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
      const rawText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n');
      const finalText = sanitizeForTelegram(rawText);
      console.log(`[opus-analyst] Done after ${iteration} iterations, input=${totalInput}, output=${totalOutput}`);

      const costUsd = (totalInput / 1_000_000) * INPUT_PRICE_PER_M + (totalOutput / 1_000_000) * OUTPUT_PRICE_PER_M;

      return { text: finalText, inputTokens: totalInput, outputTokens: totalOutput, costUsd, iterations: iteration, toolCalls };
    }
  }

  const costUsd = (totalInput / 1_000_000) * INPUT_PRICE_PER_M + (totalOutput / 1_000_000) * OUTPUT_PRICE_PER_M;
  return { text: 'Analisis tidak dapat diselesaikan — terlalu banyak iterasi.', inputTokens: totalInput, outputTokens: totalOutput, costUsd, iterations: iteration, toolCalls };
}
