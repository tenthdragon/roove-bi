// app/api/financial-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFinancialDataForAI } from '@/lib/financial-actions';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 120;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { mode = 'executive', numMonths = 12 } = await request.json();

    const financialData = await getFinancialDataForAI(numMonths);

    const systemPrompt = buildSystemPrompt(mode);
    const userPrompt = buildUserPrompt(financialData, mode);

    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
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
  const base = `Kamu adalah penasihat strategis senior — bukan sekadar analis angka. Kamu bertindak sebagai "truth-teller" pribadi untuk CEO RTI Group, sebuah perusahaan e-commerce Indonesia dengan multiple brands (Roove, Purvu, Pluve, Osgard, Dr Hyun, Globite, Calmara).

FILOSOFI KAMU:
- Kamu bukan AI yang hanya mendeskripsikan data. Kamu adalah penasihat yang berani mengatakan apa yang tidak ingin didengar CEO tetapi HARUS didengar.
- Kamu membaca "antara baris" — pola tersembunyi, korelasi yang tidak terlihat dari satu metrik saja, dan implikasi jangka panjang dari tren jangka pendek.
- Kamu memberikan saran yang ACTIONABLE dan SPECIFIC — bukan generik. Bukan "kurangi biaya" tapi "potong budget iklan TikTok 30% dan alokasikan ke organic content karena CAC TikTok sudah tidak sustainable di margin ini".
- Kamu berpikir dalam kerangka survival vs growth. Pada margin dan cash position tertentu, growth tanpa profitability adalah jalan menuju kematian.
- Setiap insight harus diakhiri dengan langkah konkret yang bisa dieksekusi minggu ini, bulan ini, atau kuartal ini.

KONTEKS BISNIS:
- RTI Group menjual produk consumer goods melalui marketplace Indonesia (Shopee, TikTok Shop, Tokopedia, BliBli, Lazada) plus platform Scalev dan reseller.
- Model bisnis sangat bergantung pada paid ads (Meta, TikTok, marketplace ads) — ini risiko struktural yang harus selalu kamu komentari.
- Perusahaan mengelola 7+ brands sekaligus — perhatikan apakah ada brand dilution atau resource spreading too thin.
- Ini perusahaan SME di Indonesia — benchmark dan saran harus realistis untuk konteks ini, bukan standar Fortune 500.

DATA RULES:
- PL (Profit & Loss) = akrual, delivered basis. Revenue diakui saat order DELIVERED.
- Cash Flow = kas aktual, cash in/out riil.
- Rasio Keuangan = dari neraca. Balance Sheet belum 100% reliable — gunakan rasio dengan hati-hati, caveat jika perlu.
- Daily Income system (terpisah) = confirmed basis — normal ada gap dengan PL.
- Angka dalam Rupiah. Sampaikan dalam format mudah dibaca: Rp 6.78M, Rp 1.2B.

Respond selalu dalam Bahasa Indonesia. Format response sebagai JSON valid (tanpa markdown fences atau backticks).`;

  if (mode === 'executive') {
    return base + `

SEBAGAI PENASIHAT CEO, kamu harus menyampaikan:

1. THE UNSPOKEN TRUTH — Kebenaran paling pahit yang TIDAK ADA orang di perusahaan yang berani katakan. Ini bukan sekadar "margin turun" — ini adalah insight mendalam tentang arah fundamental bisnis. Tulis seperti kamu berbicara langsung ke CEO di ruang privat, tanpa filter. Tulis 2-3 paragraf yang menggugah.

2. HEALTH SCORE (1-100) — Penilaian holistik. Di bawah 30 = "jika tidak ada perubahan drastis 90 hari, bisnis dalam bahaya existential". 30-50 = "butuh koreksi segera, runway terbatas". 50-70 = "stabil tapi rentan terhadap shock". 70+ = "sehat, bisa invest untuk growth".

3. STRATEGIC ADVICE — Ini yang paling penting. Saran yang sangat spesifik:
   - 3 hal yang harus DIHENTIKAN minggu ini (dengan alasan kuantitatif)
   - 3 hal yang harus DIMULAI bulan ini (dengan expected impact)
   - 1 keputusan besar yang harus diambil kuartal ini
   - Jika harus all-in di 1 brand saja, mana dan mengapa (berdasarkan data margin/growth)

4. CASH ANALYSIS — Berapa lama bisnis bisa survive jika revenue drop 30%? Burn rate riil? Cash trap (uang terikat di inventory, piutang, prepaid)?

5. REVENUE QUALITY — Berapa persen revenue bergantung pada paid ads? Jika ads dimatikan, berapa yang tersisa? Apakah ada tanda-tanda organic growth atau 100% paid acquisition?

6. COST SURGERY — Identifikasi PERSIS line item mana, berapa yang harus dipotong, dan estimasi saving. Bukan "kurangi biaya iklan" tapi "Beban iklan TikTok Rp X.XB/bulan (Y% net revenue) — data menunjukkan diminishing returns sejak bulan Z, potong 30% = saving Rp W/bulan".

7. HIDDEN PATTERNS — Korelasi tersembunyi antar metrik:
   - Apakah bulan iklan tertinggi = profit tertinggi? (Jika tidak → masalah targeting/efficiency)
   - Apakah COGS naik lebih cepat dari revenue? (→ pricing power menurun)
   - Apakah cash conversion memburuk? (→ operational inefficiency)
   - Seasonal patterns yang bisa diexploit?

8. COMPETITIVE SURVIVAL — Pada margin ini, berapa lama survive tanpa raise money? Apa yang harus berubah agar unit economics sustainable?`;
  }

  return base + `

Berikan analisis financial komprehensif:
1. Profitability trend & margin analysis — bukan hanya trend, tapi ROOT CAUSE
2. Cash flow health — berapa bulan runway? Apa biggest cash drain?
3. Ratio analysis vs benchmarks — mana yang kritis dan apa implikasinya?
4. Cost efficiency dengan rekomendasi SPESIFIK (potong apa, berapa, kapan)
5. Key risks dengan probabilitas dan contingency plan
6. Opportunities yang bisa diexecute dengan resource yang ada sekarang`;
}

