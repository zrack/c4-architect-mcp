---
name: what-changed-in-this-pr
description: Explain the TypeScript or TSX dependency changes in a pull request. Use for PR architecture review when someone wants a focused diagram of added, removed, or changed imports with links to the exact source lines.
---

# What changed in this PR?

Resolve the PR URL or number against its repository. Read its actual base and head commit SHAs and repository names from GitHub, including for merged PRs. With GitHub CLI, `gh api repos/OWNER/REPO/pulls/NUMBER` returns these under `base` and `head`. The base repository hosts `refs/pull/NUMBER/head` for forks. If the revisions are missing locally, fetch them into a disposable clone and verify both full SHAs. A moved branch or merge commit can describe a different change.

For “what did this PR introduce?”, compare the common ancestor of the recorded base and head to the head. Get it with `git merge-base BASE HEAD` in a checkout with the history. If it differs from the target tip, name both baselines in the answer. Use a literal two-revision comparison when the user asks for one.

Choose a common source root that includes both ends of the imports. Use the requested scope, the relevant project's `src`, or `.` for a workspace spanning packages. Run this skill's bundled helper with Node 22 or 24 and the Git repository holding both commits:

```sh
node /path/to/what-changed-in-this-pr/scripts/review-commits.mjs \
  --repo-dir /path/to/checkout --github-repo OWNER/REPO \
  --base FULL_BASE_SHA --head FULL_HEAD_SHA --source-root src \
  --out /path/to/output/PR-16.md --title "PR #16"
```

Substitute the actual PR number. Use the requested report path or a fresh output directory. For a fork add `--head-github-repo HEAD_OWNER/HEAD_REPO`. The helper uses the built C4 CLI beside the real skill directory, extracts detached snapshots in temporary storage, and retains the two evidence graphs beside the report. A copied skill can use `--cli /absolute/path/to/trusted/dist/index.js`. Use a trusted installation of this feature outside both PR snapshots.

If the project declares C4 boundaries, supply the repository-relative `--config` path. If the snapshots need installed packages for resolution, the helper accepts `--base-node-modules` and `--head-node-modules` pointing to dependency trees staged from the respective lockfiles. Use existing verified trees or the project's isolated, script-free staging procedure. Otherwise scan the source as it stands and disclose unresolved imports that affect the result.

Read the report and show the generated PNG in the answer. Follow its numbered arrow IDs to the import statements. Cite head lines for additions, base lines for removals, and both versions for edits. Distinguish type-only imports where material. Link the interactive diagram for click-through evidence and the report for the full comparison. If the diagram is capped, give the totals and the number shown. If the comparison finds no dependency changes, say so and summarize any file or declared boundary changes separately.
