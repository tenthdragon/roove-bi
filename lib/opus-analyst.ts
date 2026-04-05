// lib/opus-analyst.ts — Pre-fetch data + Opus single-shot with optional tool follow-up
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFINITIONS, executeTool } from '@/lib/report-tools';

const MODEL = 'claude-opus-4-20250514';
const MAX_FOLLOWUP = 3; // max additional tool iterations after initial analysis

// Pricing per million tokens (USD) — Opus 4
const INPUT_PRICE_PER_M = 15;
const OUTPUT_PRICE_PER_M = 75;

const PREFETCH_TOOLS = [
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

YOUR JOB:
1. Find the TOP 3 most impactful, non-obvious insights from the data
2. Support each insight with specific numbers
3. Provide actionable recommendations

WHAT NOT TO DO:
- Do NOT point out that MTD totals are lower than full-month totals — this is obvious
- Do NOT warn about "incomplete data" or "only X days"
- Do NOT panic about daily revenue spikes/dips — these are NORMAL because shipments don't happen every day (weekends, holidays). Pending orders accumulate and get shipped in batches, causing natural spikes the next working day.
- Do NOT treat CR >100% as an error — shipped orders on a given day may include leads from previous days (spillover). CR is a same-day proxy, not a cohort metric.
- Do NOT call something a crisis without checking for mundane explanations first (delayed shipments, pending orders, holidays)
- Instead, focus on RATES, RATIOS, and PROPORTIONAL changes (avg/day, margins, mix shifts)
- Look for the unspoken truths: brand mix shifts, channel migration, efficiency changes

ANALYTICAL RIGOR:
- CR 90%+ for Scalev channel is GOOD, not bad
- Before concluding a brand is failing, check: are there pending/delayed orders not yet shipped? Is the low volume just due to few days of data?
- When comparing months, use avg/day or percentage metrics — not absolute totals
- Consider operational realities: warehouse doesn't ship every day, so daily data is lumpy

TOOLS:
- You already have pre-fetched data for this month and last month below
- You also have access to tools if you need data OUTSIDE the provided range (e.g. checking a 3-month trend, or drilling into a specific week)
- Only use tools when the pre-fetched data is insufficient

FORMATTING (CRITICAL):
- Output is rendered in Telegram which uses HTML, NOT Markdown
- Use <b>bold</b> for emphasis (NOT **bold** or __bold__)
- Use <i>italic</i> for secondary info (NOT *italic* or _italic_)
- Do NOT use markdown headers (#, ##), bullet asterisks, or any markdown syntax
- Use plain dashes (-) or emoji for bullet points
- Keep it clean and readable on a phone screen
- After each section title/header, always add an empty line before the content

BUSINESS CONTEXT:
- Meta Ads is a demand creation channel. Customers discover via Meta but often purchase on marketplaces (Shopee, TikTok Shop). Meta revenue ≠ Meta-attributed sales.
- Not all brands have ad spend. Check the ads data before attributing growth to ads.
- Marketplace orders are manually inputted by ops into Scalev, so their draft_time ≈ shipped_time. Marketplace CR is artificially ~100% — not real conversion.
- Warehouse does NOT ship every day. Weekends and holidays have zero shipments. Orders accumulate as pending and get shipped in batches on the next working day — this causes natural daily revenue spikes. This is NORMAL, not an anomaly.

Write in Bahasa Indonesia. Be concise — max 3-4 paragraphs.
When using tools, parameters "from" and "to" must be YYYY-MM-DD format.`;

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

  // ── Stage 1: Pre-fetch all standard data (free, ~2 sec) ──
  console.log('[analyst] Pre-fetching data...');
  const dataBlocks: string[] = [];

  for (const tool of PREFETCH_TOOLS) {
    const [thisData, prevData] = await Promise.all([
      executeTool(tool, { from: thisMonthFrom, to: thisMonthTo }),
      executeTool(tool, { from: prevMonthFrom, to: prevMonthTo }),
    ]);
    dataBlocks.push(
      `=== ${tool} | ${thisMonthFrom} to ${thisMonthTo} ===\n${thisData}`,
      `=== ${tool} | ${prevMonthFrom} to ${prevMonthTo} ===\n${prevData}`,
    );
  }

  const compiledData = dataBlocks.join('\n\n');
  console.log(`[analyst] Data compiled: ${compiledData.length} chars`);

  // ── Stage 2: Opus with pre-fetched data + tools available for follow-up ──
  const userMessage = `Monthly report:\n\n${reportText}\n\nCurrent month: ${thisMonthFrom} to ${thisMonthTo}\nPrevious month: ${prevMonthFrom} to ${prevMonthTo}\n\n--- PRE-FETCHED DATA ---\n\n${compiledData}\n\n--- END DATA ---\n\nAnalyze this data. Find the top 3 most actionable insights. You may use tools if you need data outside the provided range.`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  const toolCalls: string[] = [...PREFETCH_TOOLS]; // pre-fetched tools
  let iteration = 0;

  while (iteration <= MAX_FOLLOWUP) {
    iteration++;
    console.log(`[analyst] API call ${iteration}`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS as any,
      messages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    if (response.stop_reason === 'tool_use' && iteration <= MAX_FOLLOWUP) {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`[analyst] Follow-up tool: ${block.name}(${JSON.stringify(block.input)})`);
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
      // Done — extract text
      const textBlocks = response.content.filter(b => b.type === 'text');
      const rawText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n');
      const finalText = sanitizeForTelegram(rawText);

      const costUsd = (totalInput / 1_000_000) * INPUT_PRICE_PER_M + (totalOutput / 1_000_000) * OUTPUT_PRICE_PER_M;
      console.log(`[analyst] Done: ${iteration} calls, input=${totalInput}, output=${totalOutput}, cost=$${costUsd.toFixed(3)}`);

      return { text: finalText, inputTokens: totalInput, outputTokens: totalOutput, costUsd, iterations: iteration, toolCalls };
    }
  }

  const costUsd = (totalInput / 1_000_000) * INPUT_PRICE_PER_M + (totalOutput / 1_000_000) * OUTPUT_PRICE_PER_M;
  return { text: 'Analisis tidak dapat diselesaikan — terlalu banyak follow-up.', inputTokens: totalInput, outputTokens: totalOutput, costUsd, iterations: iteration, toolCalls };
}
