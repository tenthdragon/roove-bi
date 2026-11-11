// Guard for scripts/production-sql-readonly.mjs: decides, offline and before
// any request, whether a piece of SQL is an audited read-only inspection.
//
// The server-side read-only transaction (Management API `read_only: true`)
// blocks ordinary writes, but a SELECT can still call functions with side
// effects (pg_terminate_backend, pg_advisory_lock, dblink_exec, ...). This
// guard therefore tokenizes the statement with PostgreSQL lexical rules and
// allows only:
//   * one statement whose first keyword is SELECT, WITH, TABLE, VALUES,
//     EXPLAIN or SHOW;
//   * no data-changing or session-changing keyword anywhere outside literals;
//   * no SELECT ... INTO;
//   * function calls only from an explicit allowlist of pure/stable
//     inspection functions (optionally pg_catalog-qualified).
// Keywords, separators and function names inside string literals,
// dollar-quoted strings, quoted identifiers or comments are not inspected,
// which is the point of tokenizing instead of substring matching.

export const MAX_ROWS = 2000;
export const DEFAULT_ROWS = 200;
export const MAX_CELL_CHARS = 2000;
export const MAX_OUTPUT_BYTES = 256 * 1024;

const FIRST_KEYWORDS = new Set(['select', 'with', 'table', 'values', 'explain', 'show']);

// Any of these as a bare token means the statement is not an inspection.
const FORBIDDEN_KEYWORDS = new Set([
  'insert', 'update', 'delete', 'merge', 'truncate', 'create', 'alter', 'drop',
  'grant', 'revoke', 'copy', 'lock', 'call', 'do', 'set', 'reset', 'vacuum',
  'analyze', 'analyse', 'refresh', 'cluster', 'reindex', 'notify', 'listen',
  'unlisten', 'discard', 'prepare', 'execute', 'deallocate', 'declare', 'fetch',
  'move', 'close', 'begin', 'commit', 'rollback', 'savepoint', 'release',
  'security', 'import', 'load', 'checkpoint', 'comment', 'for',
]);

// Pure or stable functions that only read. Anything not listed is refused,
// so a new function has to be reviewed before an agent can call it.
export const ALLOWED_FUNCTIONS = new Set([
  // aggregates and window helpers
  'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg', 'bool_and', 'bool_or',
  'every', 'json_agg', 'jsonb_agg', 'json_object_agg', 'jsonb_object_agg', 'percentile_cont',
  'percentile_disc', 'mode', 'row_number', 'rank', 'dense_rank', 'lag', 'lead', 'first_value',
  'last_value', 'nth_value', 'ntile', 'stddev', 'stddev_pop', 'stddev_samp', 'variance',
  'var_pop', 'var_samp',
  // sql-standard expression syntax that lexes like a call
  'coalesce', 'nullif', 'greatest', 'least', 'cast', 'exists', 'any', 'all', 'some', 'array',
  'row', 'extract', 'position', 'substring', 'overlay', 'trim', 'in', 'grouping', 'filter',
  'over', 'within', 'ordinality',
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
  'gen_random_uuid', 'uuid_generate_v4',
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
  'pg_last_xact_replay_timestamp', 'txid_current', 'pg_current_xact_id',
  'pg_stat_get_activity', 'pg_stat_file', 'pg_ls_dir',
]);

// Structural keywords that are legitimately followed by "(" without being a call.
const NON_CALL_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'as', 'on', 'join', 'inner', 'outer', 'cross',
  'natural', 'full', 'union', 'intersect', 'except', 'when', 'then', 'else', 'case', 'end', 'by',
  'group', 'order', 'having', 'limit', 'offset', 'distinct', 'with', 'recursive', 'lateral',
  'using', 'is', 'like', 'ilike', 'similar', 'between', 'values', 'table', 'explain', 'show',
  'interval', 'null', 'true', 'false', 'asc', 'desc', 'nulls', 'first', 'last', 'collate',
  'only', 'window', 'partition', 'rows', 'range', 'groups', 'materialized',
]);

const EFFECTIVELY_FORBIDDEN_FUNCTION_NOTE = 'Only audited read-only inspection functions are allowed; see ALLOWED_FUNCTIONS in scripts/production-sql-readonly-guard.mjs.';

/**
 * Tokenizes SQL with PostgreSQL lexical rules. Returns word/punctuation tokens
 * only; strings, quoted identifiers and comments collapse into opaque tokens.
 */
