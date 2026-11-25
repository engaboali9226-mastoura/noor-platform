# R386 V4 save performance hotfix

Operator test evidence: issue #240 comment 7163324712. Isolated representative load 2272 events, 1049 executions, 32 days; samples 1565.66, 1593.23, 1502.64 ms; exact parity, six negative cases, runtime composition PASS. Production not yet changed.

Production apply/rollback SQL are explicit transactional function-only operations, not schema installation. Do not rerun original production preparation or rotate receipt keys. Rollback restores only original function bodies, not data; not a Render rollback.

- s3_commit: 01f275f54650151b887820d9f85928d0 -> 987430160ab3129e7e5b51b0070183de
- s3_matches: 5f9da1bf6b9950fbb5313f64652a476f -> bb01e3898b413a8e880e16d1d57b0818
- s4_extract: 65c2df617add5da7343d42f0c46628dd -> fd384654bfd1b77c9c082e05e133433a
- s4_capture: aceb83605b83a21bf6d2353121ba2b48 -> efef8197b9474e433a3aece17b03e562
