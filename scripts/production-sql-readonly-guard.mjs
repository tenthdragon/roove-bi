// Conservative inspection guard for trusted operators, not a SQL sandbox.
// PostgreSQL's parser supplies the syntax tree; original SQL bytes are retained.
// The server still must enforce read_only. Views, RLS, custom data types and
// implicit operator/cast implementations belong to the trusted database schema.
import { parse } from 'libpg-query';

export const MAX_ROWS = 2000;
export const DEFAULT_ROWS = 200;
export const MAX_CELL_CHARS = 2000;
export const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_SQL_BYTES = 64 * 1024;

// Only reviewed pg_catalog calls. Unqualified calls are explicitly qualified
// before execution so a public-schema overload cannot replace the builtin.
const ALLOWED_FUNCTIONS = new Set([
  // aggregates and window helpers
  'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg', 'bool_and', 'bool_or',
  'every', 'json_agg', 'jsonb_agg', 'json_object_agg', 'jsonb_object_agg', 'percentile_cont',
  'percentile_disc', 'mode', 'row_number', 'rank', 'dense_rank', 'lag', 'lead', 'first_value',
  'last_value', 'nth_value', 'ntile', 'stddev', 'stddev_pop', 'stddev_samp', 'variance',
  'var_pop', 'var_samp',
  // text, number, date
  'length', 'char_length', 'character_length', 'octet_length', 'lower', 'upper', 'initcap',
  'left', 'right', 'ltrim', 'rtrim', 'btrim', 'lpad', 'rpad', 'repeat', 'replace', 'reverse',
  'split_part', 'strpos', 'substr', 'translate', 'concat', 'concat_ws', 'format', 'quote_ident',
  'quote_literal', 'quote_nullable', 'md5', 'encode', 'decode', 'convert_from', 'convert_to',
  'regexp_match', 'regexp_matches', 'regexp_replace', 'regexp_split_to_array',
  'regexp_split_to_table', 'regexp_count', 'regexp_like', 'starts_with', 'to_char', 'to_number',
  'to_date', 'to_timestamp', 'abs', 'ceil', 'ceiling', 'floor', 'round', 'trunc', 'sign', 'mod',
  'power', 'sqrt', 'log', 'ln', 'exp', 'width_bucket', 'random', 'now', 'clock_timestamp',
  'statement_timestamp', 'transaction_timestamp', 'timeofday', 'date_trunc', 'date_part',
  'date_bin', 'age', 'make_date', 'make_time', 'make_timestamp', 'make_timestamptz',
  'make_interval', 'justify_days', 'justify_hours', 'justify_interval', 'isfinite', 'timezone',
  'gen_random_uuid', 'extract', 'position', 'substring', 'overlay', 'trim',
  // arrays, json, rows, sets
  'unnest', 'generate_series', 'generate_subscripts', 'array_length', 'array_upper',
  'array_lower', 'array_dims', 'array_ndims', 'cardinality', 'array_to_string', 'string_to_array',
  'array_position', 'array_positions', 'array_remove', 'array_replace', 'array_append',
  'array_prepend', 'array_cat', 'array_fill', 'array_to_json', 'row_to_json', 'to_json',
  'to_jsonb', 'json_build_object', 'jsonb_build_object', 'json_build_array', 'jsonb_build_array',
  'json_object', 'jsonb_object', 'json_array_length', 'jsonb_array_length', 'json_each',
  'jsonb_each', 'json_each_text', 'jsonb_each_text', 'json_extract_path', 'jsonb_extract_path',
  'json_extract_path_text', 'jsonb_extract_path_text', 'json_object_keys', 'jsonb_object_keys',
  'json_populate_record', 'jsonb_populate_record', 'json_array_elements', 'jsonb_array_elements',
  'json_array_elements_text', 'jsonb_array_elements_text', 'json_typeof', 'jsonb_typeof',
  'jsonb_pretty', 'jsonb_strip_nulls', 'json_strip_nulls', 'jsonb_path_query',
  'jsonb_path_query_array', 'jsonb_path_query_first', 'jsonb_path_exists', 'jsonb_path_match',
  'jsonb_set', 'jsonb_insert', 'jsonb_concat', 'jsonb_contains', 'jsonb_exists',
  // catalog inspection (read-only)
  'has_table_privilege', 'has_column_privilege', 'has_schema_privilege', 'has_function_privilege',
  'has_sequence_privilege', 'has_database_privilege', 'has_any_column_privilege',
  'pg_has_role', 'pg_get_constraintdef', 'pg_get_expr', 'pg_get_indexdef', 'pg_get_viewdef',
  'pg_get_functiondef', 'pg_get_function_arguments', 'pg_get_function_result',
  'pg_get_function_identity_arguments', 'pg_get_triggerdef', 'pg_get_ruledef', 'pg_get_userbyid',
  'pg_get_serial_sequence', 'pg_typeof', 'pg_column_size', 'pg_size_pretty', 'pg_relation_size',
  'pg_total_relation_size', 'pg_table_size', 'pg_indexes_size', 'pg_database_size',
  'pg_size_bytes', 'obj_description', 'col_description', 'shobj_description', 'format_type',
  'to_regclass', 'to_regproc', 'to_regtype', 'to_regnamespace', 'to_regrole', 'pg_describe_object',
  'pg_identify_object', 'pg_relation_filepath', 'pg_tablespace_location', 'pg_postmaster_start_time',
  'pg_conf_load_time', 'current_setting', 'current_database', 'current_schema', 'current_schemas',
  'current_user', 'session_user', 'current_query', 'pg_backend_pid', 'version',
  'inet_server_addr', 'inet_server_port', 'pg_current_wal_lsn', 'pg_is_in_recovery',
  'pg_last_xact_replay_timestamp', 'pg_stat_get_activity',
]);