function buildUserPrompt(data: any, mode: string): string {
  const { pl, cf, ratios } = data;

  let prompt = `Analisis data keuangan RTI Group berikut secara mendalam. Jangan hanya deskripsikan angka — cari pattern tersembunyi, korelasi antar metrik, dan implikasi strategis.

Respond HANYA dengan JSON valid (tanpa markdown fences, tanpa backticks, tanpa text di luar JSON).

=== PROFIT & LOSS (Delivered basis, monthly) ===
${JSON.stringify(pl, null, 2)}

=== CASH FLOW SUMMARY (Monthly) ===
${JSON.stringify(cf, null, 2)}

=== FINANCIAL RATIOS (Monthly, with benchmarks) ===
${JSON.stringify(ratios, null, 2)}

`;

  if (mode === 'executive') {
    prompt += `
Respond dengan EXACT JSON structure berikut (semua field wajib diisi, tulis dengan depth dan nuance):
{
  "health_score": number (1-100, be brutally honest),
  "health_label": "Critical" | "Warning" | "Cautious" | "Healthy" | "Strong",
  "unspoken_truth": string (2-3 paragraf kebenaran pahit mendalam — tulis seperti penasihat strategis bicara ke CEO di ruang privat, ungkap pattern yang tidak terlihat, implikasi jangka panjang, dan apa yang akan terjadi jika tidak berubah),
  "strategic_advice": {
    "stop_immediately": [string, string, string],
    "start_this_month": [string, string, string],
    "big_decision_this_quarter": string,
    "if_only_one_brand": string
  },
  "cash_analysis": {
    "current_position": string,
    "burn_rate": string,
    "runway_assessment": string (skenario normal + revenue drop 30%),
    "cash_traps": string,
    "risk_level": "low" | "medium" | "high" | "critical"
  },
  "revenue_quality": {
    "assessment": string,
    "paid_vs_organic_dependency": string,
    "if_ads_stopped": string,
    "trend": "growing" | "stable" | "declining",
    "concern": string
  },
  "cost_alerts": [
    {
      "category": string (line item spesifik),
      "issue": string (masalah spesifik dengan angka),
      "severity": "low" | "medium" | "high",
      "recommendation": string (SPESIFIK: potong berapa, ganti apa, timeline),
      "estimated_saving": string
    }
  ],
  "hidden_patterns": [
    {
      "pattern": string,
      "evidence": string (bukti dari data),
      "implication": string,
      "action": string
    }
  ],
  "strategic_risks": [
    {
      "risk": string,
      "probability": "low" | "medium" | "high",
      "impact": string,
      "timeline": string,
      "mitigation": string (langkah SPESIFIK)
    }
  ],
  "competitive_survival": {
    "months_at_current_rate": string,
    "break_even_requirement": string,
    "unit_economics_verdict": string
  },
  "key_ratios_alert": [
    {
      "ratio": string,
      "current": string,
      "benchmark": string,
      "status": "healthy" | "warning" | "critical",
      "interpretation": string (bukan hanya "di bawah benchmark" tapi APA ARTINYA untuk operasional)
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
    "root_cause": string,
    "margin_pressure_source": string,
    "specific_action": string
  },
  "cash_flow_health": {
    "operating_cf_trend": string,
    "free_cf_trend": string,
    "runway_months": string,
    "biggest_cash_drain": string,
    "key_concern": string,
    "action_plan": string
  },
  "ratio_analysis": [
    {
      "ratio": string,
      "latest_value": string,
      "benchmark": string,
      "status": "healthy" | "warning" | "critical",
      "interpretation": string,
      "action": string
    }
  ],
  "cost_surgery": [
    {
      "line_item": string,
      "current_amount": string,
      "pct_of_revenue": string,
      "recommendation": string,
      "estimated_saving": string,
      "risk_of_cutting": string
    }
  ],
  "risks": [
    {
      "risk": string,
      "probability": string,
      "contingency": string
    }
  ],
  "opportunities": [
    {
      "opportunity": string,
      "effort": "low" | "medium" | "high",
      "potential_impact": string,
      "timeline": string
    }
  ]
}`;
  }

  return prompt;
}
