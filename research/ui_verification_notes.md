# NearFlux UI verification notes

## Checkpoint 1 — 2026-08-28

The exposed preview loaded successfully at the inherited public URL with room `FLUX-9TPR`. The desktop workspace rendered without visible horizontal clipping: header, 64px rail, hero/dropzone, room panel, device panel, and activity panel shared aligned edges. The guest badge, room pill, and device pill remained compact.

Clicking the Transfers rail control changed the rendered main view to a dedicated Transfer history screen with a local activity empty state and a live Active transfer panel; it did not move the page to an anchor. The DOM-visible navigation controls were buttons with labels Home, Transfers, Devices, Rooms, and Settings.

The Devices rail control rendered a dedicated Connected devices view with the room-filtered device card and intact Select all / Share room actions. The Rooms rail control rendered a dedicated Room access view with the QR/link invite panel plus a share guidance card. Both views preserved the aligned sidebar and main content edges.

The Settings view showed a guest profile card, a disabled “Add an account · Coming soon” affordance, and a browser-storage explanation for transfer history. Toggling the header theme control switched to light mode with readable dark text, pale translucent cards, and the same aligned layout; the control label changed to “Switch to dark mode.”

A metadata-only synthetic history row was written to `NearFlux_transfer_history` in the preview browser and the page reloaded successfully. No File object or file contents were persisted; this was only to validate the guest-history presentation path.

After reload, the Home view remained usable and the Transfers view rendered the seeded `presentation.pdf` row with direction, peer, size, timestamp, and Completed status. This confirms the guest history survives a page reload through local browser storage.

The live DOM metric reported `scrollWidth: 1280`, `innerWidth: 1280`, and `hasHorizontalOverflow: false` on the current preview. Console review contained one initial malformed test expression from the verification script, followed by the successful seed/reload and metrics calls; no application exception was reported.

Build and regression checkpoint: `npm run build:server` and `npm run build:client` passed. After starting the local signaling server, `room-integration-test.mjs` passed with same-room presence and different-room isolation; `answer-route-debug.mjs` passed with the SDP answer routed to the original offer sender. The source scan for `turn:`, `turns:`, `file-chunk`, and `sendFileChunk` returned no matches in active client/server source.

Final lifecycle fix checkpoint: history persistence was moved to a terminal-state effect with a fingerprint ref, so completed/failed/cancelled transfers are recorded as soon as they reach a terminal state and are not duplicated by React StrictMode or modal dismissal. Production builds passed again, and both signaling regressions plus the forbidden-path scan passed again.

## Theme and tooltip polish checkpoint — 2026-08-28

The refreshed preview loaded successfully. A precise hover over the measured Transfers rail button displayed the custom `Transfers` tooltip in a visible layer above the hero content; the tooltip no longer disappears behind the main workspace surface. The tooltip text is also marked decorative because the button itself has the accessible label.

The theme control switched the preview back to dark mode successfully. On the dedicated Transfers view, hovering the Transfers rail button now shows a solid `Transfers` tooltip above the transfer-history card rather than behind it.

## Final theme and tooltip checkpoint — 2026-08-28

The live browser measurement captured the new transition while it was active: `theme-transitioning: true`, `animationName: theme-transition-wash`, `animationDuration: 0.44s`, overlay opacity approximately `0.90`, and `backdropFilter: blur(6px) saturate(1.18)`. The theme attribute changed to light during the animation, so the token transition and blur wash run together.

The final server/client production build passed, and the forbidden-path scan remained clean. The only interaction changes in this pass were UI theme and tooltip presentation; signaling and WebRTC code were not changed.
