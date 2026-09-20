# RBAC & Governance · V2.2

Evolve Studio serves multiple departments; client-side disabled buttons are not security boundaries.

## Recommended roles

| Role | Capability |
|---|---|
| Viewer | View projects, Rubric, Eval, outputs and experience |
| Operator | Run Baseline / Diagnosis / Experiment / Acceptance |
| Project Owner | Edit Evolve Contract and Project Rubric, select Candidate |
| Department Approver | Approve business/release gates |
| Release Manager | Shadow / Canary / Promote / Rollback |
| Studio Admin | Provider/model/Target/workspace policy |

## High-risk server-authorized actions

- change Protected Items;
- weaken/remove Hard Rubric Criteria;
- change Hidden Holdout after Candidate generation;
- Code/Model mutation;
- Artifact Ready override;
- Release Ready / Promote / Rollback;
- Evaluator route or safety policy change;
- register an organization-wide Verified Skill.

## Gate governance

At minimum, persist decisions/evidence for:

- Target Ready: goal + Rubric structure confirmed;
- Problem Worthy / Root Cause Ready;
- Experiment Ready;
- Offline Winner / Hidden Holdout;
- Artifact Ready: Project Rubric + integrity + protected constraints;
- Online Stable / Release decisions;
- Experience Ready.

## Audit event

Record actor, workspace, project, source/rubric version, run/candidate/artifact snapshot ID, action, before/after version, evidence snapshot, timestamp and reason.
