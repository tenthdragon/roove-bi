// app/api/financial-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFinancialDataForAI } from '@/lib/financial-actions';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { mode = 'executive', numMonths = 6 } = await request.json();

    // Fetch financial data
    const financialData = await getFinancialDataForAI(numMonths);

    const systemPrompt = buildSystemPrompt(mode);
    const userPrompt = buildUserPrompt(financialData, mode);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return NextResponse.json({ analysis: responseText, mode });
  } catch (err: any) {
    console.error('[Financial Analysis API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function buildSystemPrompt(mode: string): string {
  const base = `Kamu adalah analis keuangan senior untuk RTI Group, sebuah perusahaan e-commerce Indonesia dengan multiple brands (Roove, Purvu, Pluve, Osgard, Dr Hyun, Globite, Calmara, dll).

PENTING:
- Data Profit & Loss (PL) berbasis akrual — revenue diakui saat order DELIVERED
- Data operasional harian (Daily Income) berbasis CONFIRMED order — ada timing difference yang normal
- Balance Sheet belum reliable — jangan gunakan untuk analisis solvency
- Data Cash Flow (CF) berbasis kas — cash in/out aktual
- Selalu berikan angka dalam format Rupiah yang mudah dibaca (misal: Rp 6.78M, Rp 1.2B)

Respond in Bahasa Indonesia. Format response sebagai JSON valid.`;

  if (mode === 'executive') {
    return base + `\n\nKamu memberikan analisis untuk CEO. Fokus pada:
1. The Unspoken Truth — satu kebenaran pahit yang harus CEO dengar
2. Health Score (1-100) — kondisi keseluruhan bisnis
3. Cash position & burn analysis — apakah cash aman?
4. Revenue quality — apakah pertumbuhan sustainable?
5. Cost structure alert — biaya mana yang tidak proporsional?
6. Strategic risks yang tidak terlihat dari angka permukaan`;
  }

  return base + `\n\nBerikan analisis financial komprehensif meliputi:
1. Profitability trend & margin analysis
2. Cash flow health & proxy cash conversion analysis
3. Ratio analysis vs benchmarks — mana yang di luar range?
4. Cost efficiency — beban mana yang perlu perhatian?
5. Key risks & opportunities`;
}

function buildUserPrompt(data: any, mode: string): string {
  const { pl, cf, ratios } = data;

  let prompt = `Analisis data keuangan berikut dan respond HANYA dengan JSON valid (tanpa markdown fences).

=== PROFIT & LOSS (Delivered basis) ===
${JSON.stringify(pl, null, 2)}

=== CASH FLOW SUMMARY ===
${JSON.stringify(cf, null, 2)}

=== FINANCIAL RATIOS ===
${JSON.stringify(ratios, null, 2)}

`;

  if (mode === 'executive') {
    prompt += `
Respond dengan JSON format:
{
  "health_score": number (1-100),
  "health_label": string ("Critical"/"Warning"/"Healthy"/"Strong"),
  "unspoken_truth": string (satu paragraf kebenaran pahit),
  "cash_analysis": {
    "current_position": string,
    "burn_rate": string,
    "runway_assessment": string,
    "risk_level": "low" | "medium" | "high" | "critical"
  },
  "revenue_quality": {
    "assessment": string,
    "trend": "growing" | "stable" | "declining",
    "concern": string
  },
  "cost_alerts": [
    {
      "category": string,
      "issue": string,
      "severity": "low" | "medium" | "high",
      "recommendation": string
    }
  ],
  "strategic_risks": [
    {
      "risk": string,
      "probability": "low" | "medium" | "high",
      "impact": string,
      "mitigation": string
    }
  ],
  "cash_proxy_analysis": {
    "collection_efficiency": string,
    "supplier_payment_pressure": string,
    "operating_cash_gap": string
  },
  "key_ratios_alert": [
    {
      "ratio": string,
      "current": string,
      "benchmark": string,
      "status": "healthy" | "warning" | "critical",
      "interpretation": string
    }
  ]
}`;
  } else {
    prompt += `
Respond dengan JSON format:
{
  "profitability": {
    "gpm_trend": string,
    "npm_trend": string,
    "key_finding": string,
    "margin_pressure_source": string
  },
  "cash_flow_health": {
    "operating_cf_trend": string,
    "free_cf_trend": string,
    "collection_efficiency": string,
    "key_concern": string
  },
  "ratio_analysis": [
    {
      "ratio": string,
      "latest_value": string,
      "benchmark": string,
      "status": "healthy" | "warning" | "critical",
      "interpretation": string
    }
  ],
  "cost_efficiency": [
    {
      "category": string,
      "pct_of_revenue": string,
      "trend": "improving" | "stable" | "worsening",
      "recommendation": string
    }
  ],
  "risks": [string],
  "opportunities": [string],
  "cash_proxy_analysis": {
    "penerimaan_vs_pengeluaran": string,
    "iklan_cash_burn": string,
    "pajak_burden": string,
    "supplier_timing": string
  }
}`;
  }

  return prompt;
}
