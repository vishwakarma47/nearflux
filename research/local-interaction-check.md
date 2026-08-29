# Local interaction verification

The `Share Room` control opens a modal containing the active room code, the current share URL, a locally generated QR code, `Close Room`, `Generate New Code`, `Copy Share Link`, and `Join Room` controls. The QR code renders without an external image service.

Clicking `Generate New Code` closed the modal, updated the room code from `FLUX-AYZQ` to a new `FLUX-JBWY` value, and updated the browser URL to `?room=FLUX-JBWY`. The header and room section also updated to the new code. No runtime error appeared during these checks.
