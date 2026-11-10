import { createHmac, timingSafeEqual } from 'node:crypto';
export type DiagnosisPermit = {
  workspaceId: string; actorId: string; revision: number; account: string; expiresAt: number;
  targetBusinessId: number; targetUid: string | null; skus: string[];
  stores: { id: number; scalevId: number | null; name: string }[];
  bundles: { sku: string; id: number; sourceBusinessId: number; ownerUid: string | null; optionIds: number[]; canShare: boolean }[];
};
function signature(data: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Penandatangan diagnosis belum tersedia.');
  return createHmac('sha256', key).update(`marketplace-parser-repair-v1:${data}`).digest();
}
export function signDiagnosis(permit: DiagnosisPermit) {
  const data = Buffer.from(JSON.stringify(permit)).toString('base64url');
  return `${data}.${signature(data).toString('base64url')}`;
}
export function verifyDiagnosis(token: string, workspaceId: string, actorId: string): DiagnosisPermit {
  if (typeof token !== 'string' || token.length > 200000 || !/^[\w-]+\.[\w-]+$/.test(token)) throw new Error('Diagnosis tidak valid. Periksa masalah kembali.');
  const [data, mac] = token.split('.'), expected = signature(data), supplied = Buffer.from(mac, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('Diagnosis tidak valid. Periksa masalah kembali.');
  const permit = JSON.parse(Buffer.from(data, 'base64url').toString()) as DiagnosisPermit;
  if (permit.workspaceId !== workspaceId || permit.actorId !== actorId || !Number.isFinite(permit.expiresAt) || permit.expiresAt <= Date.now()) throw new Error('Diagnosis kedaluwarsa atau bukan milik sesi ini. Periksa masalah kembali.');
  return permit;
}