const ALLOWED_TYPES = new Set([
  'bool', 'boolean', 'int2', 'int4', 'int8', 'smallint', 'integer', 'bigint',
  'numeric', 'decimal', 'real', 'float4', 'float8', 'double precision',
  'text', 'varchar', 'bpchar', 'char', 'name', 'bytea', 'uuid', 'json', 'jsonb',
  'date', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval', 'oid',
  'regclass', 'regtype', 'regproc', 'regprocedure', 'regnamespace', 'regrole',
  'inet', 'cidr', 'macaddr', 'bit', 'varbit',
]);
const ALLOWED_NODES = new Set([
  'SelectStmt', 'ExplainStmt', 'VariableShowStmt', 'FuncCall', 'ColumnRef',
  'A_Star', 'A_Const', 'A_Expr', 'BoolExpr', 'NullTest', 'BooleanTest', 'SubLink',
  'CaseExpr', 'CaseWhen', 'CoalesceExpr', 'MinMaxExpr', 'SQLValueFunction',
  'TypeCast', 'TypeName', 'A_ArrayExpr', 'A_Indices', 'A_Indirection', 'RowExpr',
  'RangeVar', 'RangeSubselect', 'RangeFunction', 'JoinExpr', 'ResTarget',
  'SortBy', 'WindowDef', 'CommonTableExpr', 'WithClause', 'List', 'IntList',
  'String', 'Integer', 'Float', 'Boolean', 'BitString', 'Alias', 'DefElem',
  'NamedArgExpr', 'GroupingSet', 'GroupingFunc',
]);
const names = nodes => (nodes ?? []).map(node => node.String?.sval);
const refuse = reason => ({ ok: false, reason });

