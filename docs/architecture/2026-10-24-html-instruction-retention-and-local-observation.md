# Original instruction retention and local HTML observation

Owner: Evolution OS maintainers. Date: 2026-10-24. This follows existing package boundaries; it adds no platform or architecture exception.

## Measured problem

Local offline browser execution confirmed that the frozen SOP has nine new-content search failures. The canonical index preview passes all 41 interaction assertions and both viewport style comparisons. The native evidence inspector nevertheless initially reported incomplete protection: the exact-digest algorithm classified an expanded numbered workflow example as lost. Its original text is an exact prefix of the expanded example. The nested `pre` and `code` nodes account for two changed digests, not two removed examples.

## Decision

Core distinguishes exact block identity from original text retention. Exact original blocks still match in order. An untyped, sequential numbered prose list may additionally match at the same named anchor when the complete original text, including internal whitespace, is an unchanged prefix followed by a newline and prose. This narrow extension does not apply to declared programming languages, ordinary command examples, rewrites, deleted steps, changed original whitespace or reordered blocks. Scripts, styles and supported renderer signatures remain separately checked.

The adapter reports the policy, original count, retained count, exact count and extended instruction count. An optional additive contract field carries these facts; Core rejects contradictory counts and retention flags. Existing observations remain unchanged unless explicitly reanalyzed with their prior observation hashes retained. A retained example does not establish that appended instructions are correct, safe, understandable or better; independent semantic review remains mandatory.

For the measured SOP, 55 of 57 nodes remain exactly identical. Two nested nodes preserve all original text and append explanatory prose. No user file was modified by the retention analysis.

## Execution provenance and limits

Only temporary local verification containers were used. No permanent Docker service is added to the product, and no Docker dependency enters Core or Harness. The existing Docker Desktop Linux engine was addressed through its local named pipe. The official Playwright image was pinned to digest `eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27` and matched installed Playwright 1.63.0. See the [official Docker guidance](https://playwright.dev/docs/docker).

The observed containers ran as UID 1000, with network disabled, a read-only root and individual read-only inputs, no host secrets or Docker socket, all container capabilities dropped, no new privileges, private IPC, CPU/memory/process limits and temporary writable working space. Chromium's own namespace and Seccomp-BPF sandboxes were enabled and reported adequate sandboxing. The default-deny official syscall profile needed an explicit `chroot` allowance to let Chromium finish restricting its own filesystem while retaining an empty container capability set. A public blank page was tested before user HTML was mounted.

The first paired observation hit the one-GiB memory limit. Its failure record is preserved and excluded from complete evidence. The successful rerun starts a separate browser for each subject, keeping the same full checks, memory limit and isolation. Only containers carrying the validation's unique owner label were removed. No source HTML was transmitted to a cloud sandbox.

These remain supplemental local observations. The preview is not registered as a Candidate, no formal verdict is overwritten, and no final paper, repair budget, delivery or deployment is changed. Uploading rendered body evidence to Supabase was rejected by automatic approval because the current body-transfer consent covered the configured AI service; the requested additional consent is pending. The reports remain local.

Validation: 57 focused tests, all 11 Runner regression tests, architecture checks, changed-file lint and the production TypeScript/Vite build passed. The frozen file has complete native observations with nine genuine search failures; the compiled preview has complete passing native observations. Neither result by itself establishes semantic acceptance, business benefit or causal lesson transfer.
