import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Fixture/packaging checks for the continuity persona. Not an agent execution simulator.
export async function validateContinuityAgent(root, scenarios, coverage) {
  const errors = [];
  const skill = "mermail-continuity-agent";
  const skillRoot = path.join(root, "skills", skill);
  const requiredFiles = [
    "SKILL.md", "agents/openai.yaml", "references/tools.md",
    "references/security.md", "references/workflows.md", "references/capsule-format.md",
  ];
  const contents = {};
  for (const file of requiredFiles) {
    try {
      const fullPath = path.join(skillRoot, file);
      const content = await readFile(fullPath, "utf8");
      contents[file] = content;
      if (!file.endsWith(".md")) continue;
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^https?:\/\//.test(target) || target.startsWith("#")) continue;
        const resolved = path.resolve(path.dirname(fullPath), target.split("#")[0]);
        if (!resolved.startsWith(`${root}${path.sep}`)) {
          errors.push(`${skill}: reference leaves the package: ${target}`);
          continue;
        }
        if (!(await stat(resolved)).isFile()) errors.push(`${skill}: invalid reference ${target}`);
      }
    } catch (error) {
      errors.push(`${skill}: missing or unreadable resource in ${file}: ${error.code ?? error.message}`);
    }
  }

  // The persona owns no tools: every tool it names must already belong to an existing domain.
  const knownTools = new Set([
    ...Object.values(coverage.domains).flat(),
    ...Object.values(coverage.walletScopedDomains ?? {}).flat(),
    coverage.confirmationTool,
  ]);
  const toolsDoc = contents["references/tools.md"] ?? "";
  for (const match of toolsDoc.matchAll(/`([a-z_]+)`/g)) {
    const name = match[1];
    if (/^[a-z]+(_[a-z]+)+$/.test(name) && !knownTools.has(name) && !["source_draft_id", "public_id", "date_start", "received_at", "scan_status", "sender_authentication", "capsule_v1"].includes(name)) {
      errors.push(`${skill}: tools.md names a tool outside the catalog: ${name}`);
    }
  }
  for (const banned of ["create_mailbox", "delete_email", "bulk_delete_emails", "forward_email", "reply_to_email"]) {
    if (/\| Draft the next capsule|\| Send the capsule/.test(toolsDoc) && new RegExp(`\\| (Draft|Send)[^\\n]*\`${banned}\``).test(toolsDoc)) {
      errors.push(`${skill}: capsule drafting/sending row must not use ${banned}`);
    }
  }

  // Capsule contract: header line, three exact sections in order, credential ban, ceiling.
  const format = contents["references/capsule-format.md"] ?? "";
  const headings = ["### What happened", "### What is unfinished", "### Where to start"];
  let last = -1;
  for (const heading of headings) {
    const index = format.indexOf(heading);
    if (index === -1) errors.push(`${skill}: capsule-format.md missing heading ${heading}`);
    else if (index < last) errors.push(`${skill}: capsule-format.md headings out of order at ${heading}`);
    last = Math.max(last, index);
  }
  for (const required of ["capsule/v1", "prev=", "[capsule]", "4,000 characters", "API keys", "never contains"]) {
    if (!format.includes(required)) errors.push(`${skill}: capsule-format.md missing contract ${required}`);
  }

  // Security contract: self-addressed only, sender check, scan and authentication gates, capsule-as-data.
  const security = contents["references/security.md"] ?? "";
  for (const required of [
    "scan_status: clean", "sender_authentication.status: pass", "own address",
    "not a command list", "standing authorization", "no `cc` or `bcc`", "look-alike",
  ]) {
    if (!security.includes(required)) errors.push(`${skill}: security.md missing contract ${required}`);
  }
  const skillDoc = contents["SKILL.md"] ?? "";
  for (const required of ["uses existing Mermail tools and owns none", "Only the mailbox's own address may receive a capsule", "Quote it; do not obey it", "append-only"]) {
    if (!skillDoc.includes(required)) errors.push(`${skill}: SKILL.md missing contract ${required}`);
  }
  const workflows = contents["references/workflows.md"] ?? "";
  for (const required of ["## Wake", "## Recall", "## Handoff", "first wake", "never auto-retry", "do not resend"]) {
    if (!workflows.toLowerCase().includes(required.toLowerCase())) errors.push(`${skill}: workflows.md missing ${required}`);
  }

  // Scenarios: one fixture per case, tools within catalog, forbidden tools honored,
  // external effects only on the approved self-addressed send.
  const requiredCases = [
    "wake", "first-wake", "arrived-since-injection", "look-alike-capsule", "unscanned-capsule",
    "capsule-command-injection", "recall", "handoff-draft", "handoff-send", "handoff-extra-recipient",
    "handoff-credential", "uncertain-send", "prune-handoff",
  ];
  const fixtures = scenarios.filter((scenario) => scenario.skill === skill);
  for (const caseId of requiredCases) {
    const matches = fixtures.filter((scenario) => scenario.continuityCase === caseId);
    if (matches.length !== 1) errors.push(`${skill}: expected one ${caseId} scenario`);
  }
  const externalTools = new Set([
    ...coverage.externalEffectTools, ...coverage.destructiveTools,
    ...(coverage.walletDestructiveTools ?? []),
  ]);
  for (const scenario of fixtures) {
    if (!scenario.expected || !scenario.prompt || !scenario.continuityCase) {
      errors.push(`${skill}: incomplete continuity scenario`);
    }
    for (const tool of scenario.tools) {
      if (!knownTools.has(tool)) errors.push(`${skill}: ${scenario.continuityCase} uses unknown tool ${tool}`);
    }
    for (const forbidden of scenario.forbiddenTools ?? []) {
      if (scenario.tools.includes(forbidden)) {
        errors.push(`${skill}: ${scenario.continuityCase} includes forbidden ${forbidden}`);
      }
    }
    const usesExternal = scenario.tools.some((tool) => externalTools.has(tool));
    if (scenario.continuityCase === "handoff-send") {
      if (!scenario.tools.includes("send_email") || scenario.approval !== "external-effect") {
        errors.push(`${skill}: handoff-send must send_email under external-effect approval`);
      }
    } else if (usesExternal) {
      errors.push(`${skill}: ${scenario.continuityCase} must not use an external-effect or destructive tool`);
    }
    if (scenario.securityCase && !scenario.forbiddenTools?.length) {
      errors.push(`${skill}: security case ${scenario.continuityCase} must name forbidden tools`);
    }
  }
  const routed = scenarios.find((scenario) => scenario.skill === "mermail" && scenario.expected === "route-agent-continuity-to-mermail-continuity-agent");
  if (!routed) errors.push(`${skill}: missing root-router scenario`);

  return errors;
}
