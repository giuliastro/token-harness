# Progressive guided loading

The guided browser UI already performs the expensive overview reads in parallel. During an overview read, it now uses the existing read-only `/api/activity` status to surface partial progress more quickly instead of making the user wait on an undifferentiated spinner.

This layer does not trigger another overview read, does not mutate configuration, and stops doing extra work when the overview spinner is no longer active.
