// Freeze the clock of a disposable program-round preview process at its review date.
// The PHP/NumFOCUS packets were reviewed on 2026-10-13 against a PHP call that closed on
// 2026-10-20. The committer, the staged validator and the site all read the clock, so a
// later replay would reject the call as stale or list no opportunity for it. Load this
// only in the preview fixture and its preview server, never in the app.
import { mock } from 'node:test';

mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T20:00:00Z') });
