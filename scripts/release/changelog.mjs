import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { getCurrentReleaseVersion, publishablePackages, repoRoot, resolveRepoPath } from "./shared.mjs";

const args = process.argv.slice(2);
const explicitVersion = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
const version = explicitVersion || await getCurrentReleaseVersion();
const existing = await readFileOrDefault(resolveRepoPath("CHANGELOG.md"), "# Changelog\n");
const since = findFlag(args, "--since") || getLastTag();
const logRange = since ? `${since}..HEAD` : "HEAD";
const commits = getGitLog(logRange).filter(Boolean);
const grouped = groupConventionalCommits(commits);
const today = new Date().toISOString().slice(0, 10);

const sections = [];
sections.push(`## ${version} - ${today}`);

for (const [title, items] of Object.entries(grouped)) {
    if (items.length === 0) {
        continue;
    }
    sections.push(`### ${title}`);
    sections.push(...items.map(item => `- ${item}`));
}

sections.push("### Published Packages");
sections.push(...publishablePackages.map(pkg => `- ${pkg.name} ${version}`));

const nextContent = [
    "# Changelog",
    "",
    ...sections,
    "",
    existing.replace(/^# Changelog\s*/u, "").trim()
].filter(Boolean).join("\n");

await fs.writeFile(resolveRepoPath("CHANGELOG.md"), `${nextContent}\n`, "utf8");
console.log(`Updated CHANGELOG.md for ${version}`);

function findFlag(args, flag) {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
}

function getLastTag() {
    const result = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: process.platform === "win32"
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
}

function getGitLog(range) {
    const result = spawnSync("git", ["log", range, "--pretty=format:%s"], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: process.platform === "win32"
    });
    if (result.status !== 0) {
        return [];
    }
    return result.stdout.split(/\r?\n/).map(line => line.trim());
}

function groupConventionalCommits(commits) {
    const groups = {
        Features: [],
        Fixes: [],
        Docs: [],
        Refactors: [],
        Tests: [],
        Chores: []
    };

    for (const subject of commits) {
        const match = /^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/.exec(subject);
        if (!match) {
            groups.Chores.push(subject);
            continue;
        }
        const type = match[1];
        const message = match[2];
        switch (type) {
            case "feat":
                groups.Features.push(message);
                break;
            case "fix":
                groups.Fixes.push(message);
                break;
            case "docs":
                groups.Docs.push(message);
                break;
            case "refactor":
                groups.Refactors.push(message);
                break;
            case "test":
                groups.Tests.push(message);
                break;
            default:
                groups.Chores.push(message);
        }
    }

    return groups;
}

async function readFileOrDefault(file, fallback) {
    try {
        return await fs.readFile(file, "utf8");
    } catch {
        return fallback;
    }
}
