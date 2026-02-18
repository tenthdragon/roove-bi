// app/api/financial-analysis/route.ts
import { NextRequest } from 'next/server';
import { getFinancialDataForAI } from '@/lib/financial-actions';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ╔══════════════════════════════════════════════════════════╗
// ║  SWITCH: flip to true when ready for production Opus    ║
// ╚══════════════════════════════════════════════════════════╝
const USE_OPUS = true;

const MODEL = USE_OPUS ? 'claude-opus-4-6' : 'claude-haiku-4-5-20251001';
const MAX_TOKENS = USE_OPUS ? 8000 : 2000;

export async function POST(request: NextRequest) {
  try {
    const { mode = 'executive', numMonths = 12 } = await request.json();

    const financialData = await getFinancialDataForAI(numMonths);

    const systemPrompt = USE_OPUS
      ? buildFullSystemPrompt(mode)
      : buildTestSystemPrompt();

    const userPrompt = USE_OPUS
      ? buildFullUserPrompt(financialData, mode)
      : buildTestUserPrompt(financialData);

    // Always use streaming to avoid Vercel timeout
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Collect all text chunks
    let fullText = '';
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullText += event.delta.text;
      }
    }

    // Extract clean JSON
    const cleanJson = extractJSON(fullText);

    return new Response(JSON.stringify({ analysis: cleanJson, mode }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[Financial Analysis API] Error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ============================================================
// JSON EXTRACTION — robust, string-aware
// ============================================================

function extractJSON(raw: string): string {
  // Strip markdown fences
  let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('No JSON found. Response starts with: ' + cleaned.slice(0, 100));
  }

  // String-aware brace matching
  let depth = 0;
  let lastBrace = -1;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { lastBrace = i; break; }
    }
  }

  if (lastBrace === -1) {
    throw new Error('Incomplete JSON. Depth=' + depth + ', length=' + cleaned.length);
  }

  let jsonStr = cleaned.slice(firstBrace, lastBrace + 1);

  // Try parse as-is first
  try {
    JSON.parse(jsonStr);
    return jsonStr;
  } catch (e1) {
    // Fix trailing commas: ,] or ,}
    const fixed = jsonStr.replace(/,\s*([\]}])/g, '$1');
    try {
      JSON.parse(fixed);
      return fixed;
    } catch (e2) {
      throw new Error('Invalid JSON: ' + (e2 as Error).message + '\nFirst 200 chars: ' + jsonStr.slice(0, 200));
    }
  }
}

// ============================================================
// TEST MODE — minimal prompt, cheap, fast
// ============================================================

function buildTestSystemPrompt(): string {
  return `Kamu analis keuangan. Respond HANYA dengan JSON valid. Langsung mulai dengan { tanpa backtick atau teks lain. Bahasa Indonesia.`;
}

function buildTestUserPrompt(data: any): string {
  const { pl, cf } = data;

  // Only send latest 3 months to minimize tokens
  const recentPL = (pl || []).slice(0, 3);
  const recentCF = (cf || []).slice(0, 3);

  return `Analisis ringkas data keuangan ini. HANYA JSON, mulai dengan {

PL (3 bulan terakhir): ${JSON.stringify(recentPL)}
CF (3 bulan terakhir): ${JSON.stringify(recentCF)}

Respond dengan EXACT format ini:
{
  "health_score": number 1-100,
  "health_label": "Critical" atau "Warning" atau "Healthy",
  "unspoken_truth": "satu paragraf singkat insight utama",
  "strategic_advice": {
    "stop_immediately": ["satu hal yang harus stop"],
    "start_this_month": ["satu hal yang harus mulai"],
    "big_decision_this_quarter": "satu keputusan besar"
  },
  "cash_analysis": {
    "current_position": "ringkasan posisi kas",
    "burn_rate": "burn rate",
    "runway_assessment": "estimasi runway",
    "risk_level": "low" atau "medium" atau "high" atau "critical"
  },
  "cost_alerts": [
    {
      "category": "nama item",
      "issue": "masalah singkat",
      "severity": "high",
      "recommendation": "saran singkat",
      "estimated_saving": "estimasi"
    }
  ],
  "key_ratios_alert": [
    {
      "ratio": "nama rasio",
      "current": "nilai",
      "benchmark": "benchmark",
      "status": "warning",
      "interpretation": "arti singkat"
    }
  ]
}`;
}

