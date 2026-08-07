"""AST-only graphify build for zk-hub. Zero API cost.
Runs detection + code AST extraction + clustering + report.
Docs/rationale layer (semantic) is skipped; add later with `/graphify . --update`.
"""

import json
from pathlib import Path

from graphify.detect import detect
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.export import to_json
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate

root = Path(".")
out = root / "graphify-out"
out.mkdir(exist_ok=True)

print("[1/6] Detecting files...")
detection = detect(root)
total_files = detection.get("total_files", 0)
total_words = detection.get("total_words", 0)
code_files_spec = detection.get("files", {}).get("code", [])
doc_files_spec = detection.get("files", {}).get("docs", [])
print(f"  {total_files} files, ~{total_words} words")
print(f"  code: {len(code_files_spec)} entries")
print(f"  docs: {len(doc_files_spec)} entries (SKIPPED in AST-only build)")
(out / ".graphify_detect.json").write_text(json.dumps(detection, indent=2))

print("[2/6] Collecting code files...")
code_files = []
for f in code_files_spec:
    p = Path(f)
    code_files.extend(collect_files(p) if p.is_dir() else [p])
print(f"  {len(code_files)} code files to extract")

print("[3/6] Running tree-sitter AST extraction (deterministic, free)...")
if code_files:
    extraction = extract(code_files)
else:
    extraction = {"nodes": [], "edges": [], "input_tokens": 0, "output_tokens": 0}
print(f"  AST: {len(extraction['nodes'])} nodes, {len(extraction['edges'])} edges")
(out / ".graphify_extract.json").write_text(json.dumps(extraction, indent=2))

print("[4/6] Building graph + clustering (Leiden)...")
G = build_from_json(extraction)
if G.number_of_nodes() == 0:
    print("ERROR: Graph is empty. Extraction produced no nodes.")
    raise SystemExit(1)

communities = cluster(G)
cohesion = score_all(G, communities)
print(f"  {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities")

print("[5/6] Analyzing god nodes + surprising connections...")
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
community_labels = {cid: f"Community {cid}" for cid in communities}
questions = suggest_questions(G, communities, community_labels)

print("[6/6] Writing graph.json + GRAPH_REPORT.md...")
tokens = {"input": extraction.get("input_tokens", 0), "output": extraction.get("output_tokens", 0)}
report = generate(
    G, communities, cohesion, community_labels, gods, surprises,
    detection, tokens, str(root),
    suggested_questions=questions,
)
(out / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
to_json(G, communities, str(out / "graph.json"))

# Persist analysis for --update / cluster-only
(out / ".graphify_analysis.json").write_text(json.dumps({
    "communities": {str(k): v for k, v in communities.items()},
    "cohesion": {str(k): v for k, v in cohesion.items()},
    "gods": gods,
    "surprises": surprises,
    "questions": questions,
}, indent=2))

print()
print("Done.")
print(f"  graph.json        {out / 'graph.json'}")
print(f"  GRAPH_REPORT.md   {out / 'GRAPH_REPORT.md'}")
print(f"  Cost: 0 USD (AST-only, no API calls)")
print()
print("To add the semantic layer (docstring rationale, doc concepts, cross-doc")
print("edges), run inside Claude Code:  /graphify . --update")