/** Validate one statement before any credential lookup or network request. */
export async function validateInspectionSql(input, { limit = DEFAULT_ROWS } = {}) {
  const sql = String(input ?? '');
  if (!sql.trim()) return refuse('Empty statement.');
  if (sql.includes('\0')) return refuse('NUL bytes are not allowed.');
  const source = Buffer.from(sql, 'utf8');
  if (source.length > MAX_SQL_BYTES) return refuse('Statement exceeds 64 KB.');
  const rows = Number(limit);
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    return refuse(`--limit must be an integer from 1 to ${MAX_ROWS}.`);
  }
  let tree;
  try { tree = await parse(sql); }
  catch { return refuse('Invalid PostgreSQL statement.'); }
  if (!tree.stmts?.length) return refuse('Empty statement.');
  if (tree.stmts.length !== 1) return refuse('Exactly one statement is allowed.');
  const raw = tree.stmts[0];
  const statement = raw.stmt;
  if (!statement.SelectStmt && !statement.ExplainStmt && !statement.VariableShowStmt) {
    return refuse('Only SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW statements are allowed.');
  }

  const insertions = new Set();
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    for (const [kind, node] of Object.entries(value)) {
      if (/^[A-Z]/.test(kind) && !ALLOWED_NODES.has(kind)) {
        throw new Error(`SQL construct ${kind} is not allowed in an inspection statement.`);
      }
      if (kind === 'SelectStmt') {
        if (node.intoClause) throw new Error('SELECT ... INTO creates a table.');
        if (node.lockingClause?.length) throw new Error('FOR UPDATE / FOR SHARE locks rows; use a plain SELECT.');
      }
      if (kind === 'ExplainStmt') {
        if (!node.query?.SelectStmt) throw new Error('EXPLAIN only accepts a SELECT inspection.');
        for (const option of node.options ?? []) {
          const name = option.DefElem?.defname?.toLowerCase();
          if (name === 'analyze' || name === 'analyse') throw new Error('EXPLAIN ANALYZE executes the statement; use plain EXPLAIN.');
          if (!['verbose', 'costs', 'settings', 'format'].includes(name)) throw new Error(`EXPLAIN option ${name} is not allowed.`);
        }
      }
      if (kind === 'FuncCall') {
        const parts = names(node.funcname);
        if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'pg_catalog') || !ALLOWED_FUNCTIONS.has(parts.at(-1))) {
          throw new Error(`Function ${parts.join('.')} is not an audited pg_catalog inspection function.`);
        }
        if (parts.length === 1) insertions.add(node.location);
      }
      // Field selection is also function-call syntax in PostgreSQL, even when
      // there are no parentheses after the function name. Qualified column
      // names can fall back to functions on a whole-row value as well. Refuse
      // both; ordinary unqualified columns and alias.* remain supported.
      if (kind === 'A_Indirection' && node.indirection?.some(part => part.String)) {
        throw new Error('Field selection can invoke functions; use an unqualified column.');
      }
      if (kind === 'ColumnRef' && node.fields.length > 1 && !node.fields.at(-1).A_Star) {
        throw new Error('Qualified column/field selection can invoke functions; use unqualified columns or SELECT alias.*.');
      }
      if (kind === 'A_Expr' && node.name?.length > 1) {
        throw new Error('Explicit OPERATOR(...) syntax is not allowed.');
      }
      if (kind === 'typeName' || kind === 'TypeName') {
        const parts = names(node.names);
        if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'pg_catalog') || !ALLOWED_TYPES.has(parts.at(-1))) {
          throw new Error('Only builtin pg_catalog type casts are allowed.');
        }
        if (parts.length === 1) insertions.add(node.location);
      }
      inspect(node);
    }
  }
  try { inspect(statement); }
  catch (error) { return refuse(error.message); }

  // Parser locations and stmt_len are UTF-8 byte offsets, not JS indices.
  // Keep operators, literal prefixes, whitespace and comments byte-for-byte.
  const start = raw.stmt_location ?? 0;
  const end = raw.stmt_len ? start + raw.stmt_len : source.length;
  let bare = source.subarray(start, end);
  for (const offset of [...insertions].sort((a, b) => b - a)) {
    if (!Number.isInteger(offset) || offset < start || offset >= end) return refuse('Unsupported implicit function/type syntax.');
    const relative = offset - start;
    bare = Buffer.concat([bare.subarray(0, relative), Buffer.from('pg_catalog.'), bare.subarray(relative)]);
  }
  const bareSql = bare.toString('utf8');
  const wrapped = statement.ExplainStmt || statement.VariableShowStmt
    ? bareSql
    : `select * from (\n${bareSql}\n) as readonly_inspection limit ${rows + 1}`;
  return { ok: true, statement: wrapped, rows };
}

/** A display cap, not a database-read or bulk-export authorization boundary. */
export function clipCell(value, max = MAX_CELL_CHARS) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more chars]` : text;
}
