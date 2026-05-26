# Third-Party Notices

This repository currently has a minimal dependency surface and no large third-party
runtime library inventory to enumerate here.

As the project grows, all future third-party libraries, adapted code, and transport
integration dependencies should be tracked in this document so the repository keeps
clear attribution and license visibility.

## Current Status

- the repository currently uses a small amount of platform tooling and project code
- there is currently minimal or no external npm dependency surface to audit here
- future third-party additions must be reviewed and recorded before release or distribution

## npm Packages

Track here:

- package name
- version or version range
- license
- why it was added
- whether it is runtime, dev-only, or tooling-only

## ESP / Arduino Libraries

Track here:

- ESP-IDF components used beyond platform defaults
- Arduino libraries added for displays, radios, crypto, storage, or sensors
- upstream project URL
- license
- whether the code is linked, vendored, or copied

## Transport Integrations

Track here:

- any future Yggdrasil, mesh, LoRa, BLE, TCP, or serial bridge integrations
- upstream implementation source
- license and redistribution terms
- whether the integration is optional, required, or experimental

## Copied or Adapted Snippets

If any code snippet, helper, init sequence, hardware profile, or protocol example is
copied or adapted from another project, record here:

- original source URL or repository
- author or project name
- license
- file(s) affected
- what was adapted