// ============================================================
// FULL MODE — Opus deep analysis
// ============================================================

function buildFullSystemPrompt(mode: string): string {
  const base = `Kamu adalah penasihat strategis senior — "truth-teller" pribadi untuk CEO RTI Group, perusahaan e-commerce Indonesia dengan multiple brands (Roove, Purvu, Pluve, Osgard, Dr Hyun, Globite, Calmara).

FILOSOFI:
- Berani mengatakan apa yang tidak ingin didengar CEO tetapi HARUS didengar.
- Membaca "antara baris" — pola tersembunyi, korelasi antar metrik, implikasi jangka panjang.
- Saran ACTIONABLE dan SPECIFIC — bukan generik.
- Berpikir dalam kerangka survival vs growth.

KONTEKS BISNIS:
- Consumer goods via marketplace Indonesia (Shopee, TikTok Shop, Tokopedia, BliBli, Lazada) plus Scalev dan reseller.
- Sangat bergantung pada paid ads (Meta, TikTok, marketplace ads).
- 7+ brands sekaligus — perhatikan brand dilution.
- SME Indonesia — benchmark realistis.

DATA RULES:
- PL = akrual delivered basis. CF = kas aktual. Rasio = dari neraca (caveat jika perlu).
- Angka format: Rp 6.78M, Rp 1.2B.

CRITICAL: Respond HANYA JSON. Mulai langsung dengan {. TANPA backtick, TANPA teks di luar JSON. Bahasa Indonesia.`;

  if (mode === 'executive') {
    return base + `

PENASIHAT CEO harus sampaikan:
1. THE UNSPOKEN TRUTH — 2-3 paragraf kebenaran pahit
2. HEALTH SCORE (1-100)
3. STRATEGIC ADVICE — stop/start/big decision/all-in brand
4. CASH ANALYSIS — runway, burn rate, cash traps
5. REVENUE QUALITY — paid vs organic dependency
6. COST SURGERY — spesifik line item + estimasi saving
7. HIDDEN PATTERNS — korelasi tersembunyi
8. COMPETITIVE SURVIVAL — berapa lama survive`;
  }

  return base;
}

function buildFullUserPrompt(data: any, mode: string): string {
  const { pl, cf, ratios } = data;

  let prompt = `Analisis mendalam. HANYA JSON valid, mulai dengan {

=== PL ===
${JSON.stringify(pl, null, 2)}

=== CF ===
${JSON.stringify(cf, null, 2)}

=== RASIO ===
${JSON.stringify(ratios, null, 2)}

`;

  if (mode === 'executive') {
    prompt += `Format EXACT:
{
  "health_score": number,
  "health_label": "Critical"|"Warning"|"Cautious"|"Healthy"|"Strong",
  "unspoken_truth": string,
  "strategic_advice": {
    "stop_immediately": [string, string, string],
    "start_this_month": [string, string, string],
    "big_decision_this_quarter": string,
    "if_only_one_brand": string
  },
  "cash_analysis": {
    "current_position": string,
    "burn_rate": string,
    "runway_assessment": string,
    "cash_traps": string,
    "risk_level": "low"|"medium"|"high"|"critical"
  },
  "revenue_quality": {
    "assessment": string,
    "paid_vs_organic_dependency": string,
    "if_ads_stopped": string,
    "trend": "growing"|"stable"|"declining",
    "concern": string
  },
  "cost_alerts": [{"category":string,"issue":string,"severity":"low"|"medium"|"high","recommendation":string,"estimated_saving":string}],
  "hidden_patterns": [{"pattern":string,"evidence":string,"implication":string,"action":string}],
  "strategic_risks": [{"risk":string,"probability":"low"|"medium"|"high","impact":string,"timeline":string,"mitigation":string}],
  "competitive_survival": {"months_at_current_rate":string,"break_even_requirement":string,"unit_economics_verdict":string},
  "key_ratios_alert": [{"ratio":string,"current":string,"benchmark":string,"status":"healthy"|"warning"|"critical","interpretation":string}]
}`;
  }

  return prompt;
}
