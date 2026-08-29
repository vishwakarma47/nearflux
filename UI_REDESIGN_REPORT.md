# NearFlux UI Redesign Report

## Scope

NearFlux was rebuilt as a modern desktop workspace for a privacy-first direct-file-transfer utility. The second-pass design follows the attached modern reference and the persisted UI/UX Pro Max system in `design-system/nearflux/MASTER.md`.

The redesign remains presentation-only. The established room system, Socket.IO signaling, strict STUN-only WebRTC path, direct-path verification, DataChannel transfer, checksums, adaptive queue control, folder selection, device naming, QR sharing, and transfer state machine remain intact.

## Workspace composition

The new desktop composition uses a 1440px maximum workspace with a top header, a persistent left navigation rail, a two-column hero area, and a lower three-surface activity area. The left rail provides Home, Transfers, Devices, Rooms, and Settings anchors, plus a persistent Direct P2P privacy note. The hero area pairs the direct-transfer dropzone with a persistent room-invite panel containing the room code, QR code, share link, copy action, and join affordance. The lower area keeps connected devices, selected files, and active transfer activity visible together, matching the supplied modern reference rather than hiding these surfaces behind a single vertical flow.

On narrower screens, the rail collapses into a compact horizontal navigation, the hero becomes stacked, and device/file/activity panels reflow to one or two columns. Primary actions remain full-width where needed, and modal content is constrained to the viewport.

## Visual direction

The interface uses Inter typography, a warm neutral light theme, intentional deep navy dark surfaces, restrained blue accents, semantic success/danger states, flat-design surfaces, consistent radius tokens, light elevation, 150–250ms motion, and reduced-motion support. The main transfer area is the visual centerpiece with a direct device-to-device motif, drag-state feedback, explicit file/folder alternatives, and a factual direct-P2P trust indicator.

Connected devices are selectable semantic buttons with platform metadata, online state, and visible selection. The selected-files surface is a transfer queue with readable paths, sizes, MIME metadata, and a stronger send CTA. The active-transfer panel exposes current progress, speed, ETA, completion state, and the existing transfer-state information without inventing a second transfer engine.

## Component updates

The app shell now composes `Sidebar`, `RoomInvitePanel`, and `TransferWorkspacePanel` around the existing UI components. Header controls have clearer hierarchy and accessible labels. Dropzone, device cards, device list, selected file list, room sharing, onboarding, device rename, incoming request, transfer progress, and theme toggle components were refreshed without changing their existing behavior.

The Vite server configuration allows the sandbox preview proxy suffix so the app can be viewed through a public temporary URL. The interactive client preview is configured to use the exposed signaling server URL during local testing.

## Accessibility and verification

The redesign adds semantic buttons instead of clickable device containers, `aria-pressed` selection state, dialog roles, live status and alert regions, progressbar semantics, explicit icon labels, visible focus rings, keyboard alternatives to drag-and-drop, `touch-action: manipulation`, responsive device grids, full-width mobile controls, modal viewport constraints, and `prefers-reduced-motion` handling.

The server and client production builds passed. The local and exposed preview rendered successfully. Onboarding completed in the exposed preview; the room-share card opened its refreshed modal with QR, copy-link, close-room, new-code, and join-by-code controls. Room and SDP signaling regression tests passed. The desktop preview had no horizontal overflow, and browser console verification showed no runtime errors beyond the standard React DevTools informational message.


## Latest stabilization pass — guest workspace and visual polish

The workspace now uses real view state rather than anchor-only navigation. The icon rail switches between Home, Transfers, Devices, Rooms, and Settings while preserving the shared room and transfer context. Transfers has a dedicated activity view combining local history with the live active-transfer panel; Devices and Rooms each have focused views; Settings explains guest mode and presents an explicitly non-required future account affordance.

Guest history is metadata-only and browser-local. Terminal transfers can be recorded with direction, filename, file count, total size, peer device, status, and timestamp in `NearFlux_transfer_history`; no `File` objects or file contents are persisted. The history is bounded and can be cleared from the Transfers view. This is intentionally not cross-device account synchronization.

The final CSS pass adds minimum-width containment throughout grid and flex children, ellipsis for device/file labels, safe wrapping for technical copy, equal-height panel alignment, translucent blurred surfaces with light-theme overrides, and mobile layouts that collapse to one column. Theme changes now use a short transition class with reduced-motion support instead of an abrupt visual swap. The guest badge in the header makes the current persistence model visible.

The public preview was checked for Home, Transfers, Devices, Rooms, Settings, light mode, reload persistence, and horizontal overflow. The current exposed preview remains: https://5173-ihg4dm5wydwcalhecn8rg-0c8f19a4.us4.manus.computer/?room=FLUX-9TPR
