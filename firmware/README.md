# Firmware

Firmware is organized by `role` rather than by one monolithic board image.

## Layout

- `dongle/`: high-trust identity token firmware
- `unified-node/`: reusable firmware base with board-profile switches
- `gateway/`: host-attached or bridge-oriented firmware
- `light-node/`: constrained peer or relay firmware
- `shared/`: protocol and role definitions shared conceptually across firmware targets

## Design Rule

Boards are selected by a combination of:

- chip family
- board profile
- node role

This keeps the codebase aligned with the system model described in the docs.
