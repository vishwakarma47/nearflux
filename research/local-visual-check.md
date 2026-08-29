# Local visual verification

The updated local app runs on `http://localhost:5173/` and successfully shows a generated `FLUX-####` room in the URL and header. First load displays the device-name onboarding modal; after `Save & Continue`, the main view shows:

- NearFlux header with Online status, room pill, device name, help, and theme controls.
- Drag-and-drop area with `Select Files` and `Select Folder` buttons.
- `Devices in Private Room` section with room badge, private-code copy, waiting state, and room share controls.
- Footer links and worldwide direct-P2P wording.

The visual composition is close to the supplied reference at the current viewport. The room-share action is present in both the header and room section; the dedicated modal still needs functional interaction verification. No runtime error was shown while loading or dismissing onboarding.
