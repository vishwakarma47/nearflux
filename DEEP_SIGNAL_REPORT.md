# NearFlux Deep Signal Redesign

## Final direction

The NearFlux workspace now follows the attached Deep Signal direction: a near-black deep-navy background, dark glass surfaces, electric cyan signal accents, mint online states, Space Grotesk for display and headings, Inter for UI text, and JetBrains Mono for room identifiers. The visual language is intentionally mission-control rather than generic SaaS or file-manager UI.

## Workspace

The desktop workspace uses a 64px icon rail with hover tooltips, a vertical room-code treatment, and a compact Direct P2P privacy marker. The main area keeps the modern workspace composition: a large full-bleed transfer hero, a persistent private-room panel with QR and share link, a connected-device panel, and an activity panel. On smaller screens, the icon rail becomes a compact horizontal navigation and the panels stack without horizontal overflow.

## Signature interaction

The transfer hero contains three concentric cyan signal rings centered around the upload action. The rings slowly expand and fade to communicate a live wireless signal, while drag-over accelerates the ripple animation, increases glow, and changes the transfer icon state. Device online indicators use a restrained mint pulse. Buttons and cards use concise color and glow feedback without shifting layout.

## Preserved behavior

The redesign keeps room creation and joining, `FLUX-####` room codes, QR sharing, copy-link behavior, file and folder selection, connected-device selection, active transfer state, strict direct WebRTC P2P, no TURN, no server file relay, adaptive DataChannel queue protection, checksums, and the existing transfer modal state machine.

## Verification

The client and server production builds pass. Room and SDP signaling regression tests pass. The exposed preview loads through the sandbox public proxy and displays the Deep Signal dark workspace after resetting the preview theme preference. The preview was interactively tested for onboarding, room sharing, QR rendering, room invite controls, connected-device presence, icon rail navigation, and console cleanliness.

Preview URL: https://5173-ihg4dm5wydwcalhecn8rg-0c8f19a4.us4.manus.computer/?room=FLUX-9TPR

## Post-redesign interaction and resilience pass

The Deep Signal shell now treats the rail as application navigation: each item updates an active workspace view and the main content receives focus for keyboard users. Transfers is a useful guest activity surface rather than a scroll target, with local history beside the live transfer panel. Rooms, Devices, and Settings are similarly dedicated views.

Visual resilience was improved with translucent `backdrop-filter` surfaces, explicit light-theme surface tokens, cross-surface theme interpolation, minimum-width rules for every grid/flex child, long-label ellipsis, technical-copy wrapping, equal-height grids, and narrow-screen collapse rules. Browser verification found no horizontal overflow at the tested desktop preview width. Theme transitions respect `prefers-reduced-motion`.

Guest mode is intentionally lightweight: transfer metadata is retained in browser localStorage, a clear-history action is available, and Settings communicates that an account may be added in the future without making sign-in a prerequisite. No signaling, WebRTC, or server file-handling behavior was changed in this pass.
