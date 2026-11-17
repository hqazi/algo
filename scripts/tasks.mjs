#!/usr/bin/env node
// Reads and updates ticket status in docs/TASKS.md. Node 18+, no dependencies.
//
//   node scripts/tasks.mjs list [--milestone v1]     all tickets with status
//   node scripts/tasks.mjs next [--milestone v1]     tickets ready to start (JSON)
//   node scripts/tasks.mjs show T05                  one ticket's full text
//   node scripts/tasks.mjs set T05 in-progress       change a ticket's status
//
// A ticket is a "### TNN — Title" heading followed by "- Key: value" lines
// (Status, Milestone, Size, Depends on, Spec, Owns). A ticket is ready when its
// status is todo and every dependency is done.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "TASKS.md");
const STATUSES = ["todo", "in-progress", "blocked", "done"];
const HEADING = /^### (T\d+) — (.+)$/;
const FIELD = /^- (Status|Milestone|Size|Depends on|Spec|Owns): (.*)$/;

function parse(text) {
  const lines = text.split("\n");
  const tickets = [];
  let cur = null;
  lines.forEach((line, i) => {
    const h = line.match(HEADING);
    if (h) {
      if (cur) cur.end = i;
      cur = { id: h[1], title: h[2].trim(), start: i, end: lines.length, fields: {}, statusLine: -1 };
      tickets.push(cur);
      return;
    }
    if (!cur) return;
    if (/^#{1,3} /.test(line)) { cur.end = i; cur = null; return; }
    const f = line.match(FIELD);
    if (f) {
      cur.fields[f[1]] = f[2].trim();
      if (f[1] === "Status") cur.statusLine = i;
    }
  });
  for (const t of tickets) {
    t.status = t.fields["Status"] ?? "todo";
    t.milestone = t.fields["Milestone"] ?? "";
    t.size = t.fields["Size"] ?? "";
    t.spec = t.fields["Spec"] ?? "";
    t.owns = t.fields["Owns"] ?? "";
    t.deps = (t.fields["Depends on"] ?? "").match(/T\d+/g) ?? [];
  }
  return { lines, tickets };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const [cmd, ...args] = process.argv.slice(2);
const text = readFileSync(FILE, "utf8");
const { lines, tickets } = parse(text);
const byId = new Map(tickets.map((t) => [t.id, t]));
const milestone = option(args, "--milestone");
const inScope = (t) => !milestone || t.milestone === milestone;

for (const t of tickets) {
  if (!STATUSES.includes(t.status)) fail(`${t.id}: unknown status "${t.status}"`);
  for (const d of t.deps) if (!byId.has(d)) fail(`${t.id}: depends on unknown ticket ${d}`);
}

switch (cmd) {
  case "list": {
    for (const t of tickets.filter(inScope)) {
      console.log(`${t.id}  ${t.status.padEnd(11)} ${t.milestone.padEnd(3)} ${t.size.padEnd(3)} ${t.title}`);
    }
    break;
  }
  case "next": {
    const ready = tickets
      .filter(inScope)
      .filter((t) => t.status === "todo" && t.deps.every((d) => byId.get(d).status === "done"));
    const inProgress = tickets.filter(inScope).filter((t) => t.status === "in-progress");
    const pick = (t) => ({ id: t.id, title: t.title, milestone: t.milestone, size: t.size, depends_on: t.deps, spec: t.spec, owns: t.owns });
    const done = tickets.filter((t) => t.status === "done").length;
    console.log(JSON.stringify({
      ready: ready.map(pick),
      in_progress: inProgress.map(pick),
      blocked: tickets.filter(inScope).filter((t) => t.status === "blocked").map(pick),
      progress: `${done}/${tickets.length} done`,
    }, null, 2));
    break;
  }
  case "show": {
    const t = byId.get(args[0]) ?? fail(`unknown ticket ${args[0] ?? "(none given)"}`);
    console.log(lines.slice(t.start, t.end).join("\n").replace(/(\n|---)+$/, ""));
    break;
  }
  case "set": {
    const [id, status] = args;
    const t = byId.get(id) ?? fail(`unknown ticket ${id ?? "(none given)"}`);
    if (!STATUSES.includes(status)) fail(`status must be one of: ${STATUSES.join(", ")}`);
    if (t.statusLine < 0) fail(`${id} has no "- Status:" line`);
    if (status === "in-progress") {
      const open = t.deps.filter((d) => byId.get(d).status !== "done");
      if (open.length) fail(`${id} depends on unfinished tickets: ${open.join(", ")}`);
    }
    lines[t.statusLine] = `- Status: ${status}`;
    writeFileSync(FILE, lines.join("\n"));
    console.log(`${id}: ${t.status} -> ${status}`);
    break;
  }
  default:
    fail("usage: node scripts/tasks.mjs list|next|show TNN|set TNN STATUS [--milestone v1]");
}