export function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      tokens.push({ type: 'comment', value: sql.slice(i, end === -1 ? n : end) });
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 2; continue; }
        j += 1;
      }
      if (depth > 0) throw new Error('Unterminated block comment.');
      tokens.push({ type: 'comment', value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "'" || ((ch === 'E' || ch === 'e') && next === "'")) {
      let j = ch === "'" ? i + 1 : i + 2;
      const escaped = ch !== "'";
      while (j < n) {
        if (escaped && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      if (j >= n) throw new Error('Unterminated string literal.');
      tokens.push({ type: 'string', value: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) throw new Error('Unterminated dollar-quoted string.');
        tokens.push({ type: 'string', value: sql.slice(i, end + tag.length) });
        i = end + tag.length;
        continue;
      }
      // positional parameter like $1
      const param = /^\$\d+/.exec(sql.slice(i));
      if (param) { tokens.push({ type: 'param', value: param[0] }); i += param[0].length; continue; }
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j += 1;
      }
      if (j >= n) throw new Error('Unterminated quoted identifier.');
      tokens.push({ type: 'quoted', value: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const word = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*/.exec(sql.slice(i));
    if (word) {
      tokens.push({ type: 'word', value: word[0], lower: word[0].toLowerCase() });
      i += word[0].length;
      continue;
    }
    const number = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(sql.slice(i));
    if (number) { tokens.push({ type: 'number', value: number[0] }); i += number[0].length; continue; }
    if (ch === ':' && next === ':') { tokens.push({ type: 'punct', value: '::' }); i += 2; continue; }
    tokens.push({ type: 'punct', value: ch });
    i += 1;
  }
  return tokens;
}

function describeRefusal(reason) {
  return { ok: false, reason };
}

/**
 * Validates an inspection statement and returns the statement to send.
 * Comments are stripped so a trailing `-- note` cannot swallow the wrapper.
 */
export function validateInspectionSql(input, { limit = DEFAULT_ROWS } = {}) {
  const sql = String(input ?? '').trim();
  if (!sql) return describeRefusal('Empty statement.');

  let tokens;
  try {
    tokens = tokenize(sql);
  } catch (error) {
    return describeRefusal(error instanceof Error ? error.message : String(error));
  }

  const code = tokens.filter((token) => token.type !== 'comment');
  // A single trailing semicolon is tolerated; anything after it is a second statement.
  while (code.length > 0 && code[code.length - 1].type === 'punct' && code[code.length - 1].value === ';') code.pop();
  if (code.length === 0) return describeRefusal('Empty statement.');
  if (code.some((token) => token.type === 'punct' && token.value === ';')) {
    return describeRefusal('Exactly one statement is allowed.');
  }

  const first = code[0];
  if (first.type !== 'word' || !FIRST_KEYWORDS.has(first.lower)) {
    return describeRefusal('Only SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW statements are allowed.');
  }
  if (first.lower === 'explain') {
    // EXPLAIN ANALYZE executes the statement; plain EXPLAIN only plans it.
    const second = code[1];
    if (second?.type === 'word' && second.lower === 'analyze') return describeRefusal('EXPLAIN ANALYZE executes the statement; use plain EXPLAIN.');
    if (second?.type === 'punct' && second.value === '(') {
      const closing = code.findIndex((token, index) => index > 1 && token.type === 'punct' && token.value === ')');
      const options = code.slice(2, closing === -1 ? undefined : closing);
      if (options.some((token) => token.type === 'word' && (token.lower === 'analyze' || token.lower === 'analyse'))) {
        return describeRefusal('EXPLAIN ANALYZE executes the statement; use plain EXPLAIN.');
      }
    }
  }

  for (let index = 0; index < code.length; index += 1) {
    const token = code[index];
    if (token.type !== 'word') continue;
    const previous = code[index - 1];
    const following = code[index + 1];
    const isCall = following?.type === 'punct' && following.value === '(' && !NON_CALL_KEYWORDS.has(token.lower);
    const qualified = previous?.type === 'punct' && previous.value === '.';

    if (!qualified && FORBIDDEN_KEYWORDS.has(token.lower) && !(token.lower === 'for' && isForClauseSafe(code, index))) {
      if (token.lower === 'for') return describeRefusal('FOR UPDATE / FOR SHARE locks rows; use a plain SELECT.');
      return describeRefusal(`Keyword ${token.value.toUpperCase()} is not allowed in an inspection statement.`);
    }
    if (!qualified && token.lower === 'into' && first.lower !== 'explain') {
      return describeRefusal('SELECT ... INTO creates a table.');
    }
    if (isCall) {
      const schemaQualified = qualified
        && code[index - 2]?.type === 'word'
        && code[index - 2].lower === 'pg_catalog';
      if (qualified && !schemaQualified) {
        return describeRefusal(`Function ${code[index - 2]?.value ?? ''}.${token.value}(...) is not allowed. ${EFFECTIVELY_FORBIDDEN_FUNCTION_NOTE}`);
      }
      if (!ALLOWED_FUNCTIONS.has(token.lower)) {
        return describeRefusal(`Function ${token.value}(...) is not allowed. ${EFFECTIVELY_FORBIDDEN_FUNCTION_NOTE}`);
      }
    }
    if (token.type === 'quoted' && following?.type === 'punct' && following.value === '(') {
      return describeRefusal('Quoted function names are not allowed.');
    }
  }
  if (code.some((token, index) => token.type === 'quoted' && code[index + 1]?.type === 'punct' && code[index + 1].value === '(')) {
    return describeRefusal('Quoted function names are not allowed.');
  }

  const bareSql = code.map((token) => token.value).join(' ');
  const rows = Math.min(Math.max(Number(limit) || DEFAULT_ROWS, 1), MAX_ROWS);
  const wrapped = first.lower === 'explain' || first.lower === 'show'
    ? bareSql
    : `select * from (\n${bareSql}\n) as readonly_inspection limit ${rows + 1}`;
  return { ok: true, statement: wrapped, rows };
}

// `FOR` is only acceptable inside array/subquery-free contexts PostgreSQL
// reads as locking clauses never; we allow it when it is not followed by a
// locking strength keyword (e.g. part of an identifier-less construct such as
// EXTRACT or a quoted alias is already handled by tokenization).
function isForClauseSafe(code, index) {
  const following = code[index + 1];
  if (following?.type !== 'word') return true;
  return !['update', 'share', 'no', 'key'].includes(following.lower);
}

/** Trims a cell for display and reports whether it was cut. */
export function clipCell(value, max = MAX_CELL_CHARS) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more chars]` : text;
}
