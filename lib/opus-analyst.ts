// lib/opus-analyst.ts — Pre-fetch all data, then single-shot Sonnet analysis
import Anthropic from '@anthropic-ai/sdk';
import { executeTool } from '@/lib/report-tools';

const MODEL = 'claude-sonnet-4-20250514';

// Pricing per million tokens (USD) — Sonnet 4
const INPUT_PRICE_PER_M = 3;
const OUTPUT_PRICE_PER_M = 15;

const TOOLS = [
  'daily_trend',
  'brand_breakdown',
  'channel_breakdown',
  'brand_channel_detail',
  'ads_spend_by_source',
  'closing_rate_by_brand',
  'repeat_rate_by_brand',
];

const SYSTEM_PROMPT = `You are a senior business analyst for an Indonesian D2C/FMCG company called Roove.
You are given a monthly performance report along with detailed data from the database.
Your job is to analyze the data and provide actionable insights.

IMPORTANT RULES:
- All data is already provided below — do NOT request additional tools or data
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
- Not all brands have ad spend. Check the ads data before attributing growth to ads. Orders with zero-spend brands are likely organic/marketplace-driven.
- Marketplace orders are manually inputted by ops into Scalev, so their draft_time ≈ shipped_time. Their CR is artificially ~100% and does NOT reflect real lead-to-close conversion.`;

/** Convert any remaining markdown to Telegram HTML */
function sanitizeForTelegram(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/(?<![<\/\w])\*([^*\n]+?)\*(?![>])/g, '<i>$1</i>')
    .replace(/(?<![<\/\w])_([^_\n]+?)_(?![>])/g, '<i>$1</i>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^\* /gm, '- ')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
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

export async function analyzeMonthlyReport(
  reportText: string,
  thisMonthFrom: string, thisMonthTo: string,
  prevMonthFrom: string, prevMonthTo: string,
): Promise<AnalysisResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ── Stage 1: Pre-fetch all data (no LLM cost) ──
  console.log('[analyst] Fetching all data...');
  const dataBlocks: string[] = [];

  for (const tool of TOOLS) {
    const [thisData, prevData] = await Promise.all([
      executeTool(tool, { from: thisMonthFrom, to: thisMonthTo }),
      executeTool(tool, { from: prevMonthFrom, to: prevMonthTo }),
    ]);
    dataBlocks.push(
      `=== ${tool} (${thisMonthFrom} to ${thisMonthTo}) ===\n${thisData}`,
      `=== ${tool} (${prevMonthFrom} to ${prevMonthTo}) ===\n${prevData}`,
    );
  }

  const compiledData = dataBlocks.join('\n\n');
  console.log(`[analyst] Data compiled: ${compiledData.length} chars`);

  // ── Stage 2: Single-shot analysis (1 API call) ──
  const userMessage = `Here is the monthly report:\n\n${reportText}\n\nCurrent month: ${thisMonthFrom} to ${thisMonthTo}\nPrevious month: ${prevMonthFrom} to ${prevMonthTo}\n\nHere is the detailed data from the database:\n\n${compiledData}\n\nAnalyze this data. Focus on the top 3 most actionable insights.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const totalInput = response.usage.input_tokens;
  const totalOutput = response.usage.output_tokens;
  const costUsd = (totalInput / 1_000_000) * INPUT_PRICE_PER_M + (totalOutput / 1_000_000) * OUTPUT_PRICE_PER_M;

  const textBlocks = response.content.filter(b => b.type === 'text');
  const rawText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n');
  const finalText = sanitizeForTelegram(rawText);

  console.log(`[analyst] Done: input=${totalInput}, output=${totalOutput}, cost=$${costUsd.toFixed(3)}`);

  return {
    text: finalText,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd,
    iterations: 1,
    toolCalls: TOOLS,
  };
}
