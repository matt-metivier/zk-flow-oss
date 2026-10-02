// src/fragments/args.js
// Task 0 finding: saved workflow commands pass free TEXT as `args`, not an object.
// parseArgs turns "depth=full mode=interview" -> {depth:'full',mode:'interview'};
// bare tokens collect under `_`. readArgs normalizes object|string|undefined -> object.
// EVERY key a workflow reads off `a` must be listed here. A missing key is not a
// parse error — the token falls into `_` and the workflow silently runs with the
// default. That bit /vault-sync on its first live run: `dryRun=true` was not a
// control key, so it parsed as a positional and the run WROTE to the vault.
const CONTROL_KEYS = ['depth','mode','maxIterations','startAt','targetEnv','window','autoApprove','perspectives','bead','brief','skipReview','skipSimplify','profile','pr','model','models','ideate','frames','topK','api','id','deleteSibling','svc','service','time','posture','postures','pauseBefore','verifyVotes','maxClaims','refuteThreshold',
  // vault-sync
  'repo','repos','since','dryRun','apply','maxNotes','maxRepos','dir','root'];
export function parseArgs(str) {
  if (!str || typeof str !== 'string') return {};
  // Detect JSON-stringified object (e.g. from saved workflow commands passing args as JSON)
  const trimmed = str.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) { /* fall through to space-separated parsing */ }
  }
  const out = {};
  const positional = [];
  for (const raw of str.trim().match(/[^\s=]+="[^"]*"|[^\s=]+='[^']*'|\S+/g) || []) {
    const tok = raw.replace(/^([^\s=]+=)(["'])(.*)\2$/s, '$1$3');
    const eq = tok.indexOf('=');
    if (eq > 0 && CONTROL_KEYS.includes(tok.slice(0, eq))) {
      out[tok.slice(0, eq)] = tok.slice(eq + 1);
    } else {
      positional.push(tok);
    }
  }
  if (positional.length) out._ = positional;
  return out;
}
export function readArgs(args) {
  if (typeof args === 'string') return parseArgs(args);
  return args || {};
}

export function discoverCatalogLimits(args = {}) {
  const raw = args && typeof args === 'object' ? args.topK : args;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  const topK = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10) : 5;
  const slack = 2;
  return { topK, slack, candidateLimit: Math.min(topK + slack, 12) };
}

export function buildDiscoverCatalogCommand({ request = '', research = null, topK = undefined } = {}) {
  const limits = discoverCatalogLimits({ topK });
  const query = [request, research ? JSON.stringify(research) : ''].filter(Boolean).join('\n');
  const queryLiteral = JSON.stringify(query);
  // Host-scoped catalog: CATALOG.md is shared across machines, so it carries
  // agent/machines/<other-host>/* ids whose dirs only resolve on the owning box.
  // catalog-for-host.sh strips those; without it discover can select a skill that
  // renders empty here. Falls back to the raw catalog if the script is absent.
  return `ZKCAT="$(bash "\${ZK_FLOW_DIR:-$HOME/dev/zk-flow}/scripts/catalog-for-host.sh" 2>/dev/null)"; ZK_CATALOG_TEXT="$ZKCAT" python3 - <<'PY'
os = __import__('os')
re = __import__('re')
sys = __import__('sys')
CATALOG = os.path.expandvars('$ZK_ARTIFACTS_DIR/skills/CATALOG.md')
SCOPED = os.environ.get('ZK_CATALOG_TEXT') or ''
QUERY = ${queryLiteral}
TOP_K = ${limits.topK}
LIMIT = ${limits.candidateLimit}
STOP = set('a an and are as at be by for from has have in into is it of on or that the this to with you your'.split())

def read_catalog():
    if SCOPED.strip():
        return SCOPED
    with open(CATALOG, encoding='utf-8') as f:
        return f.read()

def emit_full(reason):
    print('PREFILTER_FALLBACK_FULL_CATALOG reason=' + reason)
    print(read_catalog(), end='')

try:
    catalog = read_catalog()
    entries = []
    for line in catalog.splitlines():
        match = re.search(r'\`([^\`]+)\`', line)
        if match:
            entries.append((match.group(1).lower(), line))
    if not entries:
        emit_full('parse_empty')
        raise SystemExit(0)
    tokens = [t for t in re.findall(r'[a-z0-9][a-z0-9_-]{2,}', QUERY.lower()) if t not in STOP]
    if not tokens:
        emit_full('no_query_tokens')
        raise SystemExit(0)
    scored = []
    for skill_id, line in entries:
        haystack = (skill_id + ' ' + line.lower()).replace('/', ' ').replace('-', ' ')
        score = sum(3 if token in skill_id else 1 for token in tokens if token in haystack)
        if score:
            scored.append((score, skill_id, line))
    if not scored:
        emit_full('no_matches')
        raise SystemExit(0)
    scored.sort(key=lambda item: (-item[0], item[1]))
    print('CATALOG_PREFILTER_CANDIDATES topK=${limits.topK} limit=${limits.candidateLimit}')
    print('Filtered from skills/CATALOG.md using request + research; fall back to the full catalog if coverage is missing.')
    for _, _, line in scored[:LIMIT]:
        print(line)
except SystemExit:
    raise
except Exception as exc:
    emit_full(type(exc).__name__)
PY`;
}
