# Local control intent outside the observed backend

D1's localhost guard shares the observed backend's failure domain. The existing native process observer now optionally binds Mission, Job, Run, source commit, entrypoint hash and absolute deadline before launching its owned process. The local adapter validates this operational boundary with Zod and exclusively creates each binding and cancellation intent. A timeout terminates the owned process at the original deadline, then records intent; nonzero and supervision failures also record intent. The prewritten binding keeps cancellation required after deadline even if supervision is lost before that write. The first intent is never overwritten.

The I/O adapter remains in tools/local-runner with the platform-specific observer. It performs local operational validation, not Domain promotion logic, and adds no control platform. Core/Harness gain no dependency on PowerShell or filesystem.

An intent is not a cancellation receipt. Inspection after deadline returns cancellation-unconfirmed even if the controller died before writing an intent. It never reports running from an old checkpoint, releases a scoring claim, repeats a generation, restarts a Job or claims an unreachable backend cancelled it. The governed owner must reconcile the exact identity against authoritative state under existing permissions.

Tests use trusted local substitutes for nonzero exit and absolute timeout, plus immutable/rebound intent and lost-controller cases. This is offline failure-boundary evidence, not application-load lifetime evidence, a C44 exit-cause diagnosis, or authorization for a new Mission. Application and cross-order calibration gates remain required.
