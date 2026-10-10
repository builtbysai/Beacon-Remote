# Verified Oracle capacity

The signed-in OCI tenancy is Free Tier with Ashburn as its home region. Actual
Compute limits are 2 A1 OCPUs and 12 GB RAM; the existing host already uses both.
No resize, reboot, paid resource or account upgrade was performed. Block Volume
limits show 200 GB combined free capacity, 60 GB allocated and 140 GB available;
volume backup limits show five allowed and none used. The private beacon-backups
bucket showed 33.57 KiB against its 20 GiB combined free object/archive allowance
before Remote's first small encrypted backup. No new bucket or access policy was
created. Historical 4-OCPU/24-GB banners were not used to justify expansion.

Bounded old Docker build-cache cleanup reclaimed 26.46 GB without deleting data
volumes or retained rollback images. After both product rollouts the root disk
shows 24 GiB used, 34 GiB free (42%); RAM approximately 1.8 GiB used, 9.8 GiB
available. Remote container samples were backend 54 MiB, PostgreSQL 49 MiB and
frontend 12 MiB. Its hard limits total 1152 MiB and 1.05 CPUs, not reservations.

Public HTTPS and database-backed readiness pass for both products. Remote has
its own encrypted Restic prefix/key and daily backup timer; a host-side backup,
integrity check and separate-database restore succeeded. Recovery credentials
are also stored outside the VM using owner-scoped Windows DPAPI and restricted
ACLs. Existing View backup configuration/timers were not modified.

Coturn is running, but the same-server client-to-client smoke check failed at
channel binding with Forbidden IP. The no-loopback protection was retained.
An actual two-device forced-relay WebRTC session is still required. Beacon View
camera media and Remote browser video/input are not claimed by health checks.
