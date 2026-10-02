#!/usr/bin/env python3
"""Derive collision-free flat skill names from a zk-artifacts skills/CATALOG.md.

Claude Code discovers skills one level deep (~/.claude/skills/<name>/SKILL.md),
so nested catalog ids (agent/machines/n/nebo/jira) need a flat, stable name.

Name = leaf when that leaf is unique in the catalog, else parent-leaf, else the
whole id with '/' -> '-'. Deterministic for a given catalog, so installed links
stay put across re-runs.

Usage: skill-flat-names.py CATALOG [scope=host|all] [host-alias]
Prints one "<flat-name>\t<catalog-id>" line per selected skill.
"""
import re
import sys


def slug(text):
    return re.sub(r"[^a-z0-9-]+", "-", text.lower()).strip("-")


def read_ids(path):
    ids = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            match = re.match(r"^- .([^`]+).", line)
            if match:
                ids.append(match.group(1))
    return ids


def select(ids, scope, alias):
    if scope == "all":
        return list(ids)
    kept = []
    for skill_id in ids:
        parts = skill_id.split("/")
        # agent/machines/<alias>/... — keep only this host's; always skip archive/
        if len(parts) > 2 and parts[0] == "agent" and parts[1] == "machines":
            if parts[2] == "archive" or (alias and parts[2] != alias):
                continue
        kept.append(skill_id)
    return kept


def flat_names(ids):
    leaf_count = {}
    for skill_id in ids:
        leaf = slug(skill_id.split("/")[-1])
        leaf_count[leaf] = leaf_count.get(leaf, 0) + 1

    taken, pairs = set(), []
    for skill_id in ids:
        parts = skill_id.split("/")
        leaf = slug(parts[-1])
        name = leaf if leaf_count[leaf] == 1 else slug("-".join(parts[-2:]))
        if name in taken:
            name = slug("-".join(parts))
        while name in taken:
            name += "-x"
        taken.add(name)
        pairs.append((name, skill_id))
    return pairs


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    catalog = argv[1]
    scope = argv[2] if len(argv) > 2 else "host"
    alias = argv[3] if len(argv) > 3 else ""
    ids = select(read_ids(catalog), scope, alias)
    for name, skill_id in flat_names(ids):
        print(name + "\t" + skill_id)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
