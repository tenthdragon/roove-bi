export type RichNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string }[]; content?: RichNode[] };
export type CaseAttempt = { id: string; hypothesis: RichNode; action: RichNode; result: RichNode };
export type GrowthCase = { id: string; title: string; status: 'open' | 'solved'; problem: RichNode; attempts: CaseAttempt[]; version: number; created_at: string; updated_at: string };
export const emptyDocument = (): RichNode => ({ type: 'doc', content: [{ type: 'paragraph' }] });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types = new Set(['doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','image','table','tableRow','tableCell','tableHeader']);
const marks = new Set(['bold','italic','strike','code','underline']);
export function validateDocument(value: unknown, caseId: string): RichNode {
  if (JSON.stringify(value)?.length > 200_000) throw new Error('Isi editor terlalu panjang.');
  let count = 0;
  function visit(input: unknown, depth: number): RichNode {
    if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 20 || ++count > 5000) throw new Error('Format editor tidak valid.');
    const source = input as RichNode;
    const node = { ...source, ...(source.attrs ? { attrs: { ...source.attrs } } : {}) };
    // Recent Tiptap tables emit a default null alignment. P0.1 does not expose
    // cell alignment; omit that empty default from the persisted schema.
    if (['tableCell','tableHeader'].includes(node.type) && node.attrs?.align === null) delete node.attrs.align;
    if (!types.has(node.type) || Object.keys(node).some(k => !['type','text','attrs','marks','content'].includes(k))) throw new Error('Format editor tidak didukung.');
    if (node.text !== undefined && (node.type !== 'text' || typeof node.text !== 'string')) throw new Error('Teks tidak valid.');
    if (node.type === 'text' && typeof node.text !== 'string') throw new Error('Teks tidak valid.');
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some(m => !marks.has(m.type) || Object.keys(m).some(k => k !== 'type')))) throw new Error('Format teks tidak didukung.');
    if (node.attrs) {
      if (typeof node.attrs !== 'object' || Array.isArray(node.attrs)) throw new Error('Atribut tidak valid.');
      const allowed: Record<string,string[]> = { heading:['level'], orderedList:['start','type'], image:['src','alt','title','width','height'], tableCell:['colspan','rowspan','colwidth'], tableHeader:['colspan','rowspan','colwidth'] };
      if (Object.keys(node.attrs).some(k => !(allowed[node.type] || []).includes(k))) throw new Error('Atribut editor tidak didukung.');
      if (node.type === 'heading' && ![1,2,3,4,5,6].includes(Number(node.attrs.level))) throw new Error('Judul tidak valid.');
      for (const key of ['colspan','rowspan','start','width','height']) if (node.attrs[key] != null && (!Number.isInteger(node.attrs[key]) || Number(node.attrs[key]) < 1 || Number(node.attrs[key]) > 2000)) throw new Error('Ukuran tidak valid.');
      if (node.attrs.colwidth != null && (!Array.isArray(node.attrs.colwidth) || node.attrs.colwidth.length > 100 || node.attrs.colwidth.some(n => !Number.isInteger(n) || n < 1 || n > 2000))) throw new Error('Lebar tabel tidak valid.');
      for (const key of ['alt','title']) if (node.attrs[key] != null && (typeof node.attrs[key] !== 'string' || String(node.attrs[key]).length > 500)) throw new Error('Keterangan gambar terlalu panjang.');
    }
    if (node.type === 'image' && !new RegExp(`^/api/growth-cases/${caseId}/images/[0-9a-f-]{36}\\.(png|jpg|webp|gif)$`, 'i').test(String(node.attrs?.src))) throw new Error('Gambar harus diunggah ke kasus ini.');
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error('Isi editor tidak valid.');
      node.content=node.content.map(c => visit(c, depth + 1));
    }
    return node;
  }
  const result = visit(value, 0);
  if (result.type !== 'doc') throw new Error('Dokumen tidak valid.');
  return result;
}
export function validateCaseInput(input: unknown, caseId: string) {
  const value = input as GrowthCase;
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 160) throw new Error('Judul wajib diisi, maksimal 160 karakter.');
  if (!['open','solved'].includes(value.status) || !Number.isInteger(value.version) || value.version < 1) throw new Error('Status atau versi tidak valid.');
  if (!Array.isArray(value.attempts) || !value.attempts.length || value.attempts.length > 50) throw new Error('Maksimal 50 percobaan per kasus.');
  const ids = new Set<string>();
  const attempts = value.attempts.map(a => {
    if (!a || !UUID.test(a.id) || ids.has(a.id)) throw new Error('Percobaan tidak valid.');
    ids.add(a.id);
    return { id:a.id, hypothesis:validateDocument(a.hypothesis,caseId), action:validateDocument(a.action,caseId), result:validateDocument(a.result,caseId) };
  });
  return { title:value.title.trim(), status:value.status, version:value.version, problem:validateDocument(value.problem,caseId), attempts };
}
export function documentText(doc: RichNode): string {
  return doc.text || (doc.content || []).map(documentText).join(' ');
}
export function imageExtension(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | 'gif' | null {
  const ascii = (a:number,b:number) => String.fromCharCode(...bytes.slice(a,b));
  if (bytes[0]===137 && ascii(1,4)==='PNG' && bytes[4]===13 && bytes[5]===10 && bytes[6]===26 && bytes[7]===10) return 'png';
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'jpg';
  if (ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP') return 'webp';
  if (['GIF87a','GIF89a'].includes(ascii(0,6))) return 'gif';
  return null;
}
