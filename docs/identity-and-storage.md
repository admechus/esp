# Identity And Storage

## Identity Model

Use one device-root secret as the source of identity for boards that are allowed to hold root identity.

Derive or store from that root:

- `identity signing key`
- `key agreement key`
- `backup/export key`
- `device-auth key`

This reduces key sprawl and keeps rotation logic manageable.

Not every ESP board should hold the same class of key:

- `identity boards` may hold root or root-derived long-lived secrets
- `gateway boards` should prefer delegated node credentials
- `light nodes` should prefer ephemeral or easily replaceable credentials

## Recommended Storage Rules

### Store on the dongle or identity board

- root secret or root seed
- private signing material
- private key agreement material
- device configuration

### Store on the PC agent

- public peer keys
- contact records
- encrypted or plaintext local message cache depending on later design
- transport queues

### Store on SD card

Use SD for:

- encrypted backup blobs
- optional attachment cache
- export/import bundles
- large local audit or debug logs if needed

Do not use SD as the primary plaintext home of the root identity key.

## Storage-Aware Rules

### Devices with protected persistent storage

May store:

- long-lived delegated keys
- identity metadata
- monotonic counters or anti-replay state

### Devices with plain flash only

May store:

- replaceable delegated keys
- compact configuration
- minimal replay or queue state

Should avoid:

- irreplaceable root identity if a stronger profile exists in the system

### Devices with removable storage

May store:

- encrypted backups
- encrypted message bundles
- encrypted delayed-delivery queues

Should avoid:

- plaintext private identity material

### Devices with no practical persistent storage

Should use:

- ephemeral session keys
- host-provided bootstrap data
- short-lived delegated capability tokens

## ESP32-S3 Protection Direction

Once the development loop is stable:

- enable `Flash Encryption`
- enable `Secure Boot v2`
- use encrypted NVS for sensitive structured storage

During early prototyping, keep a development mode and delay irreversible fuse-burning until the firmware flow is stable.

## Recovery Philosophy

Loss of the dongle must not automatically mean permanent loss of identity unless that is an explicit product choice.

For the prototype, the simplest acceptable recovery model is:

- create an encrypted identity backup
- store it outside the device
- require a strong passphrase to restore

Later you can add:

- multi-device identity replication
- recovery contacts
- split secret backups

## Practical V1 Decision

For milestone 1, we should implement:

- device-generated identity
- device-stored private keys
- public identity export over USB
- signing over USB

We should not implement full backup/restore before the base identity flow works.

For later multi-platform support, the code should separate:

- `identity storage backend`
- `delegated node storage backend`
- `ephemeral session backend`
